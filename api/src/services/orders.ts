import crypto from 'node:crypto';
import { QueryTypes, Transaction } from 'sequelize';
import { sequelize } from '../db';
import { conflict, badRequest, notFound } from '../errors';
import { Order, Raffle } from '../models';
import { audit } from './raffles';

const DAY_MS = 24 * 3600 * 1000;

export interface ReserveInput {
  tipo: 'numeros' | 'talonario';
  numeros?: number[];
  talonario?: number;
  compradorNombre: string;
  compradorContacto: string;
  canal?: 'web' | 'fisica' | 'manual';
  /** Solo para canal fisica/manual: la orden nace pagada */
  pagada?: boolean;
  confirmadaPor?: number;
}

/**
 * Libera las reservas vencidas (todas las rifas, o una). Una orden vencida conserva
 * su lista de números para poder reactivarla si el organizador recibe el pago tarde.
 */
export async function expireOrders(raffleId?: number): Promise<number> {
  return sequelize.transaction(async (t) => {
    const rows = (await sequelize.query(
      `UPDATE orders SET estado = 'vencida'
       WHERE estado = 'pendiente' AND vence_en < now() ${raffleId ? 'AND raffle_id = :raffleId' : ''}
       RETURNING id`,
      { replacements: { raffleId }, type: QueryTypes.SELECT, transaction: t },
    )) as { id: number }[];
    if (rows.length) {
      await sequelize.query(
        `UPDATE tickets SET estado = 'disponible', order_id = NULL
         WHERE order_id IN (:ids) AND estado = 'reservado'`,
        { replacements: { ids: rows.map((r) => r.id) }, transaction: t },
      );
    }
    return rows.length;
  });
}

/** UPDATE condicional: solo toma números que siguen 'disponible'. Devuelve los tomados. */
async function takeTickets(
  raffleId: number,
  numeros: number[],
  orderId: number,
  estado: 'reservado' | 'pagado',
  t: Transaction,
): Promise<number[]> {
  const rows = (await sequelize.query(
    `UPDATE tickets SET estado = :estado, order_id = :orderId
     WHERE raffle_id = :raffleId AND numero IN (:numeros) AND estado = 'disponible'
     RETURNING numero`,
    { replacements: { estado, orderId, raffleId, numeros }, type: QueryTypes.SELECT, transaction: t },
  )) as { numero: number }[];
  return rows.map((r) => r.numero);
}

/** Números pedidos que tiene OTRA orden (los que esta misma orden alcanzó a tomar no cuentan). */
async function unavailableOf(raffleId: number, numeros: number[], orderId: number, t: Transaction): Promise<number[]> {
  const rows = (await sequelize.query(
    `SELECT numero FROM tickets
     WHERE raffle_id = :raffleId AND numero IN (:numeros) AND estado <> 'disponible' AND order_id IS DISTINCT FROM :orderId
     ORDER BY numero`,
    { replacements: { raffleId, numeros, orderId }, type: QueryTypes.SELECT, transaction: t },
  )) as { numero: number }[];
  return rows.map((r) => r.numero);
}

export async function reserve(raffle: any, input: ReserveInput) {
  const canal = input.canal ?? 'web';
  if (canal === 'web') {
    if (raffle.estado !== 'activa') throw conflict('La rifa no está recibiendo reservas');
    if (new Date(raffle.fechaSorteo).getTime() <= Date.now()) throw conflict('La venta cerró: ya llegó la fecha del sorteo');
  }
  const total = raffle.cantidadTalonarios * raffle.numerosPorTalonario;

  let numeros: number[];
  if (input.tipo === 'talonario') {
    const k = input.talonario;
    if (!k || k < 1 || k > raffle.cantidadTalonarios) throw badRequest('Talonario inexistente');
    numeros = Array.from({ length: raffle.numerosPorTalonario }, (_, i) => (k - 1) * raffle.numerosPorTalonario + i + 1);
  } else {
    numeros = [...new Set(input.numeros ?? [])].sort((a, b) => a - b);
    if (!numeros.length) throw badRequest('Elige al menos un número');
    if (numeros.some((n) => !Number.isInteger(n) || n < 1 || n > total)) throw badRequest('Hay números fuera de rango');
    if (canal === 'web' && numeros.length > raffle.maxNumerosPorOrden) {
      throw badRequest(`Máximo ${raffle.maxNumerosPorOrden} números por orden`);
    }
  }

  await expireOrders(raffle.id);

  return sequelize.transaction(async (t) => {
    const paid = canal !== 'web' && input.pagada === true;
    const order: any = await Order.create(
      {
        raffleId: raffle.id,
        token: crypto.randomBytes(24).toString('base64url'),
        tipo: input.tipo,
        canal,
        compradorNombre: input.compradorNombre,
        compradorContacto: input.compradorContacto,
        numeros,
        monto: numeros.length * raffle.precioNumero,
        estado: paid ? 'pagada' : 'pendiente',
        creadaEn: new Date(),
        venceEn: new Date(Date.now() + raffle.ttlReservaDias * DAY_MS),
        pagadaEn: paid ? new Date() : null,
        confirmadaPor: paid ? input.confirmadaPor ?? null : null,
      },
      { transaction: t },
    );

    // Corazón anti doble venta: una sola sentencia condicional dentro de la transacción.
    const taken = await takeTickets(raffle.id, numeros, order.id, paid ? 'pagado' : 'reservado', t);
    if (taken.length !== numeros.length) {
      const noDisponibles = await unavailableOf(raffle.id, numeros, order.id, t);
      throw conflict('Algunos números ya no están disponibles', { noDisponibles });
    }
    if (canal !== 'web') await audit(input.confirmadaPor ?? null, raffle.id, 'crear_manual', 'orden', order.id, { canal, numeros }, t);
    return order;
  });
}

async function lockOrder(orderId: number, t: Transaction): Promise<any> {
  const order: any = await Order.findByPk(orderId, { transaction: t, lock: t.LOCK.UPDATE });
  if (!order) throw notFound('Orden no encontrada');
  return order;
}

/** Confirmar pago. Si la orden ya venció, intenta retomar sus números (falla si alguien los tomó). */
export async function confirmOrder(orderId: number, userId: number) {
  return sequelize.transaction(async (t) => {
    const order = await lockOrder(orderId, t);
    if (order.estado === 'pagada') return order; // idempotente
    if (order.estado === 'cancelada') throw conflict('La orden está cancelada');

    if (order.estado === 'pendiente') {
      await sequelize.query(
        `UPDATE tickets SET estado = 'pagado' WHERE order_id = :id AND estado = 'reservado'`,
        { replacements: { id: order.id }, transaction: t },
      );
    } else {
      const taken = await takeTickets(order.raffleId, order.numeros, order.id, 'pagado', t);
      if (taken.length !== order.numeros.length) {
        const noDisponibles = await unavailableOf(order.raffleId, order.numeros, order.id, t);
        throw conflict('La reserva venció y algunos números ya fueron tomados por otra persona', { noDisponibles });
      }
    }
    order.estado = 'pagada';
    order.pagadaEn = new Date();
    order.confirmadaPor = userId;
    await order.save({ transaction: t });
    await audit(userId, order.raffleId, 'confirmar_pago', 'orden', order.id, {}, t);
    return order;
  });
}

export async function cancelOrder(orderId: number, userId: number) {
  return sequelize.transaction(async (t) => {
    const order = await lockOrder(orderId, t);
    if (order.estado === 'cancelada') return order;
    const previo = order.estado;
    await sequelize.query(
      `UPDATE tickets SET estado = 'disponible', order_id = NULL WHERE order_id = :id`,
      { replacements: { id: order.id }, transaction: t },
    );
    order.estado = 'cancelada';
    order.pagadaEn = null;
    order.confirmadaPor = null;
    await order.save({ transaction: t });
    await audit(userId, order.raffleId, 'cancelar', 'orden', order.id, { estadoPrevio: previo }, t);
    return order;
  });
}

/** Extiende el plazo de una orden pendiente; si ya venció la reactiva (si los números siguen libres). */
export async function extendOrder(orderId: number, userId: number, dias: number) {
  return sequelize.transaction(async (t) => {
    const order = await lockOrder(orderId, t);
    if (order.estado === 'pendiente') {
      order.venceEn = new Date(new Date(order.venceEn).getTime() + dias * DAY_MS);
    } else if (order.estado === 'vencida') {
      const taken = await takeTickets(order.raffleId, order.numeros, order.id, 'reservado', t);
      if (taken.length !== order.numeros.length) {
        const noDisponibles = await unavailableOf(order.raffleId, order.numeros, order.id, t);
        throw conflict('Algunos números ya fueron tomados por otra persona', { noDisponibles });
      }
      order.estado = 'pendiente';
      order.venceEn = new Date(Date.now() + dias * DAY_MS);
    } else {
      throw conflict('Solo se puede extender una orden pendiente o vencida');
    }
    await order.save({ transaction: t });
    await audit(userId, order.raffleId, 'extender', 'orden', order.id, { dias }, t);
    return order;
  });
}

export async function raffleOf(orderId: number): Promise<any> {
  const order: any = await Order.findByPk(orderId);
  if (!order) throw notFound('Orden no encontrada');
  return order;
}

export { Raffle };

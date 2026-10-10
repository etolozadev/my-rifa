import crypto from 'node:crypto';
import { QueryTypes, Transaction } from 'sequelize';
import { sequelize } from '../db';
import { HttpError, badRequest, conflict, notFound } from '../errors';
import { Draw, Prize, Raffle } from '../models';
import { notifyTeam, panelUrl } from './mailer';
import { audit } from './raffles';

/**
 * Posición ganadora: SHA-256(semilla) leído como entero, módulo la cantidad de participantes.
 * Es la misma cuenta que hace el navegador para verificar el sorteo (web/src/lib/verify.ts).
 */
export function pickPosition(semilla: string, participantes: number): number {
  const hex = crypto.createHash('sha256').update(semilla, 'utf8').digest('hex');
  return Number(BigInt(`0x${hex}`) % BigInt(participantes));
}

/** ¿Hay algún premio sorteado (no anulado)? Desde ese momento no se registran ni confirman ventas. */
export async function drawsStarted(raffleId: number, t?: Transaction): Promise<boolean> {
  return (await Draw.count({ where: { raffleId, anuladoEn: null }, transaction: t })) > 0;
}

export interface DrawInput {
  premioId: number;
  modo: 'aleatorio' | 'manual';
  /** Solo manual: número ganador del sorteo externo */
  numero?: number;
  /** Solo manual: de dónde salió (ej. "Lotería, sorteo 4.512, 3 últimas cifras") */
  detalle?: string;
  /** Sortear aunque haya reservas sin pagar (no participan) */
  confirmarPendientes?: boolean;
}

/** Sortea un premio entre los números pagados que aún no ganaron. Devuelve el sorteo con su ganador. */
export async function drawPrize(raffleId: number, input: DrawInput, actorId: number) {
  const drawId = await sequelize.transaction(async (t) => {
    // El bloqueo de la rifa serializa sorteos simultáneos (dos pestañas, doble clic)
    const raffle: any = await Raffle.findByPk(raffleId, { transaction: t, lock: t.LOCK.UPDATE });
    if (!raffle) throw notFound();
    if (raffle.estado === 'borrador') throw conflict('La rifa aún no se publica');
    if (raffle.estado === 'activa') throw conflict('Cierra la venta antes de sortear');
    if (raffle.estado === 'sorteada') throw conflict('Todos los premios ya fueron sorteados');

    const prize: any = await Prize.findOne({ where: { id: input.premioId, raffleId }, transaction: t });
    if (!prize) throw notFound('Premio no encontrado');
    if (await Draw.findOne({ where: { prizeId: prize.id, anuladoEn: null }, transaction: t })) {
      throw conflict('Ese premio ya tiene ganador: anula el sorteo si hay que repetirlo');
    }

    // Reservas sin pagar no participan: se pide confirmación explícita para no dejar fuera a nadie por error
    const [pend] = (await sequelize.query(
      `SELECT count(*)::int AS pendientes,
              count(*) FILTER (WHERE EXISTS (SELECT 1 FROM payment_proofs p WHERE p.order_id = o.id))::int AS "conComprobante"
       FROM orders o WHERE o.raffle_id = :raffleId AND o.estado = 'pendiente' AND o.vence_en >= now()`,
      { replacements: { raffleId }, type: QueryTypes.SELECT, transaction: t },
    )) as { pendientes: number; conComprobante: number }[];
    if (pend.pendientes > 0 && !input.confirmarPendientes) {
      throw new HttpError(
        409,
        'pending_orders',
        `Hay ${pend.pendientes} ${pend.pendientes === 1 ? 'reserva pendiente' : 'reservas pendientes'} de pago` +
          (pend.conComprobante ? ` (${pend.conComprobante} con comprobante por revisar)` : '') +
          ': sus números no participan.',
        pend,
      );
    }

    // Participantes: números pagados que no ganaron otro premio, en orden. Se guarda la lista para verificar.
    const rows = (await sequelize.query(
      `SELECT t.id, t.numero FROM tickets t
       WHERE t.raffle_id = :raffleId AND t.estado = 'pagado'
         AND NOT EXISTS (SELECT 1 FROM draws d WHERE d.ticket_id = t.id AND d.anulado_en IS NULL)
       ORDER BY t.numero`,
      { replacements: { raffleId }, type: QueryTypes.SELECT, transaction: t },
    )) as { id: number; numero: number }[];
    if (!rows.length) throw conflict('No hay números pagados que puedan ganar');

    let posicion: number;
    let semilla: string | null = null;
    let detalle: string | null = null;
    if (input.modo === 'aleatorio') {
      semilla = crypto.randomBytes(32).toString('hex');
      posicion = pickPosition(semilla, rows.length);
    } else {
      if (!input.numero) throw badRequest('Indica el número ganador');
      detalle = input.detalle?.trim() ?? '';
      if (detalle.length < 3) throw badRequest('Indica de dónde salió el número (ej. "Lotería del 12/11, 3 últimas cifras")');
      posicion = rows.findIndex((r) => r.numero === input.numero);
      if (posicion < 0) {
        const total = raffle.cantidadTalonarios * raffle.numerosPorTalonario;
        if (input.numero < 1 || input.numero > total) throw badRequest(`Los números van del 1 al ${total}`);
        const won = await sequelize.query(
          `SELECT 1 FROM draws d JOIN tickets t ON t.id = d.ticket_id
           WHERE t.raffle_id = :raffleId AND t.numero = :numero AND d.anulado_en IS NULL`,
          { replacements: { raffleId, numero: input.numero }, type: QueryTypes.SELECT, transaction: t },
        );
        throw conflict(won.length ? `El número ${input.numero} ya ganó otro premio` : `El número ${input.numero} no está pagado: no participa`);
      }
    }

    const winner = rows[posicion];
    const draw: any = await Draw.create(
      {
        raffleId,
        prizeId: prize.id,
        ticketId: winner.id,
        sorteadoPor: actorId,
        sorteadoEn: new Date(),
        modo: input.modo,
        semilla,
        participantes: rows.map((r) => r.numero),
        posicion,
        detalle,
      },
      { transaction: t },
    );

    // Con todos los premios sorteados la rifa queda "sorteada"
    const [{ faltan }] = (await sequelize.query(
      `SELECT count(*)::int AS faltan FROM prizes p
       WHERE p.raffle_id = :raffleId AND NOT EXISTS (SELECT 1 FROM draws d WHERE d.prize_id = p.id AND d.anulado_en IS NULL)`,
      { replacements: { raffleId }, type: QueryTypes.SELECT, transaction: t },
    )) as { faltan: number }[];
    if (faltan === 0) await raffle.update({ estado: 'sorteada', actualizadoEn: new Date() }, { transaction: t });

    await audit(actorId, raffleId, 'sortear', 'sorteo', draw.id, { premio: prize.nombre, numero: winner.numero, modo: input.modo }, t);
    return draw.id as number;
  });

  const result = (await listDraws(raffleId, true)).find((d) => d.id === drawId)!;
  const raffle: any = await Raffle.findByPk(raffleId);
  void notifyTeam(raffleId, `Sorteo de ${raffle.nombre}: ${result.premio.nombre}`, [
    `El número ${result.numero} ganó "${result.premio.nombre}" (${result.premio.orden}° premio).`,
    result.compradorNombre ? `Ganador: ${result.compradorNombre} · ${result.compradorContacto}` : '',
    result.modo === 'aleatorio'
      ? `Sorteo al azar entre ${result.participantes} números pagados (semilla ${result.semilla}).`
      : `Sorteo externo: ${result.detalle}.`,
    `Avísale al ganador desde el panel: ${panelUrl(`/rifas/${raffleId}/sorteo`)}`,
  ].filter(Boolean));
  return result;
}

/** Anula un sorteo (ganador inubicable, error al registrar). Queda publicado con su motivo y el premio se puede volver a sortear. */
export async function annulDraw(drawId: number, actorId: number, motivo: string) {
  return sequelize.transaction(async (t) => {
    const draw: any = await Draw.findByPk(drawId, { transaction: t, lock: t.LOCK.UPDATE });
    if (!draw) throw notFound('Sorteo no encontrado');
    if (draw.anuladoEn) throw conflict('Ese sorteo ya está anulado');
    await draw.update({ anuladoEn: new Date(), motivoAnulacion: motivo }, { transaction: t });
    const raffle: any = await Raffle.findByPk(draw.raffleId, { transaction: t, lock: t.LOCK.UPDATE });
    if (raffle.estado === 'sorteada') await raffle.update({ estado: 'cerrada', actualizadoEn: new Date() }, { transaction: t });
    await audit(actorId, draw.raffleId, 'anular_sorteo', 'sorteo', draw.id, { motivo }, t);
    return draw;
  });
}

export interface DrawView {
  id: number;
  premio: { id: number; orden: number; nombre: string };
  numero: number;
  modo: 'aleatorio' | 'manual';
  semilla: string | null;
  participantes: number;
  posicion: number | null;
  detalle: string | null;
  sorteadoEn: string;
  anuladoEn: string | null;
  motivoAnulacion: string | null;
  // Solo para el equipo
  ordenId?: number | null;
  compradorNombre?: string | null;
  compradorContacto?: string | null;
  vendedorNombre?: string | null;
}

/** Sorteos de una rifa (vigentes primero, por premio). Los datos del ganador solo para el equipo. */
export async function listDraws(raffleId: number, team: boolean): Promise<DrawView[]> {
  const rows = (await sequelize.query(
    `SELECT d.id, d.modo, d.semilla, cardinality(d.participantes) AS participantes, d.posicion, d.detalle,
            d.sorteado_en AS "sorteadoEn", d.anulado_en AS "anuladoEn", d.motivo_anulacion AS "motivoAnulacion",
            p.id AS "premioId", p.orden AS "premioOrden", p.nombre AS "premioNombre", t.numero,
            o.id AS "ordenId", o.comprador_nombre AS "compradorNombre", o.comprador_contacto AS "compradorContacto",
            su.nombre AS "vendedorNombre"
     FROM draws d
     JOIN prizes p ON p.id = d.prize_id
     JOIN tickets t ON t.id = d.ticket_id
     LEFT JOIN orders o ON o.id = t.order_id
     LEFT JOIN sellers s ON s.id = o.seller_id
     LEFT JOIN users su ON su.id = s.user_id
     WHERE d.raffle_id = :raffleId
     ORDER BY d.anulado_en IS NOT NULL, p.orden, d.sorteado_en`,
    { replacements: { raffleId }, type: QueryTypes.SELECT },
  )) as any[];
  return rows.map((r) => ({
    id: r.id,
    premio: { id: r.premioId, orden: r.premioOrden, nombre: r.premioNombre },
    numero: r.numero,
    modo: r.modo,
    semilla: r.semilla,
    participantes: r.participantes ?? 0,
    posicion: r.posicion,
    detalle: r.detalle,
    sorteadoEn: r.sorteadoEn,
    anuladoEn: r.anuladoEn,
    motivoAnulacion: r.motivoAnulacion,
    ...(team
      ? { ordenId: r.ordenId, compradorNombre: r.compradorNombre, compradorContacto: r.compradorContacto, vendedorNombre: r.vendedorNombre }
      : {}),
  }));
}

/** Lista de números que participaron en un sorteo, para verificarlo */
export async function drawParticipants(raffleId: number, drawId: number): Promise<number[]> {
  const draw: any = await Draw.findOne({ where: { id: drawId, raffleId } });
  if (!draw) throw notFound('Sorteo no encontrado');
  return draw.participantes ?? [];
}

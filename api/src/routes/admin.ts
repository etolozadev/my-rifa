import fs from 'node:fs';
import { Router } from 'express';
import { QueryTypes } from 'sequelize';
import { z } from 'zod';
import { sequelize } from '../db';
import { badRequest, conflict, forbidden, notFound, wrap } from '../errors';
import { AuthedRequest, assertRole, csrfGuard, raffleRole, requireAuth } from '../middleware/auth';
import { Contact, Draw, Order, PaymentProof, Prize, Raffle, RaffleMember, Seller, User } from '../models';
import { proofPath } from '../services/files';
import { cancelOrder, confirmOrder, expireOrders, extendOrder, raffleOf, reserve } from '../services/orders';
import { audit, createRaffle, raffleSummary, regenerateStructure } from '../services/raffles';
import { addMember, removeMember, sellerStats, sellerOfUser } from '../services/sellers';
import { contactFields } from '../services/contacts';
import { teamRouter } from './team';
import { drawsRouter } from './draws';
import { contactsRouter } from './contacts';
import { drawsStarted } from '../services/draws';

export const adminRouter = Router();
adminRouter.use(requireAuth, csrfGuard);

const uid = (req: any) => (req as AuthedRequest).userId;
const team = raffleRole('organizador', 'editor');
const organizer = raffleRole('organizador');
/** Cualquiera del equipo, incluido el vendedor (que solo ve y opera sus propias ventas) */
const member = raffleRole('organizador', 'editor', 'vendedor');
/** Vendedor de la petición (solo si el rol es vendedor) */
const sellerOf = (req: any): any | null => req.seller ?? null;

/** Nombres de los vendedores de una rifa, para mostrar a quién se atribuye cada venta */
async function sellerNames(raffleId: number): Promise<Map<number, string>> {
  const rows: any[] = await Seller.findAll({ where: { raffleId }, include: [{ association: 'User', attributes: ['nombre'] }] });
  return new Map(rows.map((s) => [s.id, s.User?.nombre ?? '']));
}

// ---------- Validación ----------
const bank = {
  bancoNombre: z.string().trim().max(80).nullable().optional(),
  bancoTipoCuenta: z.string().trim().max(40).nullable().optional(),
  bancoNumeroCuenta: z.string().trim().max(40).nullable().optional(),
  bancoTitular: z.string().trim().max(120).nullable().optional(),
  bancoRut: z.string().trim().max(20).nullable().optional(),
  bancoEmailAviso: z.string().trim().email().max(200).nullable().optional(),
};

const createBody = z
  .object({
    nombre: z.string().trim().min(3).max(120),
    proposito: z.enum(['beneficio', 'viaje', 'otro']).default('otro'),
    objetivo: z.string().trim().max(500).default(''),
    metaMonto: z.number().int().min(0).default(0),
    precioNumero: z.number().int().min(1),
    cantidadTalonarios: z.number().int().min(1).max(500),
    numerosPorTalonario: z.number().int().min(1).max(200),
    maxNumerosPorOrden: z.number().int().min(1).max(200).default(20),
    ttlReservaDias: z.number().int().min(1).max(60).default(7),
    fechaSorteo: z.coerce.date(),
    numeroAutorizacion: z.string().trim().max(60).nullable().optional(),
    ...bank,
  })
  .strict();

const patchBody = createBody.partial().extend({ estado: z.enum(['borrador', 'activa', 'cerrada']).optional() }).strict();

// ---------- Rifas ----------
adminRouter.get(
  '/rifas',
  wrap(async (req, res) => {
    const rows = (await sequelize.query(
      `SELECT r.id, r.slug, r.nombre, r.estado, r.fecha_sorteo AS "fechaSorteo", r.meta_monto AS "metaMonto", m.rol
       FROM raffles r JOIN raffle_members m ON m.raffle_id = r.id
       WHERE m.user_id = :uid ORDER BY r.creado_en DESC`,
      { replacements: { uid: uid(req) }, type: QueryTypes.SELECT },
    )) as any[];
    res.json(rows);
  }),
);

adminRouter.post(
  '/rifas',
  wrap(async (req, res) => {
    const body = createBody.parse(req.body);
    if (body.fechaSorteo.getTime() <= Date.now()) throw badRequest('La fecha del sorteo debe ser futura');
    const raffle = await createRaffle(uid(req), body);
    res.status(201).json(raffle);
  }),
);

adminRouter.get(
  '/rifas/:id',
  member,
  wrap(async (req, res) => {
    const raffle: any = await Raffle.findByPk(req.params.id, { include: [{ model: Prize, as: 'premios' }] });
    if (!raffle) throw notFound();
    const seller = sellerOf(req);
    res.json({
      ...raffle.toJSON(),
      rol: (req as any).role,
      resumen: await raffleSummary(raffle.id),
      // El vendedor ve su enlace y su propia rendición
      vendedor: seller ? (await sellerStats(raffle, seller.id))[0] : null,
    });
  }),
);

adminRouter.patch(
  '/rifas/:id',
  organizer,
  wrap(async (req, res) => {
    const body = patchBody.parse(req.body);
    const raffle: any = await Raffle.findByPk(req.params.id);
    if (!raffle) throw notFound();

    await sequelize.transaction(async (t) => {
      const structural = ['precioNumero', 'cantidadTalonarios', 'numerosPorTalonario'] as const;
      const changesStructure = structural.some((k) => body[k] !== undefined && body[k] !== raffle[k]);
      if (changesStructure) {
        if (raffle.estado !== 'borrador') throw conflict('La estructura y el precio solo se pueden cambiar mientras la rifa es borrador');
        const talonarios = body.cantidadTalonarios ?? raffle.cantidadTalonarios;
        const porTalonario = body.numerosPorTalonario ?? raffle.numerosPorTalonario;
        if (talonarios !== raffle.cantidadTalonarios || porTalonario !== raffle.numerosPorTalonario) {
          await regenerateStructure(raffle, talonarios, porTalonario, t);
        }
      }

      if (body.estado && body.estado !== raffle.estado) {
        if (raffle.estado === 'sorteada') throw conflict('La rifa ya fue sorteada');
        const next = { ...raffle.toJSON(), ...body };
        if (body.estado === 'activa') {
          if (!next.bancoNombre || !next.bancoNumeroCuenta || !next.bancoTitular) {
            throw badRequest('Para activar la rifa completa los datos bancarios (banco, número de cuenta y titular)');
          }
          if (new Date(next.fechaSorteo).getTime() <= Date.now()) throw badRequest('La fecha del sorteo debe ser futura');
        }
        if (body.estado === 'borrador' && raffle.estado !== 'borrador') {
          throw conflict('Una rifa activa no puede volver a borrador');
        }
        if (body.estado === 'activa' && (await drawsStarted(raffle.id, t))) {
          throw conflict('Ya hay premios sorteados: la venta no se puede reabrir');
        }
      }

      const { estado, ...rest } = body;
      raffle.set({ ...rest, ...(estado ? { estado } : {}), actualizadoEn: new Date() });
      await raffle.save({ transaction: t });
      await audit(uid(req), raffle.id, 'editar', 'rifa', raffle.id, { campos: Object.keys(body) }, t);
    });
    res.json(raffle);
  }),
);

// ---------- Premios ----------
const prizeBody = z
  .object({
    orden: z.number().int().min(1).max(100),
    nombre: z.string().trim().min(1).max(120),
    descripcion: z.string().trim().max(500).default(''),
    imagenUrl: z.string().url().max(500).nullable().optional(),
  })
  .strict();

adminRouter.post(
  '/rifas/:id/premios',
  organizer,
  wrap(async (req, res) => {
    const body = prizeBody.parse(req.body);
    const raffle: any = await Raffle.findByPk(req.params.id);
    if (raffle?.estado === 'sorteada') throw conflict('La rifa ya fue sorteada');
    const exists = await Prize.findOne({ where: { raffleId: req.params.id, orden: body.orden } });
    if (exists) throw conflict(`Ya existe un premio con orden ${body.orden}`);
    const prize = await Prize.create({ ...body, raffleId: Number(req.params.id) });
    res.status(201).json(prize);
  }),
);

adminRouter.patch(
  '/rifas/:id/premios/:premioId',
  organizer,
  wrap(async (req, res) => {
    const body = prizeBody.partial().parse(req.body);
    const prize: any = await Prize.findOne({ where: { id: req.params.premioId, raffleId: req.params.id } });
    if (!prize) throw notFound('Premio no encontrado');
    if (body.orden && body.orden !== prize.orden) {
      const clash = await Prize.findOne({ where: { raffleId: req.params.id, orden: body.orden } });
      if (clash) throw conflict(`Ya existe un premio con orden ${body.orden}`);
    }
    await prize.update(body);
    res.json(prize);
  }),
);

adminRouter.delete(
  '/rifas/:id/premios/:premioId',
  organizer,
  wrap(async (req, res) => {
    // Un premio con sorteos (incluso anulados) se conserva: es parte del registro público del sorteo
    if (await Draw.count({ where: { prizeId: req.params.premioId } })) throw conflict('Ese premio ya se sorteó: no se puede eliminar');
    const n = await Prize.destroy({ where: { id: req.params.premioId, raffleId: req.params.id } });
    if (!n) throw notFound('Premio no encontrado');
    res.status(204).end();
  }),
);

// ---------- Equipo (editores) ----------
adminRouter.get(
  '/rifas/:id/miembros',
  organizer,
  wrap(async (req, res) => {
    const rows = (await sequelize.query(
      `SELECT u.id AS "userId", u.nombre, u.email, m.rol
       FROM raffle_members m JOIN users u ON u.id = m.user_id WHERE m.raffle_id = :id ORDER BY m.creado_en`,
      { replacements: { id: req.params.id }, type: QueryTypes.SELECT },
    )) as any[];
    res.json(rows);
  }),
);

adminRouter.post(
  '/rifas/:id/miembros',
  organizer,
  wrap(async (req, res) => {
    // Usuarios que ya tienen cuenta; para quien no la tiene están las invitaciones por link
    const { email, rol } = z
      .object({ email: z.string().email(), rol: z.enum(['editor', 'vendedor']).default('editor') })
      .strict()
      .parse(req.body);
    const user: any = await User.findOne({ where: { email: email.toLowerCase() } });
    if (!user) throw notFound('No existe un usuario con ese correo: envíale una invitación por link');
    await sequelize.transaction((t) => addMember(Number(req.params.id), user.id, rol, uid(req), t));
    res.status(201).json({ userId: user.id, nombre: user.nombre, email: user.email, rol });
  }),
);

adminRouter.delete(
  '/rifas/:id/miembros/:userId',
  organizer,
  wrap(async (req, res) => {
    const member: any = await RaffleMember.findOne({ where: { raffleId: req.params.id, userId: req.params.userId } });
    if (!member) throw notFound();
    if (member.rol === 'organizador') throw conflict('No se puede quitar al organizador');
    await sequelize.transaction((t) => removeMember(Number(req.params.id), member, uid(req), t));
    res.status(204).end();
  }),
);

// ---------- Números y órdenes (vista del equipo, con datos de compradores) ----------
adminRouter.get(
  '/rifas/:id/numeros',
  member,
  wrap(async (req, res) => {
    await expireOrders(Number(req.params.id));
    const estado = z.enum(['disponible', 'reservado', 'pagado']).optional().parse(req.query.estado);
    const seller = sellerOf(req);
    const rows = (await sequelize.query(
      `SELECT t.numero, b.numero AS talonario, t.estado, o.id AS "ordenId",
              o.comprador_nombre AS "compradorNombre", o.comprador_contacto AS "compradorContacto",
              o.creada_en AS fecha, o.canal, o.seller_id AS "ordenVendedorId",
              c.nombre AS "contactoNombre", c.telefono AS "contactoTelefono", COALESCE(o.contacto_vendio, false) AS "contactoVendio",
              t.seller_id AS "vendedorId", su.nombre AS "vendedorNombre"
       FROM tickets t
       JOIN booklets b ON b.id = t.booklet_id
       LEFT JOIN orders o ON o.id = t.order_id
       LEFT JOIN contacts c ON c.id = o.contact_id
       LEFT JOIN sellers s ON s.id = t.seller_id
       LEFT JOIN users su ON su.id = s.user_id
       WHERE t.raffle_id = :id ${estado ? 'AND t.estado = :estado' : ''}
       ORDER BY t.numero`,
      { replacements: { id: req.params.id, estado }, type: QueryTypes.SELECT },
    )) as any[];
    // Un vendedor ve el estado de todos los números, pero los datos del comprador solo de sus ventas
    if (seller) {
      for (const r of rows) {
        if (r.ordenId && r.ordenVendedorId !== seller.id) {
          Object.assign(r, {
            ordenId: null,
            compradorNombre: null,
            compradorContacto: null,
            contactoNombre: null,
            contactoTelefono: null,
            contactoVendio: false,
            fecha: null,
            canal: null,
          });
        }
      }
    }
    res.json(rows.map(({ ordenVendedorId, ...r }) => r));
  }),
);

adminRouter.get(
  '/rifas/:id/ordenes',
  member,
  wrap(async (req, res) => {
    await expireOrders(Number(req.params.id));
    const estado = z.enum(['pendiente', 'pagada', 'vencida', 'cancelada']).optional().parse(req.query.estado);
    const seller = sellerOf(req);
    const orders = await Order.findAll({
      where: { raffleId: req.params.id, ...(estado ? { estado } : {}), ...(seller ? { sellerId: seller.id } : {}) },
      include: [{ model: PaymentProof, as: 'comprobantes', attributes: ['id', 'nombreOriginal', 'subidoEn'] }],
      order: [['creadaEn', 'DESC']],
    });
    const names = await sellerNames(Number(req.params.id));
    const contacts = new Map(
      ((await Contact.findAll({ where: { raffleId: req.params.id } })) as any[]).map((c) => [c.id, { id: c.id, nombre: c.nombre, telefono: c.telefono }]),
    );
    // El token del comprador no se expone al equipo
    res.json(
      orders.map((o: any) => {
        const { token, ...rest } = o.toJSON();
        return {
          ...rest,
          vendedorNombre: rest.sellerId ? names.get(rest.sellerId) ?? null : null,
          contacto: rest.contactId ? contacts.get(rest.contactId) ?? null : null,
        };
      }),
    );
  }),
);

const saleBody = z.object({
  compradorNombre: z.string().trim().min(2).max(120),
  /** Teléfono del comprador: opcional si se elige una persona de contacto (al menos uno de los dos) */
  compradorContacto: z.string().trim().max(120).nullable().optional(),
  contactoId: z.number().int().nullable().optional(),
  /** La persona de contacto vendió el número (cuenta en su rendición) */
  contactoVendio: z.boolean().default(false),
  pagada: z.boolean().default(false),
  /** Solo el equipo elige a quién atribuir la venta; un vendedor siempre vende a su nombre */
  vendedorId: z.number().int().nullable().optional(),
});

/** Atribución, restricciones y forma de ubicar al comprador de una venta registrada desde el panel. */
async function saleContext(
  req: any,
  raffleId: number,
  v: { vendedorId?: number | null; compradorContacto?: string | null; contactoId?: number | null; contactoVendio?: boolean },
) {
  const seller = sellerOf(req);
  // Los contactos son del organizador y los editores: un vendedor registra el teléfono del comprador
  if (seller && v.contactoId) throw forbidden('Solo el equipo puede asociar personas de contacto');
  const contact = await contactFields(raffleId, v);
  return { ...contact, ...(await attribution(req, raffleId, v.vendedorId)) };
}

async function attribution(req: any, raffleId: number, vendedorId?: number | null) {
  const seller = sellerOf(req);
  if (seller) return { sellerId: seller.id as number, respetarAsignacion: true };
  if (vendedorId) {
    const s: any = await Seller.findOne({ where: { id: vendedorId, raffleId } });
    if (!s) throw badRequest('Ese vendedor no es de esta rifa');
    return { sellerId: s.id as number, respetarAsignacion: false };
  }
  return { sellerId: null, respetarAsignacion: false };
}

// Venta registrada por el equipo o por un vendedor (talonario físico, efectivo, pagos por fuera)
adminRouter.post(
  '/rifas/:id/ordenes-manuales',
  member,
  wrap(async (req, res) => {
    const body = saleBody
      .extend({
        tipo: z.enum(['numeros', 'talonario']),
        numeros: z.array(z.number().int()).max(500).optional(),
        talonario: z.number().int().optional(),
        canal: z.enum(['fisica', 'manual']).default('manual'),
      })
      .strict()
      .parse(req.body);
    const raffle = await Raffle.findByPk(req.params.id);
    if (!raffle) throw notFound();
    const { vendedorId, compradorContacto, contactoId, contactoVendio, ...input } = body;
    const ctx = await saleContext(req, Number(req.params.id), { vendedorId, compradorContacto, contactoId, contactoVendio });
    const order: any = await reserve(raffle, { ...input, ...ctx, confirmadaPor: uid(req) });
    res.status(201).json({ id: order.id, estado: order.estado, numeros: order.numeros, monto: order.monto, venceEn: order.venceEn });
  }),
);

// Carga rápida: muchas ventas de una vez (pegadas o importadas desde CSV). Cada fila es independiente.
adminRouter.post(
  '/rifas/:id/ventas-lote',
  member,
  wrap(async (req, res) => {
    const body = z
      .object({
        canal: z.enum(['fisica', 'manual']).default('fisica'),
        ventas: z.array(saleBody.extend({ numeros: z.array(z.number().int()).min(1).max(500) }).strict()).min(1).max(300),
      })
      .strict()
      .parse(req.body);
    const raffle = await Raffle.findByPk(req.params.id);
    if (!raffle) throw notFound();

    const resultados: any[] = [];
    for (const [i, v] of body.ventas.entries()) {
      const { vendedorId, compradorContacto, contactoId, contactoVendio, ...input } = v;
      try {
        const ctx = await saleContext(req, Number(req.params.id), { vendedorId, compradorContacto, contactoId, contactoVendio });
        const order: any = await reserve(raffle, { ...input, tipo: 'numeros', canal: body.canal, ...ctx, confirmadaPor: uid(req) });
        resultados.push({ fila: i + 1, ok: true, ordenId: order.id, numeros: order.numeros, estado: order.estado });
      } catch (e: any) {
        if (!e?.status) throw e;
        resultados.push({ fila: i + 1, ok: false, error: e.message, noDisponibles: e.details?.noDisponibles });
      }
    }
    await audit(uid(req), raffle.get('id') as number, 'carga_lote', 'rifa', raffle.get('id') as number, {
      filas: resultados.length,
      creadas: resultados.filter((r) => r.ok).length,
    });
    res.json({ creadas: resultados.filter((r) => r.ok).length, fallidas: resultados.filter((r) => !r.ok).length, resultados });
  }),
);

// ---------- Acciones sobre una orden (rol validado contra la rifa de la orden) ----------
/** Organizador o editor; un vendedor solo sobre sus propias ventas. */
async function assertCanOperate(userId: number, order: any) {
  const rol = await assertRole(userId, order.raffleId, ['organizador', 'editor', 'vendedor']);
  if (rol !== 'vendedor') return;
  const seller = await sellerOfUser(order.raffleId, userId);
  if (!seller || order.sellerId !== seller.id) throw forbidden('Solo puedes operar tus propias ventas');
}

const orderAction = (fn: (orderId: number, userId: number, req: any) => Promise<any>) =>
  wrap(async (req, res) => {
    const order = await raffleOf(Number(req.params.id));
    await assertCanOperate(uid(req), order);
    const updated = await fn(order.id, uid(req), req);
    res.json({ id: updated.id, estado: updated.estado, venceEn: updated.venceEn, pagadaEn: updated.pagadaEn });
  });

adminRouter.post('/ordenes/:id/confirmar', orderAction((id, u) => confirmOrder(id, u)));
adminRouter.post('/ordenes/:id/cancelar', orderAction((id, u) => cancelOrder(id, u)));
adminRouter.post(
  '/ordenes/:id/extender',
  orderAction((id, u, req) => {
    const { dias } = z.object({ dias: z.number().int().min(1).max(30).default(7) }).strict().parse(req.body ?? {});
    return extendOrder(id, u, dias);
  }),
);

adminRouter.get(
  '/comprobantes/:id',
  wrap(async (req, res) => {
    const proof: any = await PaymentProof.findByPk(req.params.id);
    if (!proof) throw notFound();
    const order = await raffleOf(proof.orderId);
    await assertCanOperate(uid(req), order);
    res.setHeader('Content-Type', proof.mime);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Disposition', 'inline');
    fs.createReadStream(proofPath(proof.archivo)).on('error', () => res.status(404).end()).pipe(res);
  }),
);

// Vendedores, enlaces de pago previo e invitaciones (fase 2)
adminRouter.use(teamRouter);

// Sorteo (fase 3)
adminRouter.use(drawsRouter);

// Personas de contacto
adminRouter.use(contactsRouter);

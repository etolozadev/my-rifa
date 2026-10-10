import fs from 'node:fs';
import { Router } from 'express';
import { QueryTypes } from 'sequelize';
import { z } from 'zod';
import { sequelize } from '../db';
import { badRequest, conflict, notFound, wrap } from '../errors';
import { AuthedRequest, assertRole, csrfGuard, raffleRole, requireAuth } from '../middleware/auth';
import { Order, PaymentProof, Prize, Raffle, RaffleMember, User } from '../models';
import { proofPath } from '../services/files';
import { cancelOrder, confirmOrder, expireOrders, extendOrder, raffleOf, reserve } from '../services/orders';
import { audit, createRaffle, raffleSummary, regenerateStructure } from '../services/raffles';

export const adminRouter = Router();
adminRouter.use(requireAuth, csrfGuard);

const uid = (req: any) => (req as AuthedRequest).userId;
const team = raffleRole('organizador', 'editor');
const organizer = raffleRole('organizador');

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
  team,
  wrap(async (req, res) => {
    const raffle: any = await Raffle.findByPk(req.params.id, { include: [{ model: Prize, as: 'premios' }] });
    if (!raffle) throw notFound();
    res.json({ ...raffle.toJSON(), rol: (req as any).role, resumen: await raffleSummary(raffle.id) });
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
    // Fase 1: solo editores y solo usuarios que ya tienen cuenta (crear con npm run user:create).
    // El rol vendedor y las invitaciones por link llegan en la fase 2.
    const { email } = z.object({ email: z.string().email() }).strict().parse(req.body);
    const user: any = await User.findOne({ where: { email: email.toLowerCase() } });
    if (!user) throw notFound('No existe un usuario con ese correo');
    const already = await RaffleMember.findOne({ where: { raffleId: req.params.id, userId: user.id } });
    if (already) throw conflict('Esa persona ya es parte de la rifa');
    await RaffleMember.create({ raffleId: Number(req.params.id), userId: user.id, rol: 'editor' });
    await audit(uid(req), Number(req.params.id), 'agregar_editor', 'miembro', user.id);
    res.status(201).json({ userId: user.id, nombre: user.nombre, email: user.email, rol: 'editor' });
  }),
);

adminRouter.delete(
  '/rifas/:id/miembros/:userId',
  organizer,
  wrap(async (req, res) => {
    const member: any = await RaffleMember.findOne({ where: { raffleId: req.params.id, userId: req.params.userId } });
    if (!member) throw notFound();
    if (member.rol === 'organizador') throw conflict('No se puede quitar al organizador');
    await member.destroy();
    await audit(uid(req), Number(req.params.id), 'quitar_miembro', 'miembro', Number(req.params.userId));
    res.status(204).end();
  }),
);

// ---------- Números y órdenes (vista del equipo, con datos de compradores) ----------
adminRouter.get(
  '/rifas/:id/numeros',
  team,
  wrap(async (req, res) => {
    await expireOrders(Number(req.params.id));
    const estado = z.enum(['disponible', 'reservado', 'pagado']).optional().parse(req.query.estado);
    const rows = (await sequelize.query(
      `SELECT t.numero, b.numero AS talonario, t.estado, o.id AS "ordenId",
              o.comprador_nombre AS "compradorNombre", o.comprador_contacto AS "compradorContacto",
              o.creada_en AS fecha, o.canal
       FROM tickets t
       JOIN booklets b ON b.id = t.booklet_id
       LEFT JOIN orders o ON o.id = t.order_id
       WHERE t.raffle_id = :id ${estado ? 'AND t.estado = :estado' : ''}
       ORDER BY t.numero`,
      { replacements: { id: req.params.id, estado }, type: QueryTypes.SELECT },
    )) as any[];
    res.json(rows);
  }),
);

adminRouter.get(
  '/rifas/:id/ordenes',
  team,
  wrap(async (req, res) => {
    await expireOrders(Number(req.params.id));
    const estado = z.enum(['pendiente', 'pagada', 'vencida', 'cancelada']).optional().parse(req.query.estado);
    const orders = await Order.findAll({
      where: { raffleId: req.params.id, ...(estado ? { estado } : {}) },
      include: [{ model: PaymentProof, as: 'comprobantes', attributes: ['id', 'nombreOriginal', 'subidoEn'] }],
      order: [['creadaEn', 'DESC']],
    });
    // El token del comprador no se expone al equipo
    res.json(orders.map((o: any) => { const { token, ...rest } = o.toJSON(); return rest; }));
  }),
);

// Venta registrada por el equipo (base para la carga rápida de rifas físicas de la fase 2)
adminRouter.post(
  '/rifas/:id/ordenes-manuales',
  team,
  wrap(async (req, res) => {
    const body = z
      .object({
        tipo: z.enum(['numeros', 'talonario']),
        numeros: z.array(z.number().int()).max(500).optional(),
        talonario: z.number().int().optional(),
        compradorNombre: z.string().trim().min(2).max(120),
        compradorContacto: z.string().trim().min(6).max(120),
        canal: z.enum(['fisica', 'manual']).default('manual'),
        pagada: z.boolean().default(false),
      })
      .strict()
      .parse(req.body);
    const raffle = await Raffle.findByPk(req.params.id);
    if (!raffle) throw notFound();
    const order: any = await reserve(raffle, { ...body, confirmadaPor: uid(req) });
    res.status(201).json({ id: order.id, estado: order.estado, numeros: order.numeros, monto: order.monto, venceEn: order.venceEn });
  }),
);

// ---------- Acciones sobre una orden (rol validado contra la rifa de la orden) ----------
const orderAction = (fn: (orderId: number, userId: number, req: any) => Promise<any>) =>
  wrap(async (req, res) => {
    const order = await raffleOf(Number(req.params.id));
    await assertRole(uid(req), order.raffleId, ['organizador', 'editor']);
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
    await assertRole(uid(req), order.raffleId, ['organizador', 'editor']);
    res.setHeader('Content-Type', proof.mime);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Disposition', 'inline');
    fs.createReadStream(proofPath(proof.archivo)).on('error', () => res.status(404).end()).pipe(res);
  }),
);


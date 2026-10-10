import fs from 'node:fs';
import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import multer from 'multer';
import { QueryTypes } from 'sequelize';
import { z } from 'zod';
import { config } from '../config';
import { sequelize } from '../db';
import { badRequest, conflict, notFound, wrap } from '../errors';
import { PaymentProof, Order, Prize, Raffle } from '../models';
import { MAX_BYTES, proofPath, saveProof } from '../services/files';
import { expireOrders, reserve } from '../services/orders';
import { raffleSummary } from '../services/raffles';

export const publicRouter = Router();

const skipInTest = () => config.NODE_ENV === 'test';
const reserveLimiter = rateLimit({ windowMs: 60 * 60 * 1000, limit: 30, skip: skipInTest, standardHeaders: true, legacyHeaders: false });
const uploadLimiter = rateLimit({ windowMs: 60 * 60 * 1000, limit: 30, skip: skipInTest, standardHeaders: true, legacyHeaders: false });
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_BYTES, files: 1 } });

export const bankOf = (r: any) => ({
  banco: r.bancoNombre,
  tipoCuenta: r.bancoTipoCuenta,
  numeroCuenta: r.bancoNumeroCuenta,
  titular: r.bancoTitular,
  rut: r.bancoRut,
  emailAviso: r.bancoEmailAviso,
});

async function findPublicRaffle(slug: string): Promise<any> {
  const raffle: any = await Raffle.findOne({ where: { slug } });
  // Un borrador no es visible para el público
  if (!raffle || raffle.estado === 'borrador') throw notFound('Rifa no encontrada');
  return raffle;
}

// --- Vista pública de la rifa: estado de cada número, SIN datos de compradores ---
publicRouter.get(
  '/rifas/:slug',
  wrap(async (req, res) => {
    const raffle = await findPublicRaffle(req.params.slug);
    await expireOrders(raffle.id);
    const tickets = (await sequelize.query(
      `SELECT numero AS n, estado AS e FROM tickets WHERE raffle_id = :id ORDER BY numero`,
      { replacements: { id: raffle.id }, type: QueryTypes.SELECT },
    )) as { n: number; e: string }[];
    const premios = await Prize.findAll({ where: { raffleId: raffle.id }, order: [['orden', 'ASC']] });
    const resumen = await raffleSummary(raffle.id);
    res.json({
      slug: raffle.slug,
      nombre: raffle.nombre,
      proposito: raffle.proposito,
      objetivo: raffle.objetivo,
      metaMonto: raffle.metaMonto,
      precioNumero: raffle.precioNumero,
      precioTalonario: raffle.precioNumero * raffle.numerosPorTalonario,
      cantidadTalonarios: raffle.cantidadTalonarios,
      numerosPorTalonario: raffle.numerosPorTalonario,
      maxNumerosPorOrden: raffle.maxNumerosPorOrden,
      ttlReservaDias: raffle.ttlReservaDias,
      fechaSorteo: raffle.fechaSorteo,
      estado: raffle.estado,
      numeroAutorizacion: raffle.numeroAutorizacion,
      // Los datos bancarios solo se muestran mientras se puede comprar
      datosBancarios: raffle.estado === 'activa' ? bankOf(raffle) : null,
      premios: premios.map((p: any) => ({ orden: p.orden, nombre: p.nombre, descripcion: p.descripcion, imagenUrl: p.imagenUrl })),
      avance: {
        recaudado: resumen.recaudado,
        metaMonto: resumen.metaMonto,
        disponibles: resumen.disponibles,
        reservados: resumen.reservados,
        pagados: resumen.pagados,
        talonariosDisponibles: resumen.talonariosDisponibles,
      },
      numeros: tickets,
    });
  }),
);

const reserveBody = z
  .object({
    tipo: z.enum(['numeros', 'talonario']),
    numeros: z.array(z.number().int()).max(500).optional(),
    talonario: z.number().int().optional(),
    compradorNombre: z.string().trim().min(2).max(120),
    compradorContacto: z.string().trim().min(6).max(120),
  })
  .strict();

publicRouter.post(
  '/rifas/:slug/ordenes',
  reserveLimiter,
  wrap(async (req, res) => {
    const body = reserveBody.parse(req.body);
    const raffle = await findPublicRaffle(req.params.slug);
    const order: any = await reserve(raffle, { ...body, canal: 'web' });
    res.status(201).json({ token: order.token, numeros: order.numeros, monto: order.monto, venceEn: order.venceEn });
  }),
);

// --- Vista de la orden para el comprador (acceso por token secreto) ---
async function findOrderByToken(token: string): Promise<any> {
  const order: any = await Order.findOne({ where: { token }, include: [{ model: PaymentProof, as: 'comprobantes' }] });
  if (!order) throw notFound('Orden no encontrada');
  return order;
}

publicRouter.get(
  '/ordenes/:token',
  wrap(async (req, res) => {
    await expireOrders();
    const order = await findOrderByToken(req.params.token);
    const raffle: any = await Raffle.findByPk(order.raffleId);
    res.json({
      estado: order.estado,
      numeros: order.numeros,
      monto: order.monto,
      compradorNombre: order.compradorNombre,
      creadaEn: order.creadaEn,
      venceEn: order.venceEn,
      rifa: { nombre: raffle.nombre, slug: raffle.slug, fechaSorteo: raffle.fechaSorteo },
      datosBancarios: order.estado === 'pendiente' ? bankOf(raffle) : null,
      comprobantes: order.comprobantes.map((c: any) => ({ id: c.id, nombre: c.nombreOriginal, subidoEn: c.subidoEn })),
    });
  }),
);

publicRouter.post(
  '/ordenes/:token/comprobantes',
  uploadLimiter,
  upload.single('archivo'),
  wrap(async (req, res) => {
    const order = await findOrderByToken(req.params.token);
    if (order.estado !== 'pendiente') throw conflict('Solo se puede subir comprobante a una orden pendiente');
    if (!req.file) throw badRequest('Falta el archivo (campo "archivo")');
    if (order.comprobantes.length >= 5) throw conflict('Máximo 5 comprobantes por orden');
    const saved = await saveProof(req.file.buffer);
    const proof: any = await PaymentProof.create({
      orderId: order.id,
      archivo: saved.archivo,
      nombreOriginal: req.file.originalname.slice(0, 120),
      mime: saved.mime,
      bytes: req.file.size,
    });
    res.status(201).json({ id: proof.id, nombre: proof.nombreOriginal, subidoEn: proof.subidoEn });
  }),
);

publicRouter.get(
  '/ordenes/:token/comprobantes/:proofId',
  wrap(async (req, res) => {
    const order = await findOrderByToken(req.params.token);
    const proof: any = order.comprobantes.find((c: any) => c.id === Number(req.params.proofId));
    if (!proof) throw notFound();
    res.setHeader('Content-Type', proof.mime);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Disposition', 'inline');
    fs.createReadStream(proofPath(proof.archivo)).on('error', () => res.status(404).end()).pipe(res);
  }),
);

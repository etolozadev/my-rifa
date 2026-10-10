import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { config } from '../config';
import { wrap } from '../errors';
import { csrfGuard, sessionUserId, setSession } from '../middleware/auth';
import { Order, Raffle } from '../models';
import { acceptInvitation, invitationInfo } from '../services/invitations';
import { findLink, linkState, useLink } from '../services/links';
import { expireOrders } from '../services/orders';
import { publicRaffle } from '../services/publicView';

/** Rutas públicas de la fase 2: enlaces de pago previo (/api/enlaces) e invitaciones (/api/invitaciones). */
export const sharedRouter = Router();

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 30,
  standardHeaders: true,
  legacyHeaders: false,
  skip: () => config.NODE_ENV === 'test',
});

// ---------- Enlace de pago previo: el comprador elige sus números ya pagados ----------
sharedRouter.get(
  '/enlaces/:token',
  wrap(async (req, res) => {
    const link = await findLink(req.params.token);
    const raffle: any = await Raffle.findByPk(link.raffleId);
    await expireOrders(raffle.id);
    const order: any = link.orderId ? await Order.findByPk(link.orderId) : null;
    res.json({
      estado: linkState(link),
      cupo: link.cupo,
      venceEn: link.venceEn,
      compradorNombre: link.compradorNombre,
      // Ya usado: el comprador vuelve a su orden con este token
      ordenToken: order?.token ?? null,
      // Ve la grilla como la vería el vendedor que le dio el enlace (sus números asignados disponibles)
      rifa: await publicRaffle(raffle, link.sellerId),
    });
  }),
);

sharedRouter.post(
  '/enlaces/:token/usar',
  limiter,
  wrap(async (req, res) => {
    const body = z
      .object({
        tipo: z.enum(['numeros', 'talonario']),
        numeros: z.array(z.number().int()).max(500).optional(),
        talonario: z.number().int().optional(),
        compradorNombre: z.string().trim().min(2).max(120),
        compradorContacto: z.string().trim().min(6).max(120),
      })
      .strict()
      .parse(req.body);
    const order: any = await useLink(req.params.token, body);
    res.status(201).json({ token: order.token, numeros: order.numeros, monto: order.monto });
  }),
);

// ---------- Invitaciones al equipo ----------
sharedRouter.get(
  '/invitaciones/:token',
  wrap(async (req, res) => {
    res.json({ ...(await invitationInfo(req.params.token)), conSesion: sessionUserId(req) !== null });
  }),
);

sharedRouter.post(
  '/invitaciones/:token/aceptar',
  limiter,
  csrfGuard,
  wrap(async (req, res) => {
    const userId = sessionUserId(req);
    const account = userId
      ? undefined
      : z
          .object({
            nombre: z.string().trim().min(2).max(100),
            email: z.string().trim().email().max(200),
            password: z.string().min(10, 'La contraseña debe tener al menos 10 caracteres').max(200),
          })
          .strict()
          .parse(req.body);
    const result = await acceptInvitation(req.params.token, userId, account);
    if (!userId) setSession(res, result.userId);
    res.status(201).json({ raffleId: result.raffleId, rol: result.rol });
  }),
);

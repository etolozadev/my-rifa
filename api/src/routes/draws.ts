import { Router } from 'express';
import { z } from 'zod';
import { notFound, wrap } from '../errors';
import { AuthedRequest, assertRole, raffleRole } from '../middleware/auth';
import { Draw } from '../models';
import { annulDraw, drawPrize, listDraws } from '../services/draws';

/** Sorteo (fase 3). Se monta dentro de adminRouter (exige sesión y X-Requested-With). */
export const drawsRouter = Router();

const uid = (req: any) => (req as AuthedRequest).userId;
const team = raffleRole('organizador', 'editor');
const organizer = raffleRole('organizador');

drawsRouter.get(
  '/rifas/:id/sorteos',
  team,
  wrap(async (req, res) => {
    res.json(await listDraws(Number(req.params.id), true));
  }),
);

drawsRouter.post(
  '/rifas/:id/sorteos',
  organizer,
  wrap(async (req, res) => {
    const body = z
      .object({
        premioId: z.number().int(),
        modo: z.enum(['aleatorio', 'manual']).default('aleatorio'),
        numero: z.number().int().optional(),
        detalle: z.string().trim().max(300).optional(),
        confirmarPendientes: z.boolean().default(false),
      })
      .strict()
      .parse(req.body);
    res.status(201).json(await drawPrize(Number(req.params.id), body, uid(req)));
  }),
);

drawsRouter.post(
  '/sorteos/:drawId/anular',
  wrap(async (req, res) => {
    const { motivo } = z
      .object({ motivo: z.string().trim().min(5, 'Explica el motivo (queda publicado)').max(300) })
      .strict()
      .parse(req.body);
    const draw: any = await Draw.findByPk(req.params.drawId);
    if (!draw) throw notFound('Sorteo no encontrado');
    await assertRole(uid(req), draw.raffleId, ['organizador']);
    await annulDraw(draw.id, uid(req), motivo);
    res.json((await listDraws(draw.raffleId, true)).find((d) => d.id === draw.id));
  }),
);

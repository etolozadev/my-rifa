import { Router } from 'express';
import { z } from 'zod';
import { badRequest, conflict, forbidden, notFound, wrap } from '../errors';
import { AuthedRequest, assertRole, raffleRole } from '../middleware/auth';
import { Invitation, Raffle, Seller, ShareLink } from '../models';
import { createInvitation, invitationView } from '../services/invitations';
import { createLink, linkState, linkView } from '../services/links';
import { assignNumbers, releaseNumbers, sellerOfUser, sellerStats } from '../services/sellers';
import { audit } from '../services/raffles';

/** Rutas de la fase 2 del panel. Se montan dentro de adminRouter (ya exige sesión y X-Requested-With). */
export const teamRouter = Router();

const uid = (req: any) => (req as AuthedRequest).userId;
const team = raffleRole('organizador', 'editor');
const organizer = raffleRole('organizador');
const member = raffleRole('organizador', 'editor', 'vendedor');

async function raffleOr404(id: string): Promise<any> {
  const raffle = await Raffle.findByPk(id);
  if (!raffle) throw notFound();
  return raffle;
}

// ---------- Vendedores: rendición y talonarios asignados ----------
teamRouter.get(
  '/rifas/:id/vendedores',
  team,
  wrap(async (req, res) => {
    res.json(await sellerStats(await raffleOr404(req.params.id)));
  }),
);

/** Números de un pedido de asignación: sueltos/rangos ya expandidos por el front, o talonarios completos */
const numbersBody = z
  .object({ numeros: z.array(z.number().int()).max(5000).optional(), talonarios: z.array(z.number().int()).max(500).optional() })
  .strict();

function expand(raffle: any, body: z.infer<typeof numbersBody>): number[] {
  const total = raffle.cantidadTalonarios * raffle.numerosPorTalonario;
  const set = new Set(body.numeros ?? []);
  for (const k of body.talonarios ?? []) {
    if (k < 1 || k > raffle.cantidadTalonarios) throw badRequest(`El talonario ${k} no existe`);
    for (let i = 1; i <= raffle.numerosPorTalonario; i++) set.add((k - 1) * raffle.numerosPorTalonario + i);
  }
  const nums = [...set].sort((a, b) => a - b);
  if (!nums.length) throw badRequest('Indica números o talonarios');
  if (nums.some((n) => n < 1 || n > total)) throw badRequest(`Los números van del 1 al ${total}`);
  return nums;
}

async function activeSeller(raffleId: number, sellerId: string): Promise<any> {
  const s: any = await Seller.findOne({ where: { id: sellerId, raffleId } });
  if (!s) throw notFound('Vendedor no encontrado');
  if (!s.activo) throw conflict('Ese vendedor ya no está en el equipo');
  return s;
}

teamRouter.post(
  '/rifas/:id/vendedores/:sellerId/asignar',
  team,
  wrap(async (req, res) => {
    const raffle = await raffleOr404(req.params.id);
    const seller = await activeSeller(raffle.id, req.params.sellerId);
    const n = await assignNumbers(raffle.id, seller.id, expand(raffle, numbersBody.parse(req.body)), uid(req));
    res.json({ asignados: n, vendedor: (await sellerStats(raffle, seller.id))[0] });
  }),
);

teamRouter.post(
  '/rifas/:id/vendedores/:sellerId/liberar',
  team,
  wrap(async (req, res) => {
    const raffle = await raffleOr404(req.params.id);
    const s: any = await Seller.findOne({ where: { id: req.params.sellerId, raffleId: raffle.id } });
    if (!s) throw notFound('Vendedor no encontrado');
    const n = await releaseNumbers(raffle.id, s.id, expand(raffle, numbersBody.parse(req.body)), uid(req));
    res.json({ liberados: n, vendedor: (await sellerStats(raffle, s.id))[0] });
  }),
);

// ---------- Enlaces de pago previo ----------
teamRouter.get(
  '/rifas/:id/enlaces',
  member,
  wrap(async (req, res) => {
    const seller = (req as any).seller;
    const links: any[] = await ShareLink.findAll({
      where: { raffleId: req.params.id, ...(seller ? { sellerId: seller.id } : {}) },
      order: [['creadoEn', 'DESC']],
    });
    const sellers: any[] = await Seller.findAll({ where: { raffleId: req.params.id }, include: [{ association: 'User', attributes: ['nombre'] }] });
    const names = new Map(sellers.map((s) => [s.id, s.User?.nombre ?? null]));
    res.json(links.map((l) => linkView(l, l.sellerId ? names.get(l.sellerId) ?? null : null)));
  }),
);

teamRouter.post(
  '/rifas/:id/enlaces',
  member,
  wrap(async (req, res) => {
    const body = z
      .object({
        cupo: z.number().int().min(1).max(200),
        venceDias: z.number().int().min(1).max(60).default(7),
        compradorNombre: z.string().trim().max(120).nullable().optional(),
        compradorContacto: z.string().trim().max(120).nullable().optional(),
      })
      .strict()
      .parse(req.body);
    const raffle = await raffleOr404(req.params.id);
    const seller = (req as any).seller;
    const link = await createLink(raffle, body, uid(req), seller?.id ?? null);
    res.status(201).json(linkView(link));
  }),
);

teamRouter.post(
  '/enlaces/:linkId/revocar',
  wrap(async (req, res) => {
    const link: any = await ShareLink.findByPk(req.params.linkId);
    if (!link) throw notFound('Enlace no encontrado');
    const rol = await assertRole(uid(req), link.raffleId, ['organizador', 'editor', 'vendedor']);
    if (rol === 'vendedor') {
      const seller = await sellerOfUser(link.raffleId, uid(req));
      if (!seller || link.sellerId !== seller.id) throw forbidden('Solo puedes anular tus propios enlaces');
    }
    if (linkState(link) === 'usado') throw conflict('El enlace ya se usó: cancela la orden si corresponde');
    if (!link.revocadoEn) {
      await link.update({ revocadoEn: new Date() });
      await audit(uid(req), link.raffleId, 'revocar_enlace', 'enlace', link.id);
    }
    res.json(linkView(link));
  }),
);

// ---------- Invitaciones por link (solo organizador) ----------
teamRouter.get(
  '/rifas/:id/invitaciones',
  organizer,
  wrap(async (req, res) => {
    const list = await Invitation.findAll({ where: { raffleId: req.params.id }, order: [['creadoEn', 'DESC']] });
    res.json(list.map(invitationView));
  }),
);

teamRouter.post(
  '/rifas/:id/invitaciones',
  organizer,
  wrap(async (req, res) => {
    const body = z
      .object({ rol: z.enum(['editor', 'vendedor']), venceDias: z.number().int().min(1).max(30).default(7) })
      .strict()
      .parse(req.body);
    const raffle = await raffleOr404(req.params.id);
    res.status(201).json(invitationView(await createInvitation(raffle.id, body.rol, body.venceDias, uid(req))));
  }),
);

teamRouter.post(
  '/invitaciones/:invId/revocar',
  wrap(async (req, res) => {
    const inv: any = await Invitation.findByPk(req.params.invId);
    if (!inv) throw notFound('Invitación no encontrada');
    await assertRole(uid(req), inv.raffleId, ['organizador']);
    if (inv.usadaEn) throw conflict('La invitación ya se usó: quita a la persona desde el equipo');
    if (!inv.revocadaEn) {
      await inv.update({ revocadaEn: new Date() });
      await audit(uid(req), inv.raffleId, 'revocar_invitacion', 'invitacion', inv.id);
    }
    res.json(invitationView(inv));
  }),
);

import crypto from 'node:crypto';
import { sequelize } from '../db';
import { badRequest, conflict, notFound } from '../errors';
import { Raffle, ShareLink } from '../models';
import { orderNumbers, reserve } from './orders';
import { audit } from './raffles';

const DAY_MS = 24 * 3600 * 1000;

export type LinkState = 'vigente' | 'usado' | 'vencido' | 'revocado';

export function linkState(l: any): LinkState {
  if (l.orderId) return 'usado';
  if (l.revocadoEn) return 'revocado';
  if (new Date(l.venceEn).getTime() <= Date.now()) return 'vencido';
  return 'vigente';
}

/** Vista del equipo de un enlace */
export const linkView = (l: any, vendedorNombre: string | null = null) => ({
  id: l.id,
  token: l.token,
  cupo: l.cupo,
  estado: linkState(l),
  venceEn: l.venceEn,
  creadoEn: l.creadoEn,
  compradorNombre: l.compradorNombre,
  compradorContacto: l.compradorContacto,
  ordenId: l.orderId,
  vendedorId: l.sellerId,
  vendedorNombre,
});

export interface NewLink {
  cupo: number;
  venceDias: number;
  compradorNombre?: string | null;
  compradorContacto?: string | null;
}

/** Enlace para alguien que ya pagó `cupo` números: los elige él mismo y la orden nace pagada. */
export async function createLink(raffle: any, data: NewLink, actorId: number, sellerId: number | null) {
  if (raffle.estado === 'borrador' || raffle.estado === 'sorteada') throw conflict('La rifa no está vendiendo');
  const total = raffle.cantidadTalonarios * raffle.numerosPorTalonario;
  if (data.cupo > total) throw badRequest(`La rifa tiene ${total} números`);
  const link: any = await ShareLink.create({
    raffleId: raffle.id,
    token: crypto.randomBytes(18).toString('base64url'),
    cupo: data.cupo,
    usados: 0,
    venceEn: new Date(Date.now() + data.venceDias * DAY_MS),
    compradorNombre: data.compradorNombre || null,
    compradorContacto: data.compradorContacto || null,
    sellerId,
    creadoPor: actorId,
    creadoEn: new Date(),
  });
  await audit(actorId, raffle.id, 'crear_enlace', 'enlace', link.id, { cupo: data.cupo, sellerId });
  return link;
}

export async function findLink(token: string): Promise<any> {
  const link: any = await ShareLink.findOne({ where: { token } });
  if (!link) throw notFound('Enlace no encontrado');
  return link;
}

export interface UseLinkInput {
  tipo: 'numeros' | 'talonario';
  numeros?: number[];
  talonario?: number;
  compradorNombre: string;
  compradorContacto: string;
}

/**
 * Usa el enlace: crea la orden pagada con exactamente `cupo` números. El enlace se bloquea (FOR UPDATE)
 * durante la transacción, así dos pestañas no pueden usarlo a la vez.
 */
export async function useLink(token: string, input: UseLinkInput) {
  return sequelize.transaction(async (t) => {
    const link: any = await ShareLink.findOne({ where: { token }, transaction: t, lock: t.LOCK.UPDATE });
    if (!link) throw notFound('Enlace no encontrado');
    const state = linkState(link);
    if (state === 'usado') throw conflict('Este enlace ya se usó');
    if (state === 'revocado') throw conflict('Este enlace fue anulado por el organizador');
    if (state === 'vencido') throw conflict('Este enlace venció: pide uno nuevo al organizador');

    const raffle: any = await Raffle.findByPk(link.raffleId, { transaction: t });
    if (!['activa', 'cerrada'].includes(raffle.estado)) throw conflict('La rifa ya no permite elegir números');
    if (new Date(raffle.fechaSorteo).getTime() <= Date.now()) throw conflict('Ya llegó la fecha del sorteo');
    const numeros = orderNumbers(raffle, input);
    if (numeros.length !== link.cupo) throw badRequest(`Debes elegir exactamente ${link.cupo} ${link.cupo === 1 ? 'número' : 'números'}`);

    const order: any = await reserve(
      raffle,
      {
        ...input,
        canal: 'manual',
        pagada: true,
        confirmadaPor: link.creadoPor ?? undefined,
        sellerId: link.sellerId,
        respetarAsignacion: true,
        shareLinkId: link.id,
      },
      t,
    );
    await link.update({ usados: numeros.length, orderId: order.id }, { transaction: t });
    await audit(null, raffle.id, 'usar_enlace', 'enlace', link.id, { orderId: order.id, numeros }, t);
    return order;
  });
}

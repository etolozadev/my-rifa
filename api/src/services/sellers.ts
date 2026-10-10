import crypto from 'node:crypto';
import { QueryTypes, Transaction } from 'sequelize';
import { sequelize } from '../db';
import { conflict } from '../errors';
import { RaffleMember, Seller } from '../models';
import type { Role } from '../middleware/auth';
import { audit } from './raffles';

/** Código corto y no adivinable para el enlace del vendedor: /r/<slug>?v=<codigo> */
export const newSellerCode = () => crypto.randomBytes(6).toString('base64url');

/** [1,2,3,7,9,10] → "1-3, 7, 9-10" */
export function toRanges(nums: number[]): string {
  const sorted = [...nums].sort((a, b) => a - b);
  const out: string[] = [];
  for (let i = 0; i < sorted.length; i++) {
    const start = sorted[i];
    while (i + 1 < sorted.length && sorted[i + 1] === sorted[i] + 1) i++;
    out.push(start === sorted[i] ? String(start) : `${start}-${sorted[i]}`);
  }
  return out.join(', ');
}

/** Suma a alguien al equipo de la rifa. Un vendedor recibe (o recupera) su enlace propio. */
export async function addMember(raffleId: number, userId: number, rol: Exclude<Role, 'organizador'>, actorId: number | null, t: Transaction) {
  const already = await RaffleMember.findOne({ where: { raffleId, userId }, transaction: t });
  if (already) throw conflict('Esa persona ya es parte de la rifa');
  await RaffleMember.create({ raffleId, userId, rol }, { transaction: t });
  if (rol === 'vendedor') {
    const seller: any = await Seller.findOne({ where: { raffleId, userId }, transaction: t });
    if (seller) await seller.update({ activo: true }, { transaction: t });
    else await Seller.create({ raffleId, userId, codigoEnlace: newSellerCode() }, { transaction: t });
  }
  await audit(actorId, raffleId, rol === 'vendedor' ? 'agregar_vendedor' : 'agregar_editor', 'miembro', userId, {}, t);
}

/**
 * Quita a alguien del equipo. Un vendedor se desactiva (su enlace deja de funcionar y se le quitan los números
 * asignados que no vendió) pero sus ventas siguen atribuidas a él.
 */
export async function removeMember(raffleId: number, member: any, actorId: number, t: Transaction) {
  if (member.rol === 'vendedor') {
    const seller: any = await Seller.findOne({ where: { raffleId, userId: member.userId }, transaction: t });
    if (seller) {
      await seller.update({ activo: false }, { transaction: t });
      await sequelize.query(`UPDATE tickets SET seller_id = NULL WHERE seller_id = :sid AND estado = 'disponible'`, {
        replacements: { sid: seller.id },
        transaction: t,
      });
    }
  }
  await member.destroy({ transaction: t });
  await audit(actorId, raffleId, 'quitar_miembro', 'miembro', member.userId, { rol: member.rol }, t);
}

/** Vendedor activo de un usuario en una rifa (o null) */
export async function sellerOfUser(raffleId: number, userId: number): Promise<any> {
  return Seller.findOne({ where: { raffleId, userId, activo: true } });
}

/** Vendedor activo dueño de un código de enlace en una rifa (o null) */
export async function sellerByCode(raffleId: number, codigo: string | undefined): Promise<any> {
  if (!codigo) return null;
  return Seller.findOne({ where: { raffleId, codigoEnlace: codigo, activo: true }, include: [{ association: 'User', attributes: ['nombre'] }] });
}

export interface SellerStats {
  id: number;
  userId: number;
  nombre: string;
  email: string;
  codigoEnlace: string;
  activo: boolean;
  asignados: number;
  asignadosLibres: number;
  asignadosRangos: string;
  vendidos: number;
  reservados: number;
  recaudado: number;
  porCobrar: number;
}

/** Rendición por vendedor: números asignados, vendidos y reservados (por sus ventas), y montos. */
export async function sellerStats(raffle: any, sellerId?: number): Promise<SellerStats[]> {
  const rows = (await sequelize.query(
    `SELECT s.id, s.user_id AS "userId", u.nombre, u.email, s.codigo_enlace AS "codigoEnlace", s.activo,
       COALESCE((SELECT array_agg(t.numero ORDER BY t.numero) FROM tickets t WHERE t.seller_id = s.id), '{}') AS asignados,
       (SELECT count(*)::int FROM tickets t WHERE t.seller_id = s.id AND t.estado = 'disponible') AS "asignadosLibres",
       (SELECT count(*)::int FROM tickets t JOIN orders o ON o.id = t.order_id
         WHERE o.seller_id = s.id AND t.estado = 'pagado') AS vendidos,
       (SELECT count(*)::int FROM tickets t JOIN orders o ON o.id = t.order_id
         WHERE o.seller_id = s.id AND t.estado = 'reservado') AS reservados
     FROM sellers s JOIN users u ON u.id = s.user_id
     WHERE s.raffle_id = :raffleId ${sellerId ? 'AND s.id = :sellerId' : ''}
     ORDER BY s.activo DESC, u.nombre`,
    { replacements: { raffleId: raffle.id, sellerId }, type: QueryTypes.SELECT },
  )) as any[];
  return rows.map((r) => ({
    ...r,
    asignados: r.asignados.length,
    asignadosRangos: toRanges(r.asignados),
    recaudado: r.vendidos * raffle.precioNumero,
    porCobrar: r.reservados * raffle.precioNumero,
  }));
}

/** Asigna números libres a un vendedor (su talonario físico). Todo o nada. */
export async function assignNumbers(raffleId: number, sellerId: number, numeros: number[], actorId: number) {
  return sequelize.transaction(async (t) => {
    const rows = (await sequelize.query(
      `UPDATE tickets SET seller_id = :sellerId
       WHERE raffle_id = :raffleId AND numero IN (:numeros) AND estado = 'disponible'
         AND (seller_id IS NULL OR seller_id = :sellerId)
       RETURNING numero`,
      { replacements: { raffleId, sellerId, numeros }, type: QueryTypes.SELECT, transaction: t },
    )) as { numero: number }[];
    if (rows.length !== numeros.length) {
      const got = new Set(rows.map((r) => r.numero));
      throw conflict('Algunos números no están libres (vendidos, reservados o de otro vendedor)', {
        noDisponibles: numeros.filter((n) => !got.has(n)),
      });
    }
    await audit(actorId, raffleId, 'asignar_numeros', 'vendedor', sellerId, { numeros: toRanges(numeros) }, t);
    return rows.length;
  });
}

/** Devuelve al stock general los números asignados que el vendedor no vendió. */
export async function releaseNumbers(raffleId: number, sellerId: number, numeros: number[], actorId: number) {
  return sequelize.transaction(async (t) => {
    const rows = (await sequelize.query(
      `UPDATE tickets SET seller_id = NULL
       WHERE raffle_id = :raffleId AND seller_id = :sellerId AND numero IN (:numeros) AND estado = 'disponible'
       RETURNING numero`,
      { replacements: { raffleId, sellerId, numeros }, type: QueryTypes.SELECT, transaction: t },
    )) as { numero: number }[];
    await audit(actorId, raffleId, 'liberar_numeros', 'vendedor', sellerId, { numeros: toRanges(rows.map((r) => r.numero)) }, t);
    return rows.length;
  });
}

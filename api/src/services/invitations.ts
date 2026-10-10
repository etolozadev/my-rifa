import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import { sequelize } from '../db';
import { HttpError, conflict, notFound } from '../errors';
import { Invitation, Raffle, User } from '../models';
import { audit } from './raffles';
import { addMember } from './sellers';

const DAY_MS = 24 * 3600 * 1000;

export type InvitationState = 'vigente' | 'usada' | 'vencida' | 'revocada';

export function invitationState(i: any): InvitationState {
  if (i.usadaEn) return 'usada';
  if (i.revocadaEn) return 'revocada';
  if (new Date(i.venceEn).getTime() <= Date.now()) return 'vencida';
  return 'vigente';
}

export const invitationView = (i: any) => ({
  id: i.id,
  token: i.token,
  rol: i.rol,
  estado: invitationState(i),
  creadoEn: i.creadoEn,
  venceEn: i.venceEn,
  usadaEn: i.usadaEn,
});

export async function createInvitation(raffleId: number, rol: 'editor' | 'vendedor', venceDias: number, actorId: number) {
  const inv: any = await Invitation.create({
    raffleId,
    token: crypto.randomBytes(18).toString('base64url'),
    rol,
    creadoPor: actorId,
    creadoEn: new Date(),
    venceEn: new Date(Date.now() + venceDias * DAY_MS),
  });
  await audit(actorId, raffleId, 'invitar', 'invitacion', inv.id, { rol });
  return inv;
}

/** Datos públicos de una invitación (sin el token de nadie más) */
export async function invitationInfo(token: string) {
  const inv: any = await Invitation.findOne({ where: { token } });
  if (!inv) throw notFound('Invitación no encontrada');
  const raffle: any = await Raffle.findByPk(inv.raffleId);
  const by: any = inv.creadoPor ? await User.findByPk(inv.creadoPor) : null;
  return { estado: invitationState(inv), rol: inv.rol, rifa: { id: raffle.id, nombre: raffle.nombre }, invitadoPor: by?.nombre ?? null };
}

export interface NewAccount {
  nombre: string;
  email: string;
  password: string;
}

/**
 * Acepta la invitación. Con sesión, suma a ese usuario; sin sesión crea la cuenta con los datos dados
 * (aunque ALLOW_REGISTRATION=false: la invitación es la autorización). De un solo uso.
 */
export async function acceptInvitation(token: string, sessionUserId: number | null, account?: NewAccount) {
  // El hash se calcula fuera de la transacción (es lento a propósito)
  const passwordHash = !sessionUserId && account ? await bcrypt.hash(account.password, 12) : null;
  return sequelize.transaction(async (t) => {
    const inv: any = await Invitation.findOne({ where: { token }, transaction: t, lock: t.LOCK.UPDATE });
    if (!inv) throw notFound('Invitación no encontrada');
    const state = invitationState(inv);
    if (state !== 'vigente') throw conflict(state === 'usada' ? 'Esta invitación ya se usó' : `La invitación está ${state}`);

    let userId = sessionUserId;
    if (!userId) {
      if (!account || !passwordHash) throw new HttpError(400, 'account_required', 'Crea tu cuenta o inicia sesión para aceptar');
      const email = account.email.toLowerCase();
      if (await User.findOne({ where: { email }, transaction: t })) {
        throw new HttpError(409, 'account_exists', 'Ya existe una cuenta con ese correo: inicia sesión para aceptar la invitación');
      }
      const user: any = await User.create({ nombre: account.nombre, email, passwordHash, creadoEn: new Date() }, { transaction: t });
      userId = user.id as number;
    }

    await addMember(inv.raffleId, userId, inv.rol, inv.creadoPor ?? null, t);
    await inv.update({ usadaPor: userId, usadaEn: new Date() }, { transaction: t });
    await audit(userId, inv.raffleId, 'aceptar_invitacion', 'invitacion', inv.id, { rol: inv.rol }, t);
    return { userId, raffleId: inv.raffleId as number, rol: inv.rol as string };
  });
}

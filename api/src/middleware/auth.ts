import type { NextFunction, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { config, isProd } from '../config';
import { forbidden, unauthorized } from '../errors';
import { RaffleMember } from '../models';

export type Role = 'organizador' | 'editor' | 'vendedor';
export interface AuthedRequest extends Request {
  userId: number;
}

const COOKIE = 'session';

export function setSession(res: Response, userId: number) {
  const token = jwt.sign({ sub: userId }, config.JWT_SECRET, { expiresIn: '7d' });
  res.cookie(COOKIE, token, {
    httpOnly: true,
    secure: isProd,
    sameSite: 'lax',
    maxAge: 7 * 24 * 3600 * 1000,
    path: '/',
  });
}

export const clearSession = (res: Response) => res.clearCookie(COOKIE, { path: '/' });

export function requireAuth(req: Request, _res: Response, next: NextFunction) {
  try {
    const token = req.cookies?.[COOKIE];
    if (!token) throw unauthorized();
    const payload = jwt.verify(token, config.JWT_SECRET) as unknown as { sub: number };
    (req as AuthedRequest).userId = payload.sub;
    next();
  } catch (e: any) {
    next(e?.status ? e : unauthorized('Sesión inválida o vencida'));
  }
}

/**
 * Protección CSRF para rutas autenticadas: además de SameSite=Lax, toda petición
 * que cambia datos debe traer la cabecera X-Requested-With (un formulario de otro
 * sitio no puede añadirla) y CORS solo acepta el origen del front.
 */
export function csrfGuard(req: Request, _res: Response, next: NextFunction) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  if (req.get('x-requested-with') !== 'mis-rifas') return next(forbidden('Falta la cabecera X-Requested-With'));
  next();
}

export async function memberRole(userId: number, raffleId: number): Promise<Role | null> {
  const m: any = await RaffleMember.findOne({ where: { userId, raffleId } });
  return m ? (m.rol as Role) : null;
}

/** Verifica el rol del usuario DENTRO de la rifa; nunca se confía en el front. */
export async function assertRole(userId: number, raffleId: number, roles: Role[]): Promise<Role> {
  const rol = await memberRole(userId, raffleId);
  if (!rol || !roles.includes(rol)) throw forbidden();
  return rol;
}

export const raffleRole =
  (...roles: Role[]) =>
  async (req: Request, _res: Response, next: NextFunction) => {
    try {
      const raffleId = Number(req.params.id);
      if (!Number.isInteger(raffleId)) throw forbidden();
      (req as any).role = await assertRole((req as AuthedRequest).userId, raffleId, roles);
      next();
    } catch (e) {
      next(e);
    }
  };

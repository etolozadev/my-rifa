import bcrypt from 'bcryptjs';
import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { config } from '../config';
import { HttpError, unauthorized, wrap } from '../errors';
import { clearSession, csrfGuard, requireAuth, setSession, AuthedRequest } from '../middleware/auth';
import { User } from '../models';

export const authRouter = Router();

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
  skip: () => config.NODE_ENV === 'test',
});

// Hash de relleno: el tiempo de respuesta no revela si el correo existe
const DUMMY_HASH = bcrypt.hashSync('relleno-para-igualar-tiempos', 12);

const credentials = z.object({ email: z.string().email().max(200), password: z.string().min(1).max(200) });

authRouter.post(
  '/login',
  limiter,
  wrap(async (req, res) => {
    const { email, password } = credentials.parse(req.body);
    const user: any = await User.findOne({ where: { email: email.toLowerCase() } });
    const ok = await bcrypt.compare(password, user?.passwordHash ?? DUMMY_HASH);
    if (!user || !ok) throw unauthorized('Correo o contraseña incorrectos');
    setSession(res, user.id);
    res.json({ id: user.id, nombre: user.nombre, email: user.email });
  }),
);

authRouter.post('/logout', csrfGuard, (_req, res) => {
  clearSession(res);
  res.status(204).end();
});

authRouter.get(
  '/me',
  requireAuth,
  wrap(async (req, res) => {
    const user: any = await User.findByPk((req as AuthedRequest).userId);
    if (!user) throw unauthorized();
    res.json({ id: user.id, nombre: user.nombre, email: user.email });
  }),
);

// Deshabilitado por defecto: en un uso personal las cuentas se crean con `npm run user:create`
authRouter.post(
  '/register',
  limiter,
  wrap(async (req, res) => {
    if (!config.ALLOW_REGISTRATION) throw new HttpError(403, 'registration_disabled', 'El registro está deshabilitado');
    const body = credentials.extend({ nombre: z.string().min(1).max(100), password: z.string().min(10).max(200) }).parse(req.body);
    const exists = await User.findOne({ where: { email: body.email.toLowerCase() } });
    if (exists) throw new HttpError(409, 'conflict', 'Ese correo ya está registrado');
    const user: any = await User.create({
      nombre: body.nombre,
      email: body.email.toLowerCase(),
      passwordHash: await bcrypt.hash(body.password, 12),
    });
    setSession(res, user.id);
    res.status(201).json({ id: user.id, nombre: user.nombre, email: user.email });
  }),
);

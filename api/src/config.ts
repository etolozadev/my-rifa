import 'dotenv/config';
import { z } from 'zod';

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().default(3000),
  DATABASE_URL: z.string().min(1),
  JWT_SECRET: z.string().min(16, 'JWT_SECRET debe tener al menos 16 caracteres'),
  UPLOADS_DIR: z.string().default('./storage/comprobantes'),
  WEB_ORIGIN: z.string().default('http://localhost:5173'),
  ALLOW_REGISTRATION: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),
  // Avisos por correo al equipo (opcional): smtp://usuario:clave@servidor:587 o smtps://…:465.
  // Sin SMTP_URL no se envían correos (la plataforma funciona igual).
  SMTP_URL: z.string().optional(),
  MAIL_FROM: z.string().default('mis-rifas <no-responder@localhost>'),
});

export const config = schema.parse(process.env);
export const isProd = config.NODE_ENV === 'production';

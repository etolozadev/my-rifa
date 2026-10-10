import cookieParser from 'cookie-parser';
import cors from 'cors';
import express from 'express';
import helmet from 'helmet';
import { config } from './config';
import { errorHandler, notFound } from './errors';
import { adminRouter } from './routes/admin';
import { authRouter } from './routes/auth';
import { publicRouter } from './routes/public';
import { sharedRouter } from './routes/shared';

export function createApp() {
  const app = express();
  app.set('trust proxy', 1); // detrás de Nginx: la IP real llega en X-Forwarded-For
  app.use(helmet());
  app.use(cors({ origin: config.WEB_ORIGIN, credentials: true }));
  app.use(express.json({ limit: '100kb' }));
  app.use(cookieParser());

  app.get('/api/health', (_req, res) => res.json({ ok: true }));
  app.use('/api/auth', authRouter);
  app.use('/api/admin', adminRouter);
  app.use('/api', sharedRouter);
  app.use('/api', publicRouter);
  app.use('/api', (_req, _res, next) => next(notFound('Ruta no encontrada')));
  app.use(errorHandler);
  return app;
}

import type { ErrorRequestHandler } from 'express';
import { ZodError } from 'zod';

export class HttpError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details?: unknown,
  ) {
    super(message);
  }
}

export const badRequest = (msg: string, details?: unknown) => new HttpError(400, 'bad_request', msg, details);
export const unauthorized = (msg = 'Debes iniciar sesión') => new HttpError(401, 'unauthorized', msg);
export const forbidden = (msg = 'No tienes permiso para esto') => new HttpError(403, 'forbidden', msg);
export const notFound = (msg = 'No encontrado') => new HttpError(404, 'not_found', msg);
export const conflict = (msg: string, details?: unknown) => new HttpError(409, 'conflict', msg, details);

export const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
  if (err instanceof HttpError) {
    res.status(err.status).json({ error: { code: err.code, message: err.message, details: err.details } });
    return;
  }
  if (err instanceof ZodError) {
    res.status(400).json({
      error: {
        code: 'validation',
        message: 'Datos inválidos',
        details: err.issues.map((i) => ({ campo: i.path.join('.'), mensaje: i.message })),
      },
    });
    return;
  }
  if (err?.code === 'LIMIT_FILE_SIZE') {
    res.status(413).json({ error: { code: 'file_too_large', message: 'El archivo supera el máximo de 5 MB' } });
    return;
  }
  console.error(err);
  res.status(500).json({ error: { code: 'internal', message: 'Error interno' } });
};

// Envuelve handlers async para que los errores lleguen a errorHandler
export const wrap =
  (fn: (req: any, res: any, next: any) => Promise<unknown>) =>
  (req: any, res: any, next: any) =>
    fn(req, res, next).catch(next);

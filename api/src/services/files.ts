import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { config } from '../config';
import { badRequest } from '../errors';

export const MAX_BYTES = 5 * 1024 * 1024;

/** Detecta el tipo real por la firma del archivo (no se confía en el nombre ni en el mime del cliente). */
export function sniff(buf: Buffer): { mime: string; ext: string } | null {
  if (buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return { mime: 'image/jpeg', ext: 'jpg' };
  if (buf.length > 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])))
    return { mime: 'image/png', ext: 'png' };
  if (buf.length > 12 && buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP')
    return { mime: 'image/webp', ext: 'webp' };
  if (buf.length > 4 && buf.toString('ascii', 0, 5) === '%PDF-') return { mime: 'application/pdf', ext: 'pdf' };
  return null;
}

const dir = () => path.resolve(config.UPLOADS_DIR);

export async function saveProof(buf: Buffer) {
  const kind = sniff(buf);
  if (!kind) throw badRequest('Solo se aceptan imágenes (JPG, PNG, WebP) o PDF');
  await fs.mkdir(dir(), { recursive: true });
  const archivo = `${crypto.randomBytes(16).toString('hex')}.${kind.ext}`;
  await fs.writeFile(path.join(dir(), archivo), buf, { flag: 'wx' });
  return { archivo, ...kind };
}

export const proofPath = (archivo: string) => path.join(dir(), path.basename(archivo));

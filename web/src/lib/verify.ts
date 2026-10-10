/**
 * Verificación del sorteo en el navegador: la posición ganadora es SHA-256(semilla) leído como
 * entero, módulo la cantidad de participantes (la misma cuenta que hace la API al sortear).
 */
export async function pickPosition(semilla: string, participantes: number): Promise<number> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(semilla));
  const hex = Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
  return Number(BigInt(`0x${hex}`) % BigInt(participantes));
}

export type VerifyResult = { ok: true; posicion: number } | { ok: false; reason: string };

/** Comprueba que el número publicado sale de la semilla y de la lista de participantes. */
export async function verifyDraw(draw: { semilla: string | null; numero: number; posicion: number | null }, numeros: number[]): Promise<VerifyResult> {
  if (!draw.semilla) return { ok: false, reason: 'Este sorteo no se hizo al azar en la plataforma' };
  if (!numeros.length) return { ok: false, reason: 'No hay lista de participantes' };
  const sorted = [...numeros].sort((a, b) => a - b);
  if (sorted.some((n, i) => n !== numeros[i])) return { ok: false, reason: 'La lista de participantes no está ordenada' };
  const posicion = await pickPosition(draw.semilla, numeros.length);
  if (posicion !== draw.posicion) return { ok: false, reason: `La semilla da la posición ${posicion + 1}, no la ${(draw.posicion ?? 0) + 1}` };
  if (numeros[posicion] !== draw.numero) return { ok: false, reason: `En esa posición está el número ${numeros[posicion]}, no el ${draw.numero}` };
  return { ok: true, posicion };
}

import type { PublicRaffle } from './api';

/** Números que componen el talonario k (numeración global: (k-1)·M+1 … k·M). */
export function bookletNumbers(k: number, perBooklet: number): number[] {
  return Array.from({ length: perBooklet }, (_, i) => (k - 1) * perBooklet + i + 1);
}

/** Talonario al que pertenece un número: con 10 por talonario, el 1051 es del talonario 106 */
export const bookletOf = (n: number, perBooklet: number) => Math.floor((n - 1) / perBooklet) + 1;

export interface BookletGroup {
  talonario: number;
  numeros: number[];
  /** Están los M números del talonario */
  completo: boolean;
}

/** Agrupa números por talonario, en orden: [1051…1060, 1075] → talonario 106 completo y talonario 108 con el 1075 */
export function groupByBooklet(numeros: number[], perBooklet: number): BookletGroup[] {
  const groups = new Map<number, number[]>();
  for (const n of [...numeros].sort((a, b) => a - b)) {
    const k = bookletOf(n, perBooklet);
    groups.set(k, [...(groups.get(k) ?? []), n]);
  }
  return [...groups].map(([talonario, nums]) => ({ talonario, numeros: nums, completo: new Set(nums).size === perBooklet }));
}

/** Si la selección es exactamente un talonario completo devuelve su número, si no null. */
export function exactBooklet(selection: Iterable<number>, perBooklet: number, booklets: number): number | null {
  const sel = [...selection].sort((a, b) => a - b);
  if (sel.length !== perBooklet || perBooklet < 1) return null;
  const k = Math.floor((sel[0] - 1) / perBooklet) + 1;
  if (k > booklets) return null;
  const expected = bookletNumbers(k, perBooklet);
  return expected.every((n, i) => n === sel[i]) ? k : null;
}

/** ¿Están todos los números del talonario disponibles? */
export function bookletIsFree(k: number, raffle: Pick<PublicRaffle, 'numerosPorTalonario' | 'numeros'>): boolean {
  const nums = new Set(bookletNumbers(k, raffle.numerosPorTalonario));
  const states = raffle.numeros.filter((x) => nums.has(x.n));
  return states.length === nums.size && states.every((x) => x.e === 'disponible');
}

/** Quita de la selección los números que ya no están disponibles. */
export function pruneSelection(selection: Set<number>, raffle: Pick<PublicRaffle, 'numeros'>): Set<number> {
  const free = new Set(raffle.numeros.filter((x) => x.e === 'disponible').map((x) => x.n));
  return new Set([...selection].filter((n) => free.has(n)));
}

export function toggleNumber(selection: Set<number>, n: number): Set<number> {
  const next = new Set(selection);
  if (next.has(n)) next.delete(n);
  else next.add(n);
  return next;
}

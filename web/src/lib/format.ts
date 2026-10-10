const clp = new Intl.NumberFormat('es-CL', { style: 'currency', currency: 'CLP', maximumFractionDigits: 0 });
export const money = (n: number) => clp.format(n);

const dateFmt = new Intl.DateTimeFormat('es-CL', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' });
const shortFmt = new Intl.DateTimeFormat('es-CL', { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' });
export const longDate = (iso: string) => dateFmt.format(new Date(iso));
export const shortDate = (iso: string) => shortFmt.format(new Date(iso));

const dayFmt = new Intl.DateTimeFormat('es-CL', { weekday: 'long', day: 'numeric', month: 'long' });
const timeFmt = new Intl.DateTimeFormat('es-CL', { hour: '2-digit', minute: '2-digit', hour12: false });
/** "Miércoles 21 de octubre" */
export const dayLabel = (iso: string) => {
  const t = dayFmt.format(new Date(iso)).replace(',', '');
  return t.charAt(0).toUpperCase() + t.slice(1);
};
/** "01:01" */
export const timeLabel = (iso: string) => timeFmt.format(new Date(iso));

/** "faltan 3 días", "falta 1 día", "faltan 5 horas", "ya pasó" */
export function timeLeft(iso: string, now = Date.now()): string {
  const ms = new Date(iso).getTime() - now;
  if (ms <= 0) return 'ya pasó';
  const hours = Math.floor(ms / 3_600_000);
  if (hours < 1) return 'falta menos de 1 hora';
  if (hours < 48) return `${hours === 1 ? 'falta' : 'faltan'} ${hours} ${hours === 1 ? 'hora' : 'horas'}`;
  const days = Math.floor(hours / 24);
  return `faltan ${days} días`;
}

export const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

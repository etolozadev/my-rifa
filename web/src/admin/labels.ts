import type { AdminOrder, OrderState, RaffleState } from '../lib/admin';

type Badge = { label: string; cls: '' | 'warn' | 'ok' | 'bad' | 'neutral' };

export const RAFFLE_STATE: Record<RaffleState, Badge> = {
  borrador: { label: 'Borrador', cls: 'neutral' },
  activa: { label: 'Activa', cls: 'ok' },
  cerrada: { label: 'Venta cerrada', cls: 'warn' },
  sorteada: { label: 'Sorteada', cls: '' },
};

export const ORDER_STATE: Record<OrderState, Badge> = {
  pendiente: { label: 'Pendiente', cls: 'warn' },
  pagada: { label: 'Pagada', cls: 'ok' },
  vencida: { label: 'Vencida', cls: 'bad' },
  cancelada: { label: 'Cancelada', cls: 'neutral' },
};

export const CHANNEL: Record<AdminOrder['canal'], string> = {
  web: 'Web',
  fisica: 'Talonario físico',
  manual: 'Registrada por el equipo',
};

export const PURPOSE = { beneficio: 'A beneficio', viaje: 'Viaje de estudio', otro: 'Otro' } as const;

export type TicketState = 'disponible' | 'reservado' | 'pagado';

export interface BankData {
  banco: string | null;
  tipoCuenta: string | null;
  numeroCuenta: string | null;
  titular: string | null;
  rut: string | null;
  emailAviso: string | null;
}

export interface PublicRaffle {
  slug: string;
  nombre: string;
  proposito: 'beneficio' | 'viaje' | 'otro';
  objetivo: string;
  metaMonto: number;
  precioNumero: number;
  precioTalonario: number;
  cantidadTalonarios: number;
  numerosPorTalonario: number;
  maxNumerosPorOrden: number;
  ttlReservaDias: number;
  fechaSorteo: string;
  estado: 'activa' | 'cerrada' | 'sorteada';
  numeroAutorizacion: string | null;
  datosBancarios: BankData | null;
  premios: { orden: number; nombre: string; descripcion: string; imagenUrl: string | null }[];
  avance: {
    recaudado: number;
    metaMonto: number;
    disponibles: number;
    reservados: number;
    pagados: number;
    talonariosDisponibles: number;
  };
  numeros: { n: number; e: TicketState }[];
  /** Presente cuando se compra con el enlace de un vendedor (?v=) */
  vendedor?: { nombre: string } | null;
  /** Resultados del sorteo, incluidos los anulados (con su motivo) */
  sorteos?: PublicDraw[];
}

export interface PublicDraw {
  id: number;
  /** premio: el ganador. agua: un número que salió antes del ganador y quedó eliminado de la rifa */
  tipo: 'premio' | 'agua';
  premio: { id: number; orden: number; nombre: string };
  numero: number;
  modo: 'aleatorio' | 'manual';
  semilla: string | null;
  participantes: number;
  posicion: number | null;
  detalle: string | null;
  sorteadoEn: string;
  anuladoEn: string | null;
  motivoAnulacion: string | null;
}

export interface PrepaidLink {
  estado: 'vigente' | 'usado' | 'vencido' | 'revocado';
  cupo: number;
  venceEn: string;
  compradorNombre: string | null;
  ordenToken: string | null;
  rifa: PublicRaffle;
}

export interface InvitationInfo {
  estado: 'vigente' | 'usada' | 'vencida' | 'revocada';
  rol: 'editor' | 'vendedor';
  rifa: { id: number; nombre: string };
  invitadoPor: string | null;
  conSesion: boolean;
}

export interface PublicOrder {
  estado: 'pendiente' | 'pagada' | 'vencida' | 'cancelada';
  numeros: number[];
  monto: number;
  compradorNombre: string;
  creadaEn: string;
  venceEn: string;
  rifa: { nombre: string; slug: string; fechaSorteo: string; estado?: PublicRaffle['estado'] };
  datosBancarios: BankData | null;
  comprobantes: { id: number; nombre: string; subidoEn: string }[];
  /** Premios que ganaron los números de esta orden */
  premios?: { numero: number; orden: number; nombre: string }[];
}

export interface ReserveBody {
  tipo: 'numeros' | 'talonario';
  numeros?: number[];
  talonario?: number;
  compradorNombre: string;
  compradorContacto: string;
  /** Código del enlace del vendedor */
  vendedor?: string;
}

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details?: any,
  ) {
    super(message);
  }
}

export async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`/api${path}`, init);
  } catch {
    throw new ApiError(0, 'network', 'No hay conexión. Revisa tu internet e inténtalo de nuevo.');
  }
  if (res.status === 204) return undefined as T;
  const body = await res.json().catch(() => null);
  if (!res.ok) {
    const e = body?.error;
    throw new ApiError(res.status, e?.code ?? 'error', e?.message ?? 'Ocurrió un error inesperado', e?.details);
  }
  return body as T;
}

export const api = {
  getRaffle: (slug: string, vendedor?: string | null) =>
    request<PublicRaffle>(`/rifas/${encodeURIComponent(slug)}${vendedor ? `?v=${encodeURIComponent(vendedor)}` : ''}`),
  reserve: (slug: string, body: ReserveBody) =>
    request<{ token: string; numeros: number[]; monto: number; venceEn: string }>(`/rifas/${encodeURIComponent(slug)}/ordenes`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),
  getOrder: (token: string) => request<PublicOrder>(`/ordenes/${encodeURIComponent(token)}`),
  uploadProof: (token: string, file: File) => {
    const form = new FormData();
    form.append('archivo', file);
    return request<{ id: number; nombre: string; subidoEn: string }>(`/ordenes/${encodeURIComponent(token)}/comprobantes`, {
      method: 'POST',
      body: form,
    });
  },
  proofUrl: (token: string, id: number) => `/api/ordenes/${encodeURIComponent(token)}/comprobantes/${id}`,

  drawParticipants: (slug: string, drawId: number) =>
    request<{ numeros: number[] }>(`/rifas/${encodeURIComponent(slug)}/sorteos/${drawId}/participantes`),

  getLink: (token: string) => request<PrepaidLink>(`/enlaces/${encodeURIComponent(token)}`),
  useLink: (token: string, body: Omit<ReserveBody, 'vendedor'>) =>
    request<{ token: string; numeros: number[]; monto: number }>(`/enlaces/${encodeURIComponent(token)}/usar`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),

  getInvitation: (token: string) => request<InvitationInfo>(`/invitaciones/${encodeURIComponent(token)}`),
  acceptInvitation: (token: string, account?: { nombre: string; email: string; password: string }) =>
    request<{ raffleId: number; rol: string }>(`/invitaciones/${encodeURIComponent(token)}/aceptar`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'mis-rifas' },
      body: JSON.stringify(account ?? {}),
    }),
};

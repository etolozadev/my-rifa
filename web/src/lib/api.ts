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
}

export interface PublicOrder {
  estado: 'pendiente' | 'pagada' | 'vencida' | 'cancelada';
  numeros: number[];
  monto: number;
  compradorNombre: string;
  creadaEn: string;
  venceEn: string;
  rifa: { nombre: string; slug: string; fechaSorteo: string };
  datosBancarios: BankData | null;
  comprobantes: { id: number; nombre: string; subidoEn: string }[];
}

export interface ReserveBody {
  tipo: 'numeros' | 'talonario';
  numeros?: number[];
  talonario?: number;
  compradorNombre: string;
  compradorContacto: string;
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

async function request<T>(path: string, init?: RequestInit): Promise<T> {
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
  getRaffle: (slug: string) => request<PublicRaffle>(`/rifas/${encodeURIComponent(slug)}`),
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
};

import { request, type PublicDraw } from './api';

export interface User {
  id: number;
  nombre: string;
  email: string;
}

export type Rol = 'organizador' | 'editor' | 'vendedor';
export type RaffleState = 'borrador' | 'activa' | 'cerrada' | 'sorteada';
export type OrderState = 'pendiente' | 'pagada' | 'vencida' | 'cancelada';
export type TicketState = 'disponible' | 'reservado' | 'pagado';

export interface RaffleListItem {
  id: number;
  slug: string;
  nombre: string;
  estado: RaffleState;
  fechaSorteo: string;
  metaMonto: number;
  rol: Rol;
}

/** Campos editables de una rifa (lo que acepta POST /rifas y PATCH /rifas/:id) */
export interface RaffleInput {
  nombre: string;
  proposito: 'beneficio' | 'viaje' | 'otro';
  objetivo: string;
  metaMonto: number;
  precioNumero: number;
  cantidadTalonarios: number;
  numerosPorTalonario: number;
  maxNumerosPorOrden: number;
  ttlReservaDias: number;
  fechaSorteo: string;
  numeroAutorizacion: string | null;
  bancoNombre: string | null;
  bancoTipoCuenta: string | null;
  bancoNumeroCuenta: string | null;
  bancoTitular: string | null;
  bancoRut: string | null;
  bancoEmailAviso: string | null;
}

export interface Prize {
  id: number;
  orden: number;
  nombre: string;
  descripcion: string;
  imagenUrl: string | null;
}
export type PrizeInput = Omit<Prize, 'id'>;

export interface Summary {
  disponibles: number;
  reservados: number;
  pagados: number;
  total: number;
  talonariosDisponibles: number;
  recaudado: number;
  porCobrar: number;
  metaMonto: number;
}

export interface AdminRaffle extends RaffleInput {
  id: number;
  slug: string;
  estado: RaffleState;
  premios: Prize[];
  rol: Rol;
  resumen: Summary;
  /** Solo cuando quien mira es vendedor: su enlace y su rendición */
  vendedor: SellerStats | null;
}

export interface SellerStats {
  id: number;
  userId: number;
  nombre: string;
  email: string;
  codigoEnlace: string;
  activo: boolean;
  asignados: number;
  asignadosLibres: number;
  asignadosRangos: string;
  vendidos: number;
  reservados: number;
  recaudado: number;
  porCobrar: number;
}

export type LinkState = 'vigente' | 'usado' | 'vencido' | 'revocado';
export interface ShareLinkView {
  id: number;
  token: string;
  cupo: number;
  estado: LinkState;
  venceEn: string;
  creadoEn: string;
  compradorNombre: string | null;
  compradorContacto: string | null;
  ordenId: number | null;
  vendedorId: number | null;
  vendedorNombre: string | null;
}

export type InvitationState = 'vigente' | 'usada' | 'vencida' | 'revocada';
export interface InvitationView {
  id: number;
  token: string;
  rol: 'editor' | 'vendedor';
  estado: InvitationState;
  creadoEn: string;
  venceEn: string;
  usadaEn: string | null;
}

export interface BulkSale {
  numeros: number[];
  compradorNombre: string;
  compradorContacto: string;
  pagada: boolean;
  vendedorId?: number | null;
}
export interface BulkResult {
  creadas: number;
  fallidas: number;
  resultados: { fila: number; ok: boolean; ordenId?: number; numeros?: number[]; error?: string; noDisponibles?: number[] }[];
}

export interface AdminOrder {
  id: number;
  tipo: 'numeros' | 'talonario';
  canal: 'web' | 'fisica' | 'manual';
  compradorNombre: string;
  compradorContacto: string;
  numeros: number[];
  monto: number;
  estado: OrderState;
  creadaEn: string;
  venceEn: string;
  pagadaEn: string | null;
  sellerId: number | null;
  vendedorNombre: string | null;
  shareLinkId: number | null;
  comprobantes: { id: number; nombreOriginal: string; subidoEn: string }[];
}

export interface AdminTicket {
  numero: number;
  talonario: number;
  estado: TicketState;
  ordenId: number | null;
  compradorNombre: string | null;
  compradorContacto: string | null;
  fecha: string | null;
  canal: AdminOrder['canal'] | null;
  /** Vendedor que tiene el número en su talonario físico */
  vendedorId: number | null;
  vendedorNombre: string | null;
}

export interface Member {
  userId: number;
  nombre: string;
  email: string;
  rol: Rol;
}

export interface ManualSaleInput {
  tipo: 'numeros' | 'talonario';
  numeros?: number[];
  talonario?: number;
  compradorNombre: string;
  compradorContacto: string;
  canal: 'fisica' | 'manual';
  pagada: boolean;
  vendedorId?: number | null;
}

// Toda petición que cambia datos lleva esta cabecera (protección CSRF de la API)
const CSRF = { 'X-Requested-With': 'mis-rifas' };

function send<T>(method: string, path: string, body?: unknown) {
  return request<T>(path, {
    method,
    headers: body === undefined ? CSRF : { ...CSRF, 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

const qs = (estado?: string) => (estado ? `?estado=${encodeURIComponent(estado)}` : '');

export const adminApi = {
  me: () => request<User>('/auth/me'),
  login: (email: string, password: string) => send<User>('POST', '/auth/login', { email, password }),
  logout: () => send<void>('POST', '/auth/logout'),

  raffles: () => request<RaffleListItem[]>('/admin/rifas'),
  raffle: (id: number) => request<AdminRaffle>(`/admin/rifas/${id}`),
  createRaffle: (body: RaffleInput) => send<{ id: number; slug: string }>('POST', '/admin/rifas', body),
  updateRaffle: (id: number, body: Partial<RaffleInput> & { estado?: RaffleState }) =>
    send<AdminRaffle>('PATCH', `/admin/rifas/${id}`, body),

  addPrize: (id: number, body: PrizeInput) => send<Prize>('POST', `/admin/rifas/${id}/premios`, body),
  updatePrize: (id: number, prizeId: number, body: Partial<PrizeInput>) =>
    send<Prize>('PATCH', `/admin/rifas/${id}/premios/${prizeId}`, body),
  deletePrize: (id: number, prizeId: number) => send<void>('DELETE', `/admin/rifas/${id}/premios/${prizeId}`),

  members: (id: number) => request<Member[]>(`/admin/rifas/${id}/miembros`),
  addEditor: (id: number, email: string) => send<Member>('POST', `/admin/rifas/${id}/miembros`, { email }),
  removeMember: (id: number, userId: number) => send<void>('DELETE', `/admin/rifas/${id}/miembros/${userId}`),

  tickets: (id: number, estado?: TicketState) => request<AdminTicket[]>(`/admin/rifas/${id}/numeros${qs(estado)}`),
  orders: (id: number, estado?: OrderState) => request<AdminOrder[]>(`/admin/rifas/${id}/ordenes${qs(estado)}`),
  manualSale: (id: number, body: ManualSaleInput) =>
    send<{ id: number; estado: OrderState; numeros: number[]; monto: number }>('POST', `/admin/rifas/${id}/ordenes-manuales`, body),

  confirmOrder: (orderId: number) => send<{ id: number; estado: OrderState }>('POST', `/admin/ordenes/${orderId}/confirmar`),
  cancelOrder: (orderId: number) => send<{ id: number; estado: OrderState }>('POST', `/admin/ordenes/${orderId}/cancelar`),
  extendOrder: (orderId: number, dias: number) =>
    send<{ id: number; estado: OrderState; venceEn: string }>('POST', `/admin/ordenes/${orderId}/extender`, { dias }),

  proofUrl: (proofId: number) => `/api/admin/comprobantes/${proofId}`,

  addMember: (id: number, email: string, rol: 'editor' | 'vendedor') => send<Member>('POST', `/admin/rifas/${id}/miembros`, { email, rol }),

  sellers: (id: number) => request<SellerStats[]>(`/admin/rifas/${id}/vendedores`),
  assign: (id: number, sellerId: number, numeros: number[]) =>
    send<{ asignados: number; vendedor: SellerStats }>('POST', `/admin/rifas/${id}/vendedores/${sellerId}/asignar`, { numeros }),
  release: (id: number, sellerId: number, numeros: number[]) =>
    send<{ liberados: number; vendedor: SellerStats }>('POST', `/admin/rifas/${id}/vendedores/${sellerId}/liberar`, { numeros }),

  bulkSales: (id: number, ventas: BulkSale[], canal: 'fisica' | 'manual' = 'fisica') =>
    send<BulkResult>('POST', `/admin/rifas/${id}/ventas-lote`, { canal, ventas }),

  links: (id: number) => request<ShareLinkView[]>(`/admin/rifas/${id}/enlaces`),
  createLink: (id: number, body: { cupo: number; venceDias: number; compradorNombre: string | null; compradorContacto: string | null }) =>
    send<ShareLinkView>('POST', `/admin/rifas/${id}/enlaces`, body),
  revokeLink: (linkId: number) => send<ShareLinkView>('POST', `/admin/enlaces/${linkId}/revocar`),

  invitations: (id: number) => request<InvitationView[]>(`/admin/rifas/${id}/invitaciones`),
  createInvitation: (id: number, rol: 'editor' | 'vendedor') => send<InvitationView>('POST', `/admin/rifas/${id}/invitaciones`, { rol }),
  revokeInvitation: (invId: number) => send<InvitationView>('POST', `/admin/invitaciones/${invId}/revocar`),

  draws: (id: number) => request<AdminDraw[]>(`/admin/rifas/${id}/sorteos`),
  drawPrize: (id: number, body: DrawInput) => send<AdminDraw>('POST', `/admin/rifas/${id}/sorteos`, body),
  annulDraw: (drawId: number, motivo: string) => send<AdminDraw>('POST', `/admin/sorteos/${drawId}/anular`, { motivo }),
};

export interface AdminDraw extends PublicDraw {
  ordenId: number | null;
  compradorNombre: string | null;
  compradorContacto: string | null;
  vendedorNombre: string | null;
}

export interface DrawInput {
  premioId: number;
  modo: 'aleatorio' | 'manual';
  numero?: number;
  detalle?: string;
  confirmarPendientes?: boolean;
}

/** Enlace de venta de un vendedor */
export const sellerUrl = (slug: string, codigo: string) => `${window.location.origin}/r/${slug}?v=${encodeURIComponent(codigo)}`;
export const shareLinkUrl = (token: string) => `${window.location.origin}/e/${token}`;
export const invitationUrl = (token: string) => `${window.location.origin}/invitacion/${token}`;

/** Divide una línea por ; o tabulador respetando comillas dobles ("4, 7";Juan) */
function splitLine(line: string): string[] {
  const sep = line.includes(';') ? ';' : '\t';
  const out: string[] = [];
  let cur = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') {
      if (quoted && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else quoted = !quoted;
    } else if (c === sep && !quoted) {
      out.push(cur.trim());
      cur = '';
    } else cur += c;
  }
  out.push(cur.trim());
  return out;
}

export type BulkRow = { linea: number; venta?: BulkSale; error?: string };

/**
 * Carga rápida: una venta por línea, "números; nombre; contacto[; pagada]".
 * Los números aceptan rangos (10-12). Se ignoran líneas vacías y un encabezado.
 * La 4ª columna (si/no, pagada/pendiente) cambia el valor por defecto de esa fila.
 */
export function parseBulk(text: string, max: number, pagadaPorDefecto: boolean): BulkRow[] {
  const rows: BulkRow[] = [];
  text.split(/\r?\n/).forEach((raw, i) => {
    const line = raw.replace(/^\ufeff/, '').trim();
    if (!line) return;
    if (i === 0 && /n[uú]mero/i.test(line) && /nombre|comprador/i.test(line)) return;
    const linea = i + 1;
    const cols = splitLine(line);
    if (cols.length < 3) return rows.push({ linea, error: 'Faltan columnas: números; nombre; contacto' });
    const [nums, nombre, contacto, pagadaCol] = cols;
    const numeros = parseNumberList(nums, max);
    if (typeof numeros === 'string') return rows.push({ linea, error: numeros });
    if (nombre.length < 2) return rows.push({ linea, error: 'Falta el nombre' });
    if (contacto.length < 6) return rows.push({ linea, error: 'El contacto debe tener al menos 6 caracteres' });
    let pagada = pagadaPorDefecto;
    if (pagadaCol) {
      const p = pagadaCol.toLowerCase();
      if (/^(s[ií]|pagad[ao]|x|1|true)$/.test(p)) pagada = true;
      else if (/^(no|pendiente|0|false)$/.test(p)) pagada = false;
      else return rows.push({ linea, error: `"${pagadaCol}" no es sí/no` });
    }
    rows.push({ linea, venta: { numeros, compradorNombre: nombre, compradorContacto: contacto, pagada } });
  });
  return rows;
}

/** ISO → valor de <input type="datetime-local"> en hora local */
export function toLocalInput(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/**
 * "4, 7, 10-12" → [4, 7, 10, 11, 12] (ordenados y sin repetir).
 * Devuelve un mensaje si hay algo inválido o fuera de 1..max.
 */
export function parseNumberList(text: string, max: number): number[] | string {
  const out = new Set<number>();
  const parts = text.split(/[\s,;]+/).filter(Boolean);
  if (!parts.length) return 'Escribe al menos un número';
  for (const p of parts) {
    const m = /^(\d+)(?:-(\d+))?$/.exec(p);
    if (!m) return `"${p}" no es un número ni un rango (ej. 10-12)`;
    const a = Number(m[1]);
    const b = m[2] ? Number(m[2]) : a;
    if (a > b) return `El rango ${p} está al revés`;
    if (a < 1 || b > max) return `Los números van del 1 al ${max}`;
    if (b - a > 1000) return `El rango ${p} es demasiado grande`;
    for (let n = a; n <= b; n++) out.add(n);
  }
  return [...out].sort((x, y) => x - y);
}

/** Texto de un error de validación de la API: "campo: mensaje" */
export function describeError(e: { message: string; details?: any }): string {
  if (Array.isArray(e.details) && e.details.length) {
    return `${e.message}: ${e.details.map((d: any) => (d.campo ? `${d.campo} (${d.mensaje})` : d.mensaje)).join(', ')}`;
  }
  return e.message;
}

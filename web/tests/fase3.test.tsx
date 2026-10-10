import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../src/App';
import type { AdminDraw, AdminOrder, AdminRaffle } from '../src/lib/admin';
import type { PublicDraw, PublicRaffle } from '../src/lib/api';
import { pickPosition, verifyDraw } from '../src/lib/verify';

const USER = { id: 1, nombre: 'Ana Pérez', email: 'ana@example.cl' };
const past = new Date(Date.now() - 86400000).toISOString();
const future = new Date(Date.now() + 20 * 86400000).toISOString();
// sha256("abc") = ba7816bf…15ad
const ABC = BigInt('0xba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');

const publicRaffle = (over: Partial<PublicRaffle> = {}): PublicRaffle => ({
  slug: 'viaje-ab12', nombre: 'Rifa Viaje', proposito: 'viaje', objetivo: '', metaMonto: 0, precioNumero: 1000, precioTalonario: 5000,
  cantidadTalonarios: 2, numerosPorTalonario: 5, maxNumerosPorOrden: 20, ttlReservaDias: 7, fechaSorteo: future, estado: 'sorteada',
  numeroAutorizacion: null, datosBancarios: null, premios: [{ orden: 1, nombre: 'Bicicleta', descripcion: '', imagenUrl: null }],
  avance: { recaudado: 7000, metaMonto: 0, disponibles: 3, reservados: 0, pagados: 7, talonariosDisponibles: 0 },
  numeros: Array.from({ length: 10 }, (_, i) => ({ n: i + 1, e: i < 7 ? ('pagado' as const) : ('disponible' as const) })),
  ...over,
});

const draw = (over: Partial<PublicDraw> = {}): PublicDraw => ({
  id: 1, premio: { id: 11, orden: 1, nombre: 'Bicicleta' }, numero: 0, modo: 'aleatorio', semilla: 'abc', participantes: 7, posicion: 0,
  detalle: null, sorteadoEn: past, anuladoEn: null, motivoAnulacion: null, ...over,
});

const adminRaffle = (over: Partial<AdminRaffle> = {}): AdminRaffle => ({
  ...(publicRaffle({ estado: 'cerrada' }) as any),
  id: 7, bancoNombre: 'Banco Estado', bancoTipoCuenta: 'Cuenta RUT', bancoNumeroCuenta: '12345678', bancoTitular: 'Ana Pérez', bancoRut: null, bancoEmailAviso: null,
  premios: [{ id: 11, orden: 1, nombre: 'Bicicleta', descripcion: '', imagenUrl: null }, { id: 12, orden: 2, nombre: 'Canasta', descripcion: '', imagenUrl: null }],
  rol: 'organizador',
  resumen: { disponibles: 2, reservados: 1, pagados: 7, total: 10, talonariosDisponibles: 0, recaudado: 7000, porCobrar: 1000, metaMonto: 0 },
  vendedor: null,
  ...over,
});

const adminDraw = (over: Partial<AdminDraw> = {}): AdminDraw => ({
  ...draw({ numero: 4, posicion: 3 }), ordenId: 9, compradorNombre: 'Juan Soto', compradorContacto: '+56 9 1111 2222', vendedorNombre: null, ...over,
});

type Handler = (body: any) => { status?: number; body?: unknown };
let routes: Record<string, Handler>;
let calls: { method: string; url: string; body: any }[];

beforeAll(() => import('../src/admin/AdminApp'));
beforeEach(() => {
  calls = [];
  routes = { 'GET /api/auth/me': () => ({ body: USER }) };
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init: RequestInit = {}) => {
      const method = init.method ?? 'GET';
      const body = typeof init.body === 'string' ? JSON.parse(init.body) : undefined;
      calls.push({ method, url, body });
      const h = routes[`${method} ${url}`];
      const res = h ? h(body) : { status: 404, body: { error: { code: 'not_found', message: 'No encontrado' } } };
      return new Response(JSON.stringify(res.body ?? {}), { status: res.status ?? 200, headers: { 'Content-Type': 'application/json' } });
    }),
  );
});
afterEach(() => vi.unstubAllGlobals());

const mount = (path: string) => render(<MemoryRouter initialEntries={[path]}><App /></MemoryRouter>);
const callsTo = (method: string, url: string) => calls.filter((c) => c.method === method && c.url === url);

describe('verificación del sorteo en el navegador', () => {
  it('calcula la misma posición que la API: SHA-256(semilla) mod participantes', async () => {
    expect(await pickPosition('abc', 7)).toBe(Number(ABC % 7n));
    expect(await pickPosition('abc', 1000)).toBe(Number(ABC % 1000n));
  });

  it('acepta un resultado correcto y explica cuando no coincide', async () => {
    const nums = [2, 3, 5, 8, 13, 21, 34];
    const pos = Number(ABC % 7n);
    expect(await verifyDraw({ semilla: 'abc', numero: nums[pos], posicion: pos }, nums)).toEqual({ ok: true, posicion: pos });
    expect(await verifyDraw({ semilla: 'abc', numero: 99, posicion: pos }, nums)).toMatchObject({ ok: false, reason: expect.stringMatching(/no el 99/) });
    expect(await verifyDraw({ semilla: 'abc', numero: nums[pos], posicion: (pos + 1) % 7 }, nums)).toMatchObject({ ok: false });
    expect(await verifyDraw({ semilla: 'abc', numero: 2, posicion: 0 }, [3, 2])).toMatchObject({ ok: false, reason: expect.stringMatching(/ordenada/) });
    expect(await verifyDraw({ semilla: null, numero: 2, posicion: null }, [2])).toMatchObject({ ok: false });
  });
});

describe('resultados públicos', () => {
  it('muestra ganadores, sorteo externo y anulados; el visitante verifica el sorteo al azar', async () => {
    const user = userEvent.setup();
    const pos = Number(ABC % 7n);
    const participants = [1, 2, 3, 4, 5, 6, 7];
    routes['GET /api/rifas/viaje-ab12'] = () => ({
      body: publicRaffle({
        premios: [{ orden: 1, nombre: 'Bicicleta', descripcion: '', imagenUrl: null }, { orden: 2, nombre: 'Canasta', descripcion: '', imagenUrl: null }],
        sorteos: [
          draw({ numero: participants[pos], posicion: pos }),
          draw({ id: 2, premio: { id: 12, orden: 2, nombre: 'Canasta' }, numero: 6, modo: 'manual', semilla: null, posicion: 5, detalle: 'Lotería del 12/11' }),
          draw({ id: 3, premio: { id: 12, orden: 2, nombre: 'Canasta' }, numero: 2, anuladoEn: past, motivoAnulacion: 'Error al anotar' }),
        ],
      }),
    });
    routes['GET /api/rifas/viaje-ab12/sorteos/1/participantes'] = () => ({ body: { numeros: participants } });
    mount('/r/viaje-ab12');
    const results = await screen.findByRole('region', { name: 'Resultados del sorteo' });
    const winners = within(results).getAllByText('Número ganador', { exact: false }).map((el) => el.parentElement!.textContent);
    expect(winners).toEqual([`Número ganador N° ${participants[pos]}`, 'Número ganador N° 6']);
    expect(within(results).getByText('Sorteo externo: Lotería del 12/11')).toBeInTheDocument();
    expect(within(results).getByText(/Motivo: Error al anotar/)).toBeInTheDocument();

    await user.click(within(results).getByText('Cómo se sorteó'));
    await user.click(within(results).getByRole('button', { name: 'Verificar en mi navegador' }));
    expect(await within(results).findByText(`Verificado: el número ${participants[pos]} es el ${pos + 1}° de 7 participantes.`)).toBeInTheDocument();
  });

  it('el comprador ganador lo ve en su orden', async () => {
    routes['GET /api/ordenes/tok'] = () => ({
      body: {
        estado: 'pagada', numeros: [4, 5], monto: 2000, compradorNombre: 'Juan', creadaEn: past, venceEn: future,
        rifa: { nombre: 'Rifa Viaje', slug: 'viaje-ab12', fechaSorteo: future, estado: 'sorteada' }, datosBancarios: null, comprobantes: [],
        premios: [{ numero: 4, orden: 1, nombre: 'Bicicleta' }],
      },
    });
    mount('/orden/tok');
    expect(await screen.findByText(/¡Felicitaciones! Tu número 4 ganó el 1° premio: Bicicleta\./)).toBeInTheDocument();
  });
});

describe('panel: sorteo', () => {
  it('pide confirmar si hay reservas pendientes, sortea y ofrece avisar al ganador', async () => {
    const user = userEvent.setup();
    let draws: AdminDraw[] = [];
    routes['GET /api/admin/rifas/7'] = () => ({ body: adminRaffle() });
    routes['GET /api/admin/rifas/7/sorteos'] = () => ({ body: draws });
    routes['POST /api/admin/rifas/7/sorteos'] = (b) => {
      if (!b.confirmarPendientes) {
        return { status: 409, body: { error: { code: 'pending_orders', message: 'Hay 1 reserva pendiente de pago: sus números no participan.', details: { pendientes: 1 } } } };
      }
      draws = [adminDraw()];
      return { status: 201, body: draws[0] };
    };
    mount('/admin/rifas/7/sorteo');
    expect(await screen.findByText(/Participan/)).toHaveTextContent('Participan 7 números pagados');
    const card = screen.getByRole('article', { name: '1° premio: Bicicleta' });
    await user.click(within(card).getByRole('button', { name: 'Sortear al azar' }));
    expect(await within(card).findByRole('alert')).toHaveTextContent('Hay 1 reserva pendiente de pago: sus números no participan. ¿Sortear igual?');
    await user.click(within(card).getByRole('button', { name: 'Sortear igual' }));

    expect(await within(card).findByText('Juan Soto')).toBeInTheDocument();
    expect(within(card).getByText('Sorteado')).toBeInTheDocument();
    const notify = within(card).getByRole('link', { name: 'Avisar al ganador' });
    expect(notify.getAttribute('href')).toMatch(/^https:\/\/wa\.me\/56911112222\?text=/);
    expect(decodeURIComponent(notify.getAttribute('href')!.split('text=')[1])).toContain('Tu número 4 ganó el 1° premio de la rifa "Rifa Viaje": Bicicleta');
    expect(callsTo('POST', '/api/admin/rifas/7/sorteos').map((c) => c.body)).toEqual([
      { premioId: 11, modo: 'aleatorio', confirmarPendientes: false },
      { premioId: 11, modo: 'aleatorio', confirmarPendientes: true },
    ]);
  });

  it('registra un resultado externo validando número y detalle', async () => {
    const user = userEvent.setup();
    routes['GET /api/admin/rifas/7'] = () => ({ body: adminRaffle() });
    routes['GET /api/admin/rifas/7/sorteos'] = () => ({ body: [] });
    routes['POST /api/admin/rifas/7/sorteos'] = (b) => ({ status: 201, body: adminDraw({ premio: { id: 12, orden: 2, nombre: 'Canasta' }, numero: b.numero, modo: 'manual' }) });
    mount('/admin/rifas/7/sorteo');
    const card = await screen.findByRole('article', { name: '2° premio: Canasta' });
    await user.click(within(card).getByRole('button', { name: 'Registrar resultado externo' }));
    await user.type(within(card).getByLabelText('Número ganador'), '6');
    await user.click(within(card).getByRole('button', { name: 'Registrar ganador' }));
    expect(within(card).getByRole('alert')).toHaveTextContent('Indica de dónde salió el número');
    await user.type(within(card).getByLabelText('De dónde salió'), 'Lotería del 12/11');
    await user.click(within(card).getByRole('button', { name: 'Registrar ganador' }));
    await waitFor(() => expect(callsTo('POST', '/api/admin/rifas/7/sorteos')).toHaveLength(1));
    expect(callsTo('POST', '/api/admin/rifas/7/sorteos')[0].body).toEqual({ premioId: 12, modo: 'manual', numero: 6, detalle: 'Lotería del 12/11', confirmarPendientes: false });
  });

  it('anula un sorteo con motivo', async () => {
    const user = userEvent.setup();
    let draws = [adminDraw()];
    routes['GET /api/admin/rifas/7'] = () => ({ body: adminRaffle() });
    routes['GET /api/admin/rifas/7/sorteos'] = () => ({ body: draws });
    routes['POST /api/admin/sorteos/1/anular'] = (b) => {
      draws = [adminDraw({ anuladoEn: past, motivoAnulacion: b.motivo })];
      return { body: draws[0] };
    };
    mount('/admin/rifas/7/sorteo');
    const card = await screen.findByRole('article', { name: '1° premio: Bicicleta' });
    await user.click(within(card).getByRole('button', { name: 'Anular sorteo' }));
    await user.type(within(card).getByLabelText(/Motivo/), 'no');
    await user.click(within(card).getByRole('button', { name: 'Anular y permitir repetir' }));
    expect(within(card).getByRole('alert')).toHaveTextContent('Explica el motivo');
    await user.type(within(card).getByLabelText(/Motivo/), ' respondió en 7 días');
    await user.click(within(card).getByRole('button', { name: 'Anular y permitir repetir' }));
    expect(await screen.findByText(/Motivo: no respondió en 7 días/)).toBeInTheDocument();
    expect(within(screen.getByRole('article', { name: '1° premio: Bicicleta' })).getByRole('button', { name: 'Sortear al azar' })).toBeInTheDocument();
  });

  it('con la venta activa pide cerrarla; un editor ve el sorteo pero no sortea', async () => {
    routes['GET /api/admin/rifas/7'] = () => ({ body: adminRaffle({ estado: 'activa' }) });
    routes['GET /api/admin/rifas/7/sorteos'] = () => ({ body: [] });
    const { unmount } = mount('/admin/rifas/7/sorteo');
    expect(await screen.findByText(/primero cierra la venta/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Cerrar venta' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Sortear al azar' })).not.toBeInTheDocument();
    unmount();

    routes['GET /api/admin/rifas/7'] = () => ({ body: adminRaffle({ rol: 'editor' }) });
    mount('/admin/rifas/7/sorteo');
    expect(await screen.findByRole('article', { name: '1° premio: Bicicleta' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Sortear al azar' })).not.toBeInTheDocument();
  });
});

describe('avisos a compradores', () => {
  const order = (over: Partial<AdminOrder> = {}): AdminOrder => ({
    id: 5, tipo: 'numeros', canal: 'web', compradorNombre: 'Juan Soto', compradorContacto: '9 1111 2222', numeros: [4, 5], monto: 2000,
    estado: 'pendiente', creadaEn: past, venceEn: new Date(Date.now() + 20 * 3600 * 1000).toISOString(), pagadaEn: null,
    sellerId: null, vendedorNombre: null, shareLinkId: null, contactId: null, contacto: null, contactoVendio: false, comprobantes: [], ...over,
  });

  it('recordatorio de pago por WhatsApp con monto y datos bancarios; filtro "Vencen pronto"', async () => {
    const user = userEvent.setup();
    routes['GET /api/admin/rifas/7'] = () => ({ body: adminRaffle({ estado: 'activa' }) });
    routes['GET /api/admin/rifas/7/ordenes'] = () => ({
      body: [order(), order({ id: 6, compradorNombre: 'Rosa Pérez', compradorContacto: 'rosa@correo.cl', venceEn: future }), order({ id: 7, estado: 'pagada', compradorNombre: 'Luis' })],
    });
    mount('/admin/rifas/7/ordenes');
    await user.click(await screen.findByRole('button', { name: /Vencen pronto/ }));
    const card = screen.getByRole('article', { name: /Juan Soto/ });
    expect(screen.queryByRole('article', { name: /Rosa Pérez/ })).not.toBeInTheDocument();
    const href = within(card).getByRole('link', { name: 'Recordar pago' }).getAttribute('href')!;
    expect(href).toMatch(/^https:\/\/wa\.me\/56911112222\?text=/);
    const text = decodeURIComponent(href.split('text=')[1]);
    expect(text).toMatch(/^Hola Juan, te escribo por tu reserva en la rifa "Rifa Viaje": números 4, 5 por \$2\.000/);
    expect(text).toContain('N° de cuenta: 12345678');

    // Sin teléfono, el mensaje se copia
    await user.click(screen.getByRole('button', { name: /Pendientes/ }));
    expect(within(screen.getByRole('article', { name: /Rosa Pérez/ })).getByRole('button', { name: 'Copiar mensaje' })).toBeInTheDocument();
    // Pagada: confirmación
    await user.click(screen.getByRole('button', { name: /Pagadas/ }));
    const paid = within(screen.getByRole('article', { name: /Luis/ })).getByRole('link', { name: 'Avisar por WhatsApp' }).getAttribute('href')!;
    expect(decodeURIComponent(paid.split('text=')[1])).toMatch(/confirmamos tu pago de \$2\.000/);
  });
});

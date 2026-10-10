import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../src/App';
import type { AdminOrder, AdminRaffle } from '../src/lib/admin';

const USER = { id: 1, nombre: 'Ana Pérez', email: 'ana@example.cl' };

const raffle = (over: Partial<AdminRaffle> = {}): AdminRaffle => ({
  id: 7,
  slug: 'viaje-ab12',
  nombre: 'Rifa Viaje',
  proposito: 'viaje',
  objetivo: 'Viaje de 4° medio',
  metaMonto: 100000,
  precioNumero: 1000,
  cantidadTalonarios: 3,
  numerosPorTalonario: 5,
  maxNumerosPorOrden: 20,
  ttlReservaDias: 7,
  fechaSorteo: new Date(Date.now() + 20 * 86400000).toISOString(),
  numeroAutorizacion: null,
  bancoNombre: 'Banco Estado',
  bancoTipoCuenta: 'Cuenta RUT',
  bancoNumeroCuenta: '12345678',
  bancoTitular: 'Ana Pérez',
  bancoRut: '12.345.678-9',
  bancoEmailAviso: null,
  estado: 'activa',
  premios: [{ id: 1, orden: 1, nombre: 'Tablet', descripcion: '', imagenUrl: null }],
  rol: 'organizador',
  resumen: { disponibles: 10, reservados: 3, pagados: 2, total: 15, talonariosDisponibles: 1, recaudado: 2000, porCobrar: 3000, metaMonto: 100000 },
  vendedor: null,
  ...over,
});

const order = (over: Partial<AdminOrder> = {}): AdminOrder => ({
  id: 5,
  tipo: 'numeros',
  canal: 'web',
  compradorNombre: 'Juan Soto',
  compradorContacto: '+56 9 1111 2222',
  numeros: [4, 5],
  monto: 2000,
  estado: 'pendiente',
  creadaEn: new Date().toISOString(),
  venceEn: new Date(Date.now() + 3 * 86400000).toISOString(),
  pagadaEn: null,
  sellerId: null,
  vendedorNombre: null,
  shareLinkId: null,
  contactId: null,
  contacto: null,
  contactoVendio: false,
  comprobantes: [{ id: 9, nombreOriginal: 'transferencia.png', subidoEn: new Date().toISOString() }],
  ...over,
});

// El panel se carga con lazy(): se precarga para que la primera prueba no espere la compilación
beforeAll(() => import('../src/admin/AdminApp'));

type Handler = (body: any) => { status?: number; body?: unknown };
let routes: Record<string, Handler>;
let calls: { method: string; url: string; headers: Record<string, string>; body: any }[];

beforeEach(() => {
  calls = [];
  routes = { 'GET /api/auth/me': () => ({ body: USER }) };
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init: RequestInit = {}) => {
      const method = init.method ?? 'GET';
      const body = typeof init.body === 'string' ? JSON.parse(init.body) : undefined;
      calls.push({ method, url, headers: (init.headers ?? {}) as Record<string, string>, body });
      const h = routes[`${method} ${url}`];
      const res = h ? h(body) : { status: 404, body: { error: { code: 'not_found', message: 'No encontrado' } } };
      const status = res.status ?? 200;
      return new Response(status === 204 ? null : JSON.stringify(res.body ?? {}), { status, headers: { 'Content-Type': 'application/json' } });
    }),
  );
});
afterEach(() => vi.unstubAllGlobals());

const mount = (path: string) => render(<MemoryRouter initialEntries={[path]}><App /></MemoryRouter>);
const callsTo = (method: string, url: string) => calls.filter((c) => c.method === method && c.url === url);

describe('sesión del panel', () => {
  it('sin sesión lleva al login y, al ingresar, vuelve a la página pedida', async () => {
    const user = userEvent.setup();
    routes['GET /api/auth/me'] = () => ({ status: 401, body: { error: { code: 'unauthorized', message: 'Debes iniciar sesión' } } });
    routes['POST /api/auth/login'] = () => ({ body: USER });
    routes['GET /api/admin/rifas'] = () => ({ body: [{ id: 7, slug: 'viaje-ab12', nombre: 'Rifa Viaje', estado: 'activa', fechaSorteo: raffle().fechaSorteo, metaMonto: 0, rol: 'organizador' }] });
    mount('/admin');

    await user.type(await screen.findByLabelText('Correo'), 'ana@example.cl');
    await user.type(screen.getByLabelText('Contraseña'), 'clave-larga-123');
    await user.click(screen.getByRole('button', { name: 'Ingresar' }));

    expect(await screen.findByRole('heading', { name: 'Mis rifas' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Rifa Viaje/ })).toHaveAttribute('href', '/admin/rifas/7');
    const [login] = callsTo('POST', '/api/auth/login');
    expect(login.body).toEqual({ email: 'ana@example.cl', password: 'clave-larga-123' });
    expect(login.headers['X-Requested-With']).toBe('mis-rifas');
  });

  it('muestra el error de credenciales', async () => {
    const user = userEvent.setup();
    routes['GET /api/auth/me'] = () => ({ status: 401 });
    routes['POST /api/auth/login'] = () => ({ status: 401, body: { error: { code: 'unauthorized', message: 'Correo o contraseña incorrectos' } } });
    mount('/admin/login');
    await user.type(await screen.findByLabelText('Correo'), 'ana@example.cl');
    await user.type(screen.getByLabelText('Contraseña'), 'mala');
    await user.click(screen.getByRole('button', { name: 'Ingresar' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Correo o contraseña incorrectos');
  });

  it('si la sesión vence en medio del uso, vuelve al login', async () => {
    routes['GET /api/admin/rifas/7'] = () => ({ status: 401, body: { error: { code: 'unauthorized', message: 'Sesión inválida o vencida' } } });
    mount('/admin/rifas/7');
    expect(await screen.findByRole('button', { name: 'Ingresar' })).toBeInTheDocument();
  });
});

describe('crear rifa', () => {
  it('envía los números como enteros, la fecha en ISO y los campos vacíos como null', async () => {
    const user = userEvent.setup();
    routes['POST /api/admin/rifas'] = () => ({ status: 201, body: { id: 7, slug: 'viaje-ab12' } });
    routes['GET /api/admin/rifas/7'] = () => ({ body: raffle({ estado: 'borrador' }) });
    mount('/admin/rifas/nueva');

    await user.type(await screen.findByLabelText('Nombre de la rifa'), 'Rifa Viaje');
    await user.type(screen.getByLabelText('Meta (CLP)'), '100000');
    fireEvent.change(screen.getByLabelText('Fecha y hora del sorteo'), { target: { value: '2030-01-15T20:00' } });
    await user.clear(screen.getByLabelText('Cantidad de talonarios'));
    await user.type(screen.getByLabelText('Cantidad de talonarios'), '3');
    await user.type(screen.getByLabelText('Titular'), 'Ana Pérez');
    expect(screen.getByText(/30 números en total/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Crear rifa' }));

    expect(await screen.findByRole('heading', { name: 'Rifa Viaje' })).toBeInTheDocument();
    const [{ body }] = callsTo('POST', '/api/admin/rifas');
    expect(body).toMatchObject({ nombre: 'Rifa Viaje', metaMonto: 100000, cantidadTalonarios: 3, numerosPorTalonario: 10, precioNumero: 1000, bancoTitular: 'Ana Pérez', bancoNombre: null });
    expect(body.fechaSorteo).toBe(new Date('2030-01-15T20:00').toISOString());
  });

  it('no envía si faltan datos obligatorios', async () => {
    const user = userEvent.setup();
    mount('/admin/rifas/nueva');
    await user.click(await screen.findByRole('button', { name: 'Crear rifa' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Revisa los campos marcados');
    expect(screen.getByText('Mínimo 3 caracteres')).toBeInTheDocument();
    expect(callsTo('POST', '/api/admin/rifas')).toHaveLength(0);
  });
});

describe('rifa en el panel', () => {
  it('el resumen muestra el avance y permite activar un borrador', async () => {
    const user = userEvent.setup();
    let estado: AdminRaffle['estado'] = 'borrador';
    routes['GET /api/admin/rifas/7'] = () => ({ body: raffle({ estado }) });
    routes['PATCH /api/admin/rifas/7'] = (b) => {
      estado = b.estado;
      return { body: raffle({ estado }) };
    };
    mount('/admin/rifas/7');
    expect(await screen.findByRole('progressbar', { name: /avance/i })).toHaveAttribute('aria-valuenow', '2');
    expect(screen.getByText(/el enlace no funciona hasta que la actives/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Activar rifa' }));
    expect(await screen.findByText(/La rifa está activa/)).toBeInTheDocument();
    expect(callsTo('PATCH', '/api/admin/rifas/7')[0].body).toEqual({ estado: 'activa' });
    expect(await screen.findByRole('button', { name: 'Cerrar venta' })).toBeInTheDocument();
  });

  it('un editor no ve la configuración ni el cambio de estado', async () => {
    routes['GET /api/admin/rifas/7'] = () => ({ body: raffle({ rol: 'editor' }) });
    mount('/admin/rifas/7');
    expect(await screen.findByRole('link', { name: 'Órdenes' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Configuración' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Cerrar venta' })).not.toBeInTheDocument();
  });
});

describe('órdenes', () => {
  beforeEach(() => {
    routes['GET /api/admin/rifas/7'] = () => ({ body: raffle() });
  });

  it('abre en "Por revisar", muestra el comprobante y confirma el pago', async () => {
    const user = userEvent.setup();
    let current = order();
    routes['GET /api/admin/rifas/7/ordenes'] = () => ({ body: [current, order({ id: 6, compradorNombre: 'Sin Comprobante', comprobantes: [] })] });
    routes['POST /api/admin/ordenes/5/confirmar'] = () => {
      current = order({ estado: 'pagada', pagadaEn: new Date().toISOString() });
      return { body: { id: 5, estado: 'pagada' } };
    };
    mount('/admin/rifas/7/ordenes');

    const card = await screen.findByRole('article', { name: /Juan Soto/ });
    expect(screen.queryByRole('article', { name: /Sin Comprobante/ })).not.toBeInTheDocument();
    expect(within(card).getByRole('link', { name: 'transferencia.png' })).toHaveAttribute('href', '/api/admin/comprobantes/9');
    expect(within(card).getByRole('link', { name: '+56 9 1111 2222' })).toHaveAttribute('href', 'https://wa.me/56911112222');

    await user.click(within(card).getByRole('button', { name: 'Confirmar pago' }));
    await waitFor(() => expect(callsTo('POST', '/api/admin/ordenes/5/confirmar')).toHaveLength(1));
    expect(callsTo('POST', '/api/admin/ordenes/5/confirmar')[0].headers['X-Requested-With']).toBe('mis-rifas');
    await user.click(screen.getByRole('button', { name: /Pagadas/ }));
    expect(within(await screen.findByRole('article', { name: /Juan Soto/ })).getByText('Pagada')).toBeInTheDocument();
  });

  it('cancelar pide confirmación', async () => {
    const user = userEvent.setup();
    routes['GET /api/admin/rifas/7/ordenes'] = () => ({ body: [order()] });
    routes['POST /api/admin/ordenes/5/cancelar'] = () => ({ body: { id: 5, estado: 'cancelada' } });
    mount('/admin/rifas/7/ordenes');
    const card = await screen.findByRole('article', { name: /Juan Soto/ });
    await user.click(within(card).getByRole('button', { name: 'Cancelar' }));
    expect(callsTo('POST', '/api/admin/ordenes/5/cancelar')).toHaveLength(0);
    await user.click(within(card).getByRole('button', { name: 'Sí, cancelar' }));
    await waitFor(() => expect(callsTo('POST', '/api/admin/ordenes/5/cancelar')).toHaveLength(1));
  });

  it('si los números de una orden vencida ya fueron tomados, lo explica', async () => {
    const user = userEvent.setup();
    routes['GET /api/admin/rifas/7/ordenes'] = () => ({ body: [order({ estado: 'vencida', comprobantes: [] })] });
    routes['POST /api/admin/ordenes/5/confirmar'] = () => ({
      status: 409,
      body: { error: { code: 'conflict', message: 'La reserva venció y algunos números ya fueron tomados por otra persona', details: { noDisponibles: [5] } } },
    });
    mount('/admin/rifas/7/ordenes');
    const card = await screen.findByRole('article', { name: /Juan Soto/ });
    await user.click(within(card).getByRole('button', { name: 'Confirmar pago' }));
    expect(await within(card).findByRole('alert')).toHaveTextContent('ya fueron tomados por otra persona: 5');
  });

  it('registra una venta física con rangos de números', async () => {
    const user = userEvent.setup();
    routes['GET /api/admin/rifas/7/ordenes'] = () => ({ body: [] });
    routes['POST /api/admin/rifas/7/ordenes-manuales'] = (b) => ({ status: 201, body: { id: 11, estado: 'pagada', numeros: b.numeros, monto: 5000 } });
    mount('/admin/rifas/7/ordenes');
    await user.click(await screen.findByRole('button', { name: 'Registrar venta' }));
    const dialog = screen.getByRole('dialog', { name: 'Registrar venta' });
    await user.type(within(dialog).getByLabelText('Números'), '4, 7, 10-12');
    await user.type(within(dialog).getByLabelText('Comprador'), 'Pedro');
    await user.type(within(dialog).getByLabelText('Teléfono del comprador'), '912345678');
    expect(within(dialog).getByText('$5.000')).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Registrar' }));
    expect(await screen.findByText(/Venta registrada \(orden #11\)/)).toBeInTheDocument();
    expect(callsTo('POST', '/api/admin/rifas/7/ordenes-manuales')[0].body).toEqual({
      tipo: 'numeros', numeros: [4, 7, 10, 11, 12], compradorNombre: 'Pedro', compradorContacto: '912345678', canal: 'fisica', pagada: true,
    });
  });
});

describe('números', () => {
  it('muestra quién tiene cada número y filtra por estado', async () => {
    const user = userEvent.setup();
    routes['GET /api/admin/rifas/7'] = () => ({ body: raffle() });
    routes['GET /api/admin/rifas/7/numeros'] = () => ({
      body: [
        { numero: 1, talonario: 1, estado: 'pagado', ordenId: 3, compradorNombre: 'Juan Soto', compradorContacto: '+56911112222', fecha: new Date().toISOString(), canal: 'web' },
        { numero: 2, talonario: 1, estado: 'disponible', ordenId: null, compradorNombre: null, compradorContacto: null, fecha: null, canal: null },
      ],
    });
    mount('/admin/rifas/7/numeros');
    await user.click(await screen.findByRole('button', { name: 'Número 1, vendido, Juan Soto' }));
    expect(screen.getByRole('heading', { name: 'Número 1' })).toBeInTheDocument();
    expect(screen.getByText(/Orden #3/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /Disponibles/ }));
    expect(screen.queryByRole('button', { name: /Número 1,/ })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Número 2, disponible' })).toBeInTheDocument();
  });
});

describe('configuración', () => {
  it('fuera de borrador bloquea la estructura y solo envía lo que cambió', async () => {
    const user = userEvent.setup();
    routes['GET /api/admin/rifas/7'] = () => ({ body: raffle() });
    routes['PATCH /api/admin/rifas/7'] = () => ({ body: raffle() });
    routes['GET /api/admin/rifas/7/miembros'] = () => ({ body: [{ userId: 1, nombre: 'Ana Pérez', email: 'ana@example.cl', rol: 'organizador' }] });
    mount('/admin/rifas/7/configuracion');
    expect(await screen.findByLabelText('Precio por número (CLP)')).toBeDisabled();
    const titular = screen.getByLabelText('Titular');
    await user.clear(titular);
    await user.type(titular, 'Ana María Pérez');
    await user.click(screen.getByRole('button', { name: 'Guardar cambios' }));
    await waitFor(() => expect(callsTo('PATCH', '/api/admin/rifas/7')).toHaveLength(1));
    expect(callsTo('PATCH', '/api/admin/rifas/7')[0].body).toEqual({ bancoTitular: 'Ana María Pérez' });
    expect(await screen.findByText('Cambios guardados.')).toBeInTheDocument();
  });

  it('agrega un premio con el siguiente lugar', async () => {
    const user = userEvent.setup();
    routes['GET /api/admin/rifas/7'] = () => ({ body: raffle() });
    routes['GET /api/admin/rifas/7/miembros'] = () => ({ body: [] });
    routes['POST /api/admin/rifas/7/premios'] = (b) => ({ status: 201, body: { id: 2, ...b } });
    mount('/admin/rifas/7/configuracion');
    await user.click(await screen.findByRole('button', { name: 'Agregar premio' }));
    const form = screen.getByRole('form', { name: 'Nuevo premio' });
    expect(within(form).getByLabelText('Lugar')).toHaveValue(2);
    await user.type(within(form).getByLabelText('Premio'), 'Bicicleta');
    await user.click(within(form).getByRole('button', { name: 'Agregar' }));
    await waitFor(() => expect(callsTo('POST', '/api/admin/rifas/7/premios')).toHaveLength(1));
    expect(callsTo('POST', '/api/admin/rifas/7/premios')[0].body).toEqual({ orden: 2, nombre: 'Bicicleta', descripcion: '', imagenUrl: null });
  });
});

import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../src/App';
import type { AdminRaffle, SellerStats } from '../src/lib/admin';
import type { PublicRaffle } from '../src/lib/api';

const USER = { id: 1, nombre: 'Ana Pérez', email: 'ana@example.cl' };
const future = new Date(Date.now() + 20 * 86400000).toISOString();

const publicRaffle = (over: Partial<PublicRaffle> = {}): PublicRaffle => ({
  slug: 'viaje-ab12',
  nombre: 'Rifa Viaje',
  proposito: 'viaje',
  objetivo: '',
  metaMonto: 0,
  precioNumero: 1000,
  precioTalonario: 5000,
  cantidadTalonarios: 2,
  numerosPorTalonario: 5,
  maxNumerosPorOrden: 20,
  ttlReservaDias: 7,
  fechaSorteo: future,
  estado: 'activa',
  numeroAutorizacion: null,
  datosBancarios: null,
  premios: [],
  avance: { recaudado: 0, metaMonto: 0, disponibles: 10, reservados: 0, pagados: 0, talonariosDisponibles: 2 },
  numeros: Array.from({ length: 10 }, (_, i) => ({ n: i + 1, e: 'disponible' as const })),
  ...over,
});

const seller = (over: Partial<SellerStats> = {}): SellerStats => ({
  id: 3, userId: 4, nombre: 'Vale', email: 'vale@example.cl', codigoEnlace: 'abc123XY', activo: true,
  asignados: 5, asignadosLibres: 3, asignadosRangos: '1-5', vendidos: 2, reservados: 1, recaudado: 2000, porCobrar: 1000,
  ...over,
});

const adminRaffle = (over: Partial<AdminRaffle> = {}): AdminRaffle => ({
  ...(publicRaffle() as any),
  id: 7,
  bancoNombre: 'Banco Estado', bancoTipoCuenta: 'Cuenta RUT', bancoNumeroCuenta: '1', bancoTitular: 'Ana', bancoRut: null, bancoEmailAviso: null,
  premios: [],
  rol: 'organizador',
  resumen: { disponibles: 10, reservados: 0, pagados: 0, total: 10, talonariosDisponibles: 2, recaudado: 0, porCobrar: 0, metaMonto: 0 },
  vendedor: null,
  ...over,
});

type Handler = (body: any) => { status?: number; body?: unknown };
let routes: Record<string, Handler>;
let calls: { method: string; url: string; headers: Record<string, string>; body: any }[];

beforeAll(() => Promise.all([import('../src/admin/AdminApp'), import('../src/admin/InvitePage')]));
beforeEach(() => {
  calls = [];
  routes = { 'GET /api/auth/me': () => ({ body: USER }) };
  localStorage.clear();
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init: RequestInit = {}) => {
      const method = init.method ?? 'GET';
      const body = typeof init.body === 'string' ? JSON.parse(init.body) : undefined;
      calls.push({ method, url, headers: (init.headers ?? {}) as Record<string, string>, body });
      const h = routes[`${method} ${url}`];
      const res = h ? h(body) : { status: 404, body: { error: { code: 'not_found', message: 'No encontrado' } } };
      return new Response(JSON.stringify(res.body ?? {}), { status: res.status ?? 200, headers: { 'Content-Type': 'application/json' } });
    }),
  );
});
afterEach(() => vi.unstubAllGlobals());

const mount = (path: string) => render(<MemoryRouter initialEntries={[path]}><App /></MemoryRouter>);
const callsTo = (method: string, url: string) => calls.filter((c) => c.method === method && c.url === url);

describe('enlace de vendedor', () => {
  it('muestra con quién se compra y envía el código al reservar', async () => {
    const user = userEvent.setup();
    routes['GET /api/rifas/viaje-ab12?v=abc123XY'] = () => ({ body: publicRaffle({ vendedor: { nombre: 'Vale' } }) });
    routes['POST /api/rifas/viaje-ab12/ordenes'] = () => ({ status: 201, body: { token: 'tok', numeros: [2], monto: 1000, venceEn: future } });
    mount('/r/viaje-ab12?v=abc123XY');
    expect(await screen.findByText('Estás comprando con el enlace de Vale.')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Número 2, disponible' }));
    await user.click(screen.getByRole('button', { name: 'Reservar' }));
    await user.type(screen.getByLabelText('Tu nombre'), 'Juan');
    await user.type(screen.getByLabelText('Teléfono o WhatsApp'), '912345678');
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Reservar' }));
    await waitFor(() => expect(callsTo('POST', '/api/rifas/viaje-ab12/ordenes')).toHaveLength(1));
    expect(callsTo('POST', '/api/rifas/viaje-ab12/ordenes')[0].body).toMatchObject({ numeros: [2], vendedor: 'abc123XY' });
  });

  it('un código inválido no muestra vendedor ni lo envía', async () => {
    routes['GET /api/rifas/viaje-ab12?v=malo'] = () => ({ body: publicRaffle({ vendedor: null }) });
    mount('/r/viaje-ab12?v=malo');
    expect(await screen.findByRole('heading', { name: 'Rifa Viaje' })).toBeInTheDocument();
    expect(screen.queryByText(/Estás comprando con el enlace/)).not.toBeInTheDocument();
  });
});

describe('enlace de pago previo', () => {
  const link = (over = {}) => ({ estado: 'vigente', cupo: 2, venceEn: future, compradorNombre: 'Abuela Marta', ordenToken: null, rifa: publicRaffle(), ...over });

  it('elige exactamente su cupo y la orden queda pagada', async () => {
    const user = userEvent.setup();
    routes['GET /api/enlaces/tok1'] = () => ({ body: link() });
    routes['POST /api/enlaces/tok1/usar'] = (b) => ({ status: 201, body: { token: 'ord1', numeros: b.numeros, monto: 2000 } });
    routes['GET /api/ordenes/ord1'] = () => ({
      body: { estado: 'pagada', numeros: [3, 4], monto: 2000, compradorNombre: 'Abuela Marta', creadaEn: future, venceEn: future, rifa: { nombre: 'Rifa Viaje', slug: 'viaje-ab12', fechaSorteo: future }, datosBancarios: null, comprobantes: [] },
    });
    mount('/e/tok1');
    expect(await screen.findByText(/Tu pago ya está registrado: elige 2 números/)).toBeInTheDocument();
    expect(screen.getByLabelText('Tu nombre')).toHaveValue('Abuela Marta');

    for (const n of [3, 4, 5]) await user.click(screen.getByRole('button', { name: `Número ${n}, disponible` }));
    expect(screen.getByText(/Ya elegiste tus 2 números/)).toBeInTheDocument();
    // Un talonario de 5 no cabe en un cupo de 2
    await user.click(within(screen.getByRole('region', { name: 'Talonario 2' })).getByRole('button', { name: /talonario completo/i }));
    expect(screen.getByText(/te quedan 0 por elegir/)).toBeInTheDocument();

    await user.type(screen.getByLabelText('Teléfono o WhatsApp'), '912345678');
    await user.click(screen.getByRole('button', { name: 'Confirmar mis números' }));
    expect(await screen.findByText('Pago confirmado')).toBeInTheDocument();
    expect(callsTo('POST', '/api/enlaces/tok1/usar')[0].body).toEqual({
      tipo: 'numeros', numeros: [3, 4], compradorNombre: 'Abuela Marta', compradorContacto: '912345678',
    });
  });

  it('no envía si faltan números por elegir', async () => {
    const user = userEvent.setup();
    routes['GET /api/enlaces/tok1'] = () => ({ body: link() });
    mount('/e/tok1');
    await user.click(await screen.findByRole('button', { name: 'Número 1, disponible' }));
    await user.type(screen.getByLabelText('Teléfono o WhatsApp'), '912345678');
    await user.click(screen.getByRole('button', { name: 'Confirmar mis números' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Elige 1 número más');
    expect(callsTo('POST', '/api/enlaces/tok1/usar')).toHaveLength(0);
  });

  it('un enlace ya usado lleva a la orden', async () => {
    routes['GET /api/enlaces/tok1'] = () => ({ body: link({ estado: 'usado', ordenToken: 'ord1' }) });
    mount('/e/tok1');
    expect(await screen.findByText('Ya elegiste tus números con este enlace.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Ver mis números' })).toHaveAttribute('href', '/orden/ord1');
  });
});

describe('invitación', () => {
  const info = (over = {}) => ({ estado: 'vigente', rol: 'vendedor', rifa: { id: 7, nombre: 'Rifa Viaje' }, invitadoPor: 'Ana', conSesion: false, ...over });

  it('sin sesión crea la cuenta, se une y entra al panel de la rifa', async () => {
    const user = userEvent.setup();
    routes['GET /api/invitaciones/inv1'] = () => ({ body: info() });
    routes['POST /api/invitaciones/inv1/aceptar'] = () => ({ status: 201, body: { raffleId: 7, rol: 'vendedor' } });
    routes['GET /api/admin/rifas/7'] = () => ({ body: adminRaffle({ rol: 'vendedor', vendedor: seller() }) });
    mount('/invitacion/inv1');
    expect(await screen.findByRole('heading', { name: 'Te invitaron a Rifa Viaje' })).toBeInTheDocument();
    expect(screen.getByText(/Ana te invitó a su equipo/)).toBeInTheDocument();
    await user.type(screen.getByLabelText('Tu nombre'), 'Vale');
    await user.type(screen.getByLabelText('Correo'), 'vale@example.cl');
    await user.type(screen.getByLabelText('Contraseña'), 'corta');
    await user.click(screen.getByRole('button', { name: 'Crear cuenta y unirme' }));
    expect(screen.getByRole('alert')).toHaveTextContent('al menos 10 caracteres');
    await user.type(screen.getByLabelText('Contraseña'), '-y-larga-123');
    await user.click(screen.getByRole('button', { name: 'Crear cuenta y unirme' }));
    expect(await screen.findByRole('heading', { name: 'Tus ventas' })).toBeInTheDocument();
    const [accept] = callsTo('POST', '/api/invitaciones/inv1/aceptar');
    expect(accept.body).toEqual({ nombre: 'Vale', email: 'vale@example.cl', password: 'corta-y-larga-123' });
    expect(accept.headers['X-Requested-With']).toBe('mis-rifas');
  });

  it('si el correo ya tiene cuenta ofrece iniciar sesión', async () => {
    const user = userEvent.setup();
    routes['GET /api/invitaciones/inv1'] = () => ({ body: info() });
    routes['POST /api/invitaciones/inv1/aceptar'] = () => ({
      status: 409, body: { error: { code: 'account_exists', message: 'Ya existe una cuenta con ese correo: inicia sesión para aceptar la invitación' } },
    });
    mount('/invitacion/inv1');
    await user.type(await screen.findByLabelText('Tu nombre'), 'Vale');
    await user.type(screen.getByLabelText('Correo'), 'vale@example.cl');
    await user.type(screen.getByLabelText('Contraseña'), 'clave-larga-123');
    await user.click(screen.getByRole('button', { name: 'Crear cuenta y unirme' }));
    const alert = await screen.findByRole('alert');
    expect(within(alert).getByRole('link', { name: 'Iniciar sesión' })).toHaveAttribute('href', '/admin/login');
  });

  it('con sesión se acepta con un clic, sin pedir cuenta', async () => {
    routes['GET /api/invitaciones/inv1'] = () => ({ body: info({ conSesion: true }) });
    mount('/invitacion/inv1');
    expect(await screen.findByRole('button', { name: 'Aceptar invitación' })).toBeInTheDocument();
    expect(screen.queryByLabelText('Contraseña')).not.toBeInTheDocument();
  });

  it('una invitación ya usada lo avisa', async () => {
    routes['GET /api/invitaciones/inv1'] = () => ({ body: info({ estado: 'usada' }) });
    mount('/invitacion/inv1');
    expect(await screen.findByText('Esta invitación ya se usó.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /unirme|Aceptar/ })).not.toBeInTheDocument();
  });
});

describe('panel: vendedor', () => {
  it('ve su enlace y su rendición, sin Vendedores ni Configuración', async () => {
    routes['GET /api/admin/rifas/7'] = () => ({ body: adminRaffle({ rol: 'vendedor', vendedor: seller() }) });
    mount('/admin/rifas/7');
    const mine = await screen.findByRole('region', { name: 'Tus ventas' });
    expect(within(mine).getByText(/\/r\/viaje-ab12\?v=abc123XY$/)).toBeInTheDocument();
    expect(within(mine).getByText(/libres de tu talonario \(1-5\)/)).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Enlace público' })).not.toBeInTheDocument();
    const tabs = within(screen.getByRole('navigation', { name: 'Secciones de la rifa' })).getAllByRole('link').map((a) => a.textContent);
    expect(tabs).toEqual(['Resumen', 'Órdenes', 'Números', 'Carga rápida', 'Enlaces de pago']);
  });
});

describe('panel: vendedores', () => {
  it('asigna un rango a un vendedor', async () => {
    const user = userEvent.setup();
    let current = seller({ asignados: 0, asignadosLibres: 0, asignadosRangos: '' });
    routes['GET /api/admin/rifas/7'] = () => ({ body: adminRaffle() });
    routes['GET /api/admin/rifas/7/vendedores'] = () => ({ body: [current] });
    routes['POST /api/admin/rifas/7/vendedores/3/asignar'] = (b) => {
      current = seller({ asignados: b.numeros.length, asignadosLibres: b.numeros.length, asignadosRangos: '6-10' });
      return { body: { asignados: b.numeros.length, vendedor: current } };
    };
    mount('/admin/rifas/7/vendedores');
    const card = await screen.findByRole('article', { name: /Vale/ });
    await user.type(within(card).getByLabelText('Números o rangos'), '6-10');
    await user.click(within(card).getByRole('button', { name: 'Asignar' }));
    expect(await within(card).findByText('5 números asignados a Vale.')).toBeInTheDocument();
    expect(callsTo('POST', '/api/admin/rifas/7/vendedores/3/asignar')[0].body).toEqual({ numeros: [6, 7, 8, 9, 10] });
    expect(await within(card).findByText('6-10')).toBeInTheDocument();
  });
});

describe('panel: carga rápida', () => {
  it('muestra la vista previa, bloquea con errores y deja en el cuadro solo lo que falló', async () => {
    const user = userEvent.setup();
    routes['GET /api/admin/rifas/7'] = () => ({ body: adminRaffle() });
    routes['GET /api/admin/rifas/7/vendedores'] = () => ({ body: [seller()] });
    routes['POST /api/admin/rifas/7/ventas-lote'] = () => ({
      body: { creadas: 1, fallidas: 1, resultados: [{ fila: 1, ok: true, ordenId: 20 }, { fila: 2, ok: false, error: 'Algunos números ya no están disponibles', noDisponibles: [4] }] },
    });
    mount('/admin/rifas/7/carga');
    const box = await screen.findByLabelText('Ventas');
    fireEvent.change(box, { target: { value: '1-3; Juan; 912345678\n4; Rosa; 912345679; no\n99; Mal; 912345670' } });
    expect(screen.getByText(/1 línea con error/)).toBeInTheDocument();
    expect(screen.getByText(/Línea 3: Los números van del 1 al 10/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Cargar 2 ventas' })).toBeDisabled();

    fireEvent.change(box, { target: { value: '1-3; Juan; 912345678\n4; Rosa; 912345679; no' } });
    await user.selectOptions(screen.getByLabelText('Atribuir a'), 'Vale');
    await user.click(screen.getByRole('button', { name: 'Cargar 2 ventas' }));
    expect(await screen.findByText(/1 venta cargada/)).toBeInTheDocument();
    expect(screen.getByText(/"4; Rosa; 912345679; no": Algunos números ya no están disponibles \(4\)/)).toBeInTheDocument();
    expect(screen.getByLabelText('Ventas')).toHaveValue('4; Rosa; 912345679; no');
    expect(callsTo('POST', '/api/admin/rifas/7/ventas-lote')[0].body).toEqual({
      canal: 'fisica',
      ventas: [
        { numeros: [1, 2, 3], compradorNombre: 'Juan', compradorContacto: '912345678', pagada: true, vendedorId: 3 },
        { numeros: [4], compradorNombre: 'Rosa', compradorContacto: '912345679', pagada: false, vendedorId: 3 },
      ],
    });
  });
});

describe('panel: enlaces de pago e invitaciones', () => {
  it('crea un enlace de pago previo y lo muestra para copiar', async () => {
    const user = userEvent.setup();
    routes['GET /api/admin/rifas/7'] = () => ({ body: adminRaffle() });
    routes['GET /api/admin/rifas/7/enlaces'] = () => ({ body: [] });
    routes['POST /api/admin/rifas/7/enlaces'] = (b) => ({
      status: 201,
      body: { id: 1, token: 'tokXYZ', cupo: b.cupo, estado: 'vigente', venceEn: future, creadoEn: future, compradorNombre: b.compradorNombre, compradorContacto: null, ordenId: null, vendedorId: null, vendedorNombre: null },
    });
    mount('/admin/rifas/7/enlaces');
    const cupo = await screen.findByLabelText('Números pagados');
    await user.clear(cupo);
    await user.type(cupo, '3');
    expect(screen.getByText('Equivale a $3.000')).toBeInTheDocument();
    await user.type(screen.getByLabelText('Comprador (opcional)'), 'Abuela Marta');
    await user.click(screen.getByRole('button', { name: 'Crear enlace' }));
    expect(await screen.findByText(/Enlace creado por 3 números/)).toBeInTheDocument();
    expect(screen.getByText(/\/e\/tokXYZ$/)).toBeInTheDocument();
    expect(callsTo('POST', '/api/admin/rifas/7/enlaces')[0].body).toEqual({ cupo: 3, venceDias: 7, compradorNombre: 'Abuela Marta', compradorContacto: null });
  });

  it('el organizador crea una invitación por link', async () => {
    const user = userEvent.setup();
    let invs: any[] = [];
    routes['GET /api/admin/rifas/7'] = () => ({ body: adminRaffle() });
    routes['GET /api/admin/rifas/7/miembros'] = () => ({ body: [{ userId: 1, nombre: 'Ana Pérez', email: 'ana@example.cl', rol: 'organizador' }] });
    routes['GET /api/admin/rifas/7/invitaciones'] = () => ({ body: invs });
    routes['POST /api/admin/rifas/7/invitaciones'] = (b) => {
      invs = [{ id: 1, token: 'invTok', rol: b.rol, estado: 'vigente', creadoEn: future, venceEn: future, usadaEn: null }];
      return { status: 201, body: invs[0] };
    };
    mount('/admin/rifas/7/configuracion');
    await user.click(await screen.findByRole('button', { name: 'Crear invitación' }));
    expect(await screen.findByText(/\/invitacion\/invTok$/)).toBeInTheDocument();
    expect(callsTo('POST', '/api/admin/rifas/7/invitaciones')[0].body).toEqual({ rol: 'vendedor' });
  });
});

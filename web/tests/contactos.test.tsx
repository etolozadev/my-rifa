import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../src/App';
import type { AdminDraw, AdminOrder, AdminRaffle, Contact } from '../src/lib/admin';

const USER = { id: 1, nombre: 'Ana Pérez', email: 'ana@example.cl' };
const future = new Date(Date.now() + 20 * 86400000).toISOString();
const past = new Date(Date.now() - 86400000).toISOString();

const raffle = (over: Partial<AdminRaffle> = {}): AdminRaffle => ({
  id: 7, slug: 'viaje-ab12', nombre: 'Rifa Viaje', proposito: 'viaje', objetivo: '', metaMonto: 0, precioNumero: 1000,
  cantidadTalonarios: 2, numerosPorTalonario: 5, maxNumerosPorOrden: 20, ttlReservaDias: 7, fechaSorteo: future, numeroAutorizacion: null,
  bancoNombre: 'Banco Estado', bancoTipoCuenta: 'Cuenta RUT', bancoNumeroCuenta: '12345678', bancoTitular: 'Ana Pérez', bancoRut: null, bancoEmailAviso: null,
  estado: 'activa', premios: [], rol: 'organizador',
  resumen: { disponibles: 10, reservados: 0, pagados: 0, total: 10, talonariosDisponibles: 2, recaudado: 0, porCobrar: 0, metaMonto: 0 },
  vendedor: null, ...over,
});

const rosa: Contact = { id: 3, nombre: 'Rosa Pérez', telefono: '+56 9 1111 2222', nota: 'hija de doña Marta', ordenes: 2, vendidos: 3, reservados: 1, recaudado: 3000, porCobrar: 1000 };

type Handler = (body: any) => { status?: number; body?: unknown };
let routes: Record<string, Handler>;
let calls: { method: string; url: string; body: any }[];

beforeAll(() => import('../src/admin/AdminApp'));
beforeEach(() => {
  calls = [];
  routes = {
    'GET /api/auth/me': () => ({ body: USER }),
    'GET /api/admin/rifas/7': () => ({ body: raffle() }),
    'GET /api/admin/rifas/7/contactos': () => ({ body: [rosa] }),
    'GET /api/admin/rifas/7/vendedores': () => ({ body: [] }),
  };
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init: RequestInit = {}) => {
      const method = init.method ?? 'GET';
      const body = typeof init.body === 'string' ? JSON.parse(init.body) : undefined;
      calls.push({ method, url, body });
      const h = routes[`${method} ${url}`];
      const res = h ? h(body) : { status: 404, body: { error: { code: 'not_found', message: 'No encontrado' } } };
      return new Response(res.status === 204 ? null : JSON.stringify(res.body ?? {}), { status: res.status ?? 200, headers: { 'Content-Type': 'application/json' } });
    }),
  );
});
afterEach(() => vi.unstubAllGlobals());

const mount = (path: string) => render(<MemoryRouter initialEntries={[path]}><App /></MemoryRouter>);
const callsTo = (method: string, url: string) => calls.filter((c) => c.method === method && c.url === url);

describe('pestaña Contactos', () => {
  it('lista los contactos con lo que vendieron y agrega uno nuevo', async () => {
    const user = userEvent.setup();
    routes['POST /api/admin/rifas/7/contactos'] = (b) => ({ status: 201, body: { id: 4, ...b, ordenes: 0, vendidos: 0, reservados: 0, recaudado: 0, porCobrar: 0 } });
    mount('/admin/rifas/7/contactos');
    const card = await screen.findByRole('article', { name: 'Rosa Pérez' });
    expect(within(card).getByRole('link', { name: '+56 9 1111 2222' })).toHaveAttribute('href', 'https://wa.me/56911112222');
    expect(within(card).getByText(/Vendió 3 números \(\$3\.000\); 1 reservado por cobrar \(\$1\.000\)/)).toBeInTheDocument();
    expect(within(screen.getByRole('region', { name: 'Lo que vendieron' })).getByText('Rosa Pérez')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Agregar contacto' }));
    const form = screen.getByRole('form', { name: 'Nuevo contacto' });
    await user.type(within(form).getByLabelText('Nombre'), 'Luis Soto');
    await user.click(within(form).getByRole('button', { name: 'Agregar' }));
    expect(within(form).getByRole('alert')).toHaveTextContent('El teléfono debe tener al menos 6 caracteres');
    await user.type(within(form).getByLabelText('Teléfono'), '987654321');
    await user.click(within(form).getByRole('button', { name: 'Agregar' }));
    await waitFor(() => expect(callsTo('POST', '/api/admin/rifas/7/contactos')).toHaveLength(1));
    expect(callsTo('POST', '/api/admin/rifas/7/contactos')[0].body).toEqual({ nombre: 'Luis Soto', telefono: '987654321', nota: '' });
  });

  it('explica por qué no se puede eliminar un contacto con órdenes', async () => {
    const user = userEvent.setup();
    routes['DELETE /api/admin/rifas/7/contactos/3'] = () => ({ status: 409, body: { error: { code: 'conflict', message: 'No se puede eliminar: tiene 2 órdenes asociadas' } } });
    mount('/admin/rifas/7/contactos');
    const card = await screen.findByRole('article', { name: 'Rosa Pérez' });
    await user.click(within(card).getByRole('button', { name: 'Eliminar a Rosa Pérez' }));
    await user.click(within(card).getByRole('button', { name: 'Sí, eliminar' }));
    expect(await within(card).findByRole('alert')).toHaveTextContent('tiene 2 órdenes asociadas');
  });
});

describe('venta manual con persona de contacto', () => {
  beforeEach(() => {
    routes['GET /api/admin/rifas/7/ordenes'] = () => ({ body: [] });
    routes['POST /api/admin/rifas/7/ordenes-manuales'] = (b) => ({ status: 201, body: { id: 21, estado: 'pagada', numeros: b.numeros, monto: 1000 } });
  });

  it('sin teléfono exige elegir una persona; con ella envía el contacto y si vendió', async () => {
    const user = userEvent.setup();
    mount('/admin/rifas/7/ordenes');
    await user.click(await screen.findByRole('button', { name: 'Registrar venta' }));
    const dialog = screen.getByRole('dialog', { name: 'Registrar venta' });
    await user.type(within(dialog).getByLabelText('Números'), '4');
    await user.type(within(dialog).getByLabelText('Comprador'), 'Doña Marta');
    await user.click(within(dialog).getByRole('button', { name: 'Registrar' }));
    expect(within(dialog).getByText('Escribe el teléfono o elige una persona de contacto')).toBeInTheDocument();
    expect(callsTo('POST', '/api/admin/rifas/7/ordenes-manuales')).toHaveLength(0);

    await user.selectOptions(within(dialog).getByLabelText('Persona de contacto'), 'Rosa Pérez (+56 9 1111 2222)');
    await user.click(within(dialog).getByLabelText('Esta persona vendió el número (rinde el dinero)'));
    await user.click(within(dialog).getByRole('button', { name: 'Registrar' }));
    expect(await screen.findByText(/Venta registrada \(orden #21\)/)).toBeInTheDocument();
    expect(callsTo('POST', '/api/admin/rifas/7/ordenes-manuales')[0].body).toEqual({
      tipo: 'numeros', numeros: [4], compradorNombre: 'Doña Marta', contactoId: 3, contactoVendio: true, canal: 'fisica', pagada: true,
    });
  });

  it('crea una persona de contacto nueva al registrar la venta', async () => {
    const user = userEvent.setup();
    routes['POST /api/admin/rifas/7/contactos'] = (b) => ({ status: 201, body: { id: 9, ...b, ordenes: 0, vendidos: 0, reservados: 0, recaudado: 0, porCobrar: 0 } });
    mount('/admin/rifas/7/ordenes');
    await user.click(await screen.findByRole('button', { name: 'Registrar venta' }));
    const dialog = screen.getByRole('dialog', { name: 'Registrar venta' });
    await user.type(within(dialog).getByLabelText('Números'), '5');
    await user.type(within(dialog).getByLabelText('Comprador'), 'Abuelo Juan');
    await user.selectOptions(within(dialog).getByLabelText('Persona de contacto'), '+ Agregar persona nueva…');
    await user.type(within(dialog).getByLabelText('Nombre del contacto'), 'Pedro Díaz');
    await user.type(within(dialog).getByLabelText('Teléfono del contacto'), '955554444');
    await user.click(within(dialog).getByRole('button', { name: 'Registrar' }));
    await waitFor(() => expect(callsTo('POST', '/api/admin/rifas/7/ordenes-manuales')).toHaveLength(1));
    expect(callsTo('POST', '/api/admin/rifas/7/contactos')[0].body).toEqual({ nombre: 'Pedro Díaz', telefono: '955554444', nota: '' });
    expect(callsTo('POST', '/api/admin/rifas/7/ordenes-manuales')[0].body).toMatchObject({ contactoId: 9, contactoVendio: false });
    expect(callsTo('POST', '/api/admin/rifas/7/ordenes-manuales')[0].body).not.toHaveProperty('compradorContacto');
  });
});

describe('avisos a la persona de contacto', () => {
  const order = (over: Partial<AdminOrder> = {}): AdminOrder => ({
    id: 5, tipo: 'numeros', canal: 'fisica', compradorNombre: 'Doña Marta', compradorContacto: null, numeros: [4, 5], monto: 2000,
    estado: 'pendiente', creadaEn: past, venceEn: future, pagadaEn: null, sellerId: null, vendedorNombre: null, shareLinkId: null,
    contactId: 3, contacto: { id: 3, nombre: 'Rosa Pérez', telefono: '+56 9 1111 2222' }, contactoVendio: true, comprobantes: [], ...over,
  });

  it('la orden sin teléfono muestra el contacto y el recordatorio va a esa persona', async () => {
    routes['GET /api/admin/rifas/7/ordenes'] = () => ({ body: [order()] });
    mount('/admin/rifas/7/ordenes');
    const card = await screen.findByRole('article', { name: /Doña Marta/ });
    expect(within(card).getByText('Sin teléfono propio')).toBeInTheDocument();
    expect(within(card).getByText('vendió')).toBeInTheDocument();
    const link = within(card).getByRole('link', { name: 'Recordar pago a Rosa' });
    expect(link.getAttribute('href')).toMatch(/^https:\/\/wa\.me\/56911112222\?text=/);
    expect(decodeURIComponent(link.getAttribute('href')!.split('text=')[1])).toMatch(/^Hola Rosa, te escribo por la reserva de Doña Marta en la rifa "Rifa Viaje": números 4, 5 por \$2\.000/);
  });

  it('el ganador sin teléfono se avisa a su persona de contacto', async () => {
    const draw: AdminDraw = {
      id: 1, premio: { id: 11, orden: 1, nombre: 'Bicicleta' }, numero: 4, modo: 'manual', semilla: null, participantes: 7, posicion: 3,
      detalle: 'Tómbola', sorteadoEn: past, anuladoEn: null, motivoAnulacion: null, ordenId: 5, compradorNombre: 'Doña Marta',
      compradorContacto: null, contactoNombre: 'Rosa Pérez', contactoTelefono: '+56 9 1111 2222', vendedorNombre: null,
    };
    routes['GET /api/admin/rifas/7'] = () => ({ body: raffle({ estado: 'cerrada', premios: [{ id: 11, orden: 1, nombre: 'Bicicleta', descripcion: '', imagenUrl: null }] }) });
    routes['GET /api/admin/rifas/7/sorteos'] = () => ({ body: [draw] });
    routes['GET /api/admin/rifas/7/numeros?estado=pagado'] = () => ({ body: [] });
    mount('/admin/rifas/7/sorteo');
    const card = await screen.findByRole('article', { name: '1° premio: Bicicleta' });
    const link = within(card).getByRole('link', { name: 'Avisar a Rosa (contacto)' });
    expect(decodeURIComponent(link.getAttribute('href')!.split('text=')[1])).toContain('El número 4 de Doña Marta ganó el 1° premio');
  });
});

describe('carga rápida con persona de contacto', () => {
  it('con un contacto para el lote acepta filas sin teléfono y lo envía en cada venta', async () => {
    const user = userEvent.setup();
    routes['POST /api/admin/rifas/7/ventas-lote'] = () => ({ body: { creadas: 2, fallidas: 0, resultados: [{ fila: 1, ok: true }, { fila: 2, ok: true }] } });
    mount('/admin/rifas/7/carga');
    const box = await screen.findByLabelText('Ventas');
    fireEvent.change(box, { target: { value: '1-2; Doña Marta\n3; Primo; 912345678' } });
    expect(screen.getByText(/1 línea con error/)).toBeInTheDocument();
    expect(screen.getByText('Línea 1: Falta el teléfono o la persona de contacto')).toBeInTheDocument();

    await user.selectOptions(screen.getByLabelText('Persona de contacto para todo el lote'), 'Rosa Pérez (+56 9 1111 2222)');
    expect(screen.queryByText(/línea con error/)).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Cargar 2 ventas' }));
    expect(await screen.findByText(/2 ventas cargadas/)).toBeInTheDocument();
    expect(callsTo('POST', '/api/admin/rifas/7/ventas-lote')[0].body.ventas).toEqual([
      { numeros: [1, 2], compradorNombre: 'Doña Marta', contactoId: 3, contactoVendio: false, pagada: true },
      { numeros: [3], compradorNombre: 'Primo', compradorContacto: '912345678', contactoId: 3, contactoVendio: false, pagada: true },
    ]);
  });
});

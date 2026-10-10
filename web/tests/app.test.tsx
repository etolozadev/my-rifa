import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../src/App';
import type { PublicRaffle } from '../src/lib/api';

const raffle = (over: Partial<PublicRaffle> = {}): PublicRaffle => ({
  slug: 'viaje-1234',
  nombre: 'Rifa Viaje de Estudio',
  proposito: 'viaje',
  objetivo: 'Financiar el viaje de 4° medio',
  metaMonto: 100000,
  precioNumero: 1000,
  precioTalonario: 5000,
  cantidadTalonarios: 3,
  numerosPorTalonario: 5,
  maxNumerosPorOrden: 3,
  ttlReservaDias: 7,
  fechaSorteo: new Date(Date.now() + 20 * 86400000).toISOString(),
  estado: 'activa',
  numeroAutorizacion: null,
  datosBancarios: { banco: 'Banco Estado', tipoCuenta: 'Cuenta RUT', numeroCuenta: '12345678', titular: 'Ana Pérez', rut: '12.345.678-9', emailAviso: null },
  premios: [{ orden: 1, nombre: 'Tablet', descripcion: '10 pulgadas', imagenUrl: null }],
  avance: { recaudado: 25000, metaMonto: 100000, disponibles: 12, reservados: 1, pagados: 2, talonariosDisponibles: 1 },
  numeros: Array.from({ length: 15 }, (_, i) => ({ n: i + 1, e: i + 1 === 2 ? 'reservado' : i + 1 <= 1 || i + 1 === 3 ? 'pagado' : 'disponible' })) as any,
  ...over,
});

const json = (body: unknown, status = 200) => Promise.resolve(new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }));

function mount(path: string) {
  return render(<MemoryRouter initialEntries={[path]}><App /></MemoryRouter>);
}

let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
  localStorage.clear();
});
afterEach(() => vi.unstubAllGlobals());

describe('página de la rifa', () => {
  it('muestra nombre, fecha, avance, premios, datos bancarios y estado de cada número', async () => {
    fetchMock.mockImplementation(() => json(raffle()));
    mount('/r/viaje-1234');
    expect(await screen.findByRole('heading', { name: 'Rifa Viaje de Estudio' })).toBeInTheDocument();
    expect(screen.getByRole('progressbar', { name: /avance/i })).toHaveAttribute('aria-valuenow', '25');
    expect(screen.getByText('Tablet')).toBeInTheDocument();
    expect(screen.getByText('12345678')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Número 2, reservado' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Número 1, vendido' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Número 4, disponible' })).toBeEnabled();
  });

  it('selecciona números, muestra el total y respeta el máximo por orden', async () => {
    const user = userEvent.setup();
    fetchMock.mockImplementation(() => json(raffle()));
    mount('/r/viaje-1234');
    for (const n of [4, 5, 6]) await user.click(await screen.findByRole('button', { name: `Número ${n}, disponible` }));
    const bar = screen.getByRole('region', { name: /tu selección/i });
    expect(within(bar).getByText(/3 números/)).toBeInTheDocument();
    expect(within(bar).getByText(/\$3\.000/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Número 7, disponible' }));
    expect(screen.getByText(/hasta 3 números por orden/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Número 7, disponible' })).toHaveAttribute('aria-pressed', 'false');
  });

  it('un talonario con números tomados no se puede comprar completo; uno libre sí, sin tope', async () => {
    const user = userEvent.setup();
    fetchMock.mockImplementation(() => json(raffle()));
    mount('/r/viaje-1234');
    const b1 = await screen.findByRole('region', { name: 'Talonario 1' });
    expect(within(b1).getByRole('button', { name: /talonario completo/i })).toBeDisabled();
    const b3 = screen.getByRole('region', { name: 'Talonario 3' });
    await user.click(within(b3).getByRole('button', { name: /talonario completo/i }));
    const bar = screen.getByRole('region', { name: /tu selección/i });
    expect(within(bar).getByText(/5 números/)).toBeInTheDocument(); // supera el tope de 3, pero es un talonario
    expect(within(bar).getByRole('button', { name: 'Reservar' })).toBeEnabled();
  });

  it('un talonario sin números disponibles muestra "Agotado" y no ofrece comprarlo', async () => {
    fetchMock.mockImplementation(() => json(raffle({ numeros: raffle().numeros.map((x) => (x.n <= 5 ? { ...x, e: 'pagado' as const } : x)) })));
    mount('/r/viaje-1234');
    const b1 = await screen.findByRole('region', { name: 'Talonario 1' });
    expect(within(b1).getByText('Agotado')).toBeInTheDocument();
    expect(within(b1).queryByRole('button', { name: /talonario completo/i })).not.toBeInTheDocument();
  });

  it('reserva: valida el formulario, envía la orden y lleva a la página de la orden', async () => {
    const user = userEvent.setup();
    fetchMock.mockImplementation((url: string, init?: RequestInit) => {
      if (url === '/api/rifas/viaje-1234' && !init) return json(raffle());
      if (url === '/api/rifas/viaje-1234/ordenes') return json({ token: 'tok123', numeros: [4, 5], monto: 2000, venceEn: new Date(Date.now() + 7 * 86400000).toISOString() }, 201);
      if (url === '/api/ordenes/tok123')
        return json({ estado: 'pendiente', numeros: [4, 5], monto: 2000, compradorNombre: 'María López', creadaEn: new Date().toISOString(), venceEn: new Date(Date.now() + 7 * 86400000).toISOString(), rifa: { nombre: 'Rifa Viaje de Estudio', slug: 'viaje-1234', fechaSorteo: raffle().fechaSorteo }, datosBancarios: raffle().datosBancarios, comprobantes: [] });
      return json({}, 404);
    });
    mount('/r/viaje-1234');
    await user.click(await screen.findByRole('button', { name: 'Número 4, disponible' }));
    await user.click(screen.getByRole('button', { name: 'Número 5, disponible' }));
    await user.click(screen.getByRole('button', { name: 'Reservar' }));

    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'Reservar' })); // vacío
    expect(within(dialog).getByText('Escribe tu nombre')).toBeInTheDocument();
    expect(fetchMock.mock.calls.some(([u]) => u === '/api/rifas/viaje-1234/ordenes')).toBe(false);

    await user.type(within(dialog).getByLabelText('Tu nombre'), 'María López');
    await user.type(within(dialog).getByLabelText(/teléfono/i), '+56911112222');
    await user.click(within(dialog).getByRole('button', { name: 'Reservar' }));

    expect(await screen.findByRole('heading', { name: /Tu reserva en Rifa Viaje de Estudio/ })).toBeInTheDocument();
    const post = fetchMock.mock.calls.find(([u]) => u === '/api/rifas/viaje-1234/ordenes')!;
    expect(JSON.parse(post[1].body)).toEqual({ tipo: 'numeros', numeros: [4, 5], compradorNombre: 'María López', compradorContacto: '+56911112222' });
    expect(JSON.parse(localStorage.getItem('mis-rifas:ordenes')!)[0].token).toBe('tok123');
  });

  it('si otra persona toma un número mientras reservas, avisa y lo quita de la selección', async () => {
    const user = userEvent.setup();
    fetchMock.mockImplementation((url: string, init?: RequestInit) => {
      if (url === '/api/rifas/viaje-1234/ordenes')
        return json({ error: { code: 'conflict', message: 'Algunos números ya no están disponibles', details: { noDisponibles: [5] } } }, 409);
      return json(raffle());
    });
    mount('/r/viaje-1234');
    await user.click(await screen.findByRole('button', { name: 'Número 4, disponible' }));
    await user.click(screen.getByRole('button', { name: 'Número 5, disponible' }));
    await user.click(screen.getByRole('button', { name: 'Reservar' }));
    const dialog = await screen.findByRole('dialog');
    await user.type(within(dialog).getByLabelText('Tu nombre'), 'María López');
    await user.type(within(dialog).getByLabelText(/teléfono/i), '+56911112222');
    await user.click(within(dialog).getByRole('button', { name: 'Reservar' }));

    expect(await screen.findByText(/Los números 5 ya fueron tomados/)).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Número 4, seleccionado' })).toBeInTheDocument();
  });

  it('con la venta cerrada muestra un aviso y no permite elegir', async () => {
    fetchMock.mockImplementation(() => json(raffle({ estado: 'cerrada', datosBancarios: null })));
    mount('/r/viaje-1234');
    expect(await screen.findByText(/venta de esta rifa está cerrada/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Número 4, disponible' })).toBeDisabled();
    expect(screen.queryByText('12345678')).not.toBeInTheDocument();
  });

  it('una rifa inexistente muestra la página de no encontrada', async () => {
    fetchMock.mockImplementation(() => json({ error: { code: 'not_found', message: 'Rifa no encontrada' } }, 404));
    mount('/r/nada');
    expect(await screen.findByRole('heading', { name: 'No encontramos esta rifa' })).toBeInTheDocument();
  });
});

describe('página de la orden', () => {
  const order = (over: object = {}) => ({
    estado: 'pendiente', numeros: [4, 5], monto: 2000, compradorNombre: 'María López',
    creadaEn: new Date().toISOString(), venceEn: new Date(Date.now() + 5 * 86400000).toISOString(),
    rifa: { nombre: 'Rifa Viaje de Estudio', slug: 'viaje-1234', fechaSorteo: raffle().fechaSorteo },
    datosBancarios: raffle().datosBancarios, comprobantes: [], ...over,
  });

  it('muestra el plazo, los datos bancarios y permite subir un comprobante', async () => {
    const user = userEvent.setup();
    let uploaded = false;
    fetchMock.mockImplementation((url: string, init?: RequestInit) => {
      if (url === '/api/ordenes/tok/comprobantes' && init?.method === 'POST') { uploaded = true; return json({ id: 1, nombre: 'pago.png', subidoEn: new Date().toISOString() }, 201); }
      return json(order(uploaded ? { comprobantes: [{ id: 1, nombre: 'pago.png', subidoEn: new Date().toISOString() }] } : {}));
    });
    mount('/orden/tok');
    expect(await screen.findByText('Pendiente de pago')).toBeInTheDocument();
    expect(screen.getByText(/Transfiere \$2\.000 antes del/)).toBeInTheDocument();
    expect(screen.getByText('12345678')).toBeInTheDocument();

    const file = new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], 'pago.png', { type: 'image/png' });
    await user.upload(screen.getByLabelText(/sube una foto o pdf/i), file);
    expect(await screen.findByText(/Comprobante enviado/)).toBeInTheDocument();
    expect(await screen.findByRole('link', { name: 'pago.png' })).toHaveAttribute('href', '/api/ordenes/tok/comprobantes/1');
  });

  it('rechaza en el navegador archivos de más de 5 MB sin llamar a la API', async () => {
    const user = userEvent.setup();
    fetchMock.mockImplementation(() => json(order()));
    mount('/orden/tok');
    const input = await screen.findByLabelText(/sube una foto o pdf/i);
    const big = new File([new Uint8Array(6 * 1024 * 1024)], 'grande.png', { type: 'image/png' });
    await user.upload(input, big);
    expect(await screen.findByText(/pesa más de 5 MB/)).toBeInTheDocument();
    expect(fetchMock.mock.calls.some(([, init]) => init?.method === 'POST')).toBe(false);
  });

  it('una orden pagada no pide comprobante ni muestra datos bancarios', async () => {
    fetchMock.mockImplementation(() => json(order({ estado: 'pagada', datosBancarios: null })));
    mount('/orden/tok');
    expect(await screen.findByText('Pago confirmado')).toBeInTheDocument();
    expect(screen.queryByLabelText(/sube una foto/i)).not.toBeInTheDocument();
    expect(screen.queryByText('Datos para transferir')).not.toBeInTheDocument();
  });

  it('una orden vencida explica qué hacer', async () => {
    fetchMock.mockImplementation(() => json(order({ estado: 'vencida', datosBancarios: null })));
    mount('/orden/tok');
    expect(await screen.findByText(/Tu reserva venció/)).toBeInTheDocument();
  });

  it('un token inexistente muestra que no se encontró la reserva', async () => {
    fetchMock.mockImplementation(() => json({ error: { code: 'not_found', message: 'Orden no encontrada' } }, 404));
    mount('/orden/xxx');
    expect(await screen.findByRole('heading', { name: 'No encontramos esta reserva' })).toBeInTheDocument();
  });
});

import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../src/App';
import { DrawStage } from '../src/admin/DrawStage';
import {
  createDrawSound,
  makeSeamlessLoop,
  rollRate,
  rollVelocity,
  sampledRollGain,
  sampledRollRate,
  scheduleFinale,
  scheduleSplash,
  scheduleRoll,
  shortName,
  suspenseDelays,
} from '../src/admin/drawFx';
import { TabBar } from '../src/admin/TabBar';
import type { AdminDraw, AdminRaffle } from '../src/lib/admin';

const future = new Date(Date.now() + 20 * 86400000).toISOString();

describe('utilidades del sorteo en vivo', () => {
  it('la tómbola frena: pausas crecientes, de 55 ms a 560 ms, unos 4 segundos en total', () => {
    const d = suspenseDelays();
    expect(d[0]).toBe(55);
    expect(d[d.length - 1]).toBe(560);
    expect(d.every((x, i) => i === 0 || x >= d[i - 1])).toBe(true);
    const total = d.reduce((a, b) => a + b, 0);
    expect(total).toBeGreaterThan(3000);
    expect(total).toBeLessThan(5500);
  });

  it('abrevia el nombre del ganador para anunciarlo', () => {
    expect(shortName('Juan Soto Pérez')).toBe('Juan S.');
    expect(shortName('Rosa')).toBe('Rosa');
    expect(shortName('  ')).toBeNull();
    expect(shortName(null)).toBeNull();
  });

  it('el redoble alterna manos, crece en velocidad y volumen, y continúa sin cortes', () => {
    const hits: { t: number; v: number }[] = [];
    const kit = { snare: (t: number, v: number) => hits.push({ t, v }) };
    // 4 segundos con intensidad que sube de 0 a 1
    const { next, hand } = scheduleRoll(kit, 0, 4, (t) => t / 4);
    const inWindow = (a: number, b: number) => hits.filter((h) => h.t >= a && h.t < b);
    const first = inWindow(0, 1);
    const last = inWindow(3, 4);
    // De ~15 a ~24 golpes por segundo
    expect(first.length).toBeGreaterThanOrEqual(14);
    expect(first.length).toBeLessThanOrEqual(18);
    expect(last.length).toBeGreaterThanOrEqual(20);
    expect(last.length).toBeLessThanOrEqual(25);
    // Crescendo: el promedio del último segundo es mucho más fuerte que el del primero
    const avg = (xs: { v: number }[]) => xs.reduce((a, h) => a + h.v, 0) / xs.length;
    expect(avg(last)).toBeGreaterThan(avg(first) * 2.5);
    // Manos alternadas: los golpes pares e impares no tienen la misma fuerza media
    const even = avg(first.filter((_, i) => i % 2 === 0));
    const odd = avg(first.filter((_, i) => i % 2 === 1));
    expect(Math.abs(even - odd)).toBeGreaterThan(0.005);
    // Continúa donde quedó: el siguiente tramo empieza en "next" y sigue la alternancia
    expect(next).toBeGreaterThanOrEqual(4);
    expect(hand).toBe(hits.length);
    expect(rollRate(0)).toBe(15);
    expect(rollRate(1)).toBe(24);
    expect(rollVelocity(1)).toBeCloseTo(0.8);
  });

  it('el golpe final junta bombo, caja y platillo en el mismo instante', () => {
    const calls: string[] = [];
    const kit = {
      snare: (t: number) => calls.push(`snare@${t}`),
      kick: (t: number) => calls.push(`kick@${t}`),
      crash: (t: number) => calls.push(`crash@${t}`),
      splash: (t: number) => calls.push(`splash@${t}`),
      tone: () => calls.push('tone'),
    };
    scheduleFinale(kit, 2);
    expect(calls.slice(0, 3)).toEqual(['kick@2', 'snare@2', 'crash@2']);
    expect(calls.filter((c) => c === 'tone').length).toBeGreaterThan(0);
  });

  it('un número al agua termina con un bombo suave y un chapuzón, sin platillo ni fanfarria', () => {
    const calls: string[] = [];
    scheduleSplash({ kick: (t) => calls.push(`kick@${t}`), splash: (t) => calls.push(`splash@${t.toFixed(2)}`) }, 2);
    expect(calls).toEqual(['kick@2', 'splash@2.05']);
  });

  it('sin Web Audio el sonido queda en silencio y no falla', () => {
    const s = createDrawSound(false);
    expect(() => {
      s.start();
      s.tick(0.5);
      s.setMuted(true);
      s.reveal();
      s.stop();
    }).not.toThrow();
  });
});

describe('redoble con grabaciones reales', () => {
  // Contexto de audio falso: registra qué nodos se crean, sin sonar
  type Buf = { numberOfChannels: number; length: number; sampleRate: number; duration: number; getChannelData(ch: number): Float32Array };
  const buffer = (data: Float32Array[], sampleRate: number): Buf => ({
    numberOfChannels: data.length,
    length: data[0].length,
    sampleRate,
    duration: data[0].length / sampleRate,
    getChannelData: (ch) => data[ch],
  });
  const param = () => ({ value: 0, setValueAtTime() {}, setTargetAtTime() {}, exponentialRampToValueAtTime() {}, cancelScheduledValues() {} });
  const created: string[] = [];
  class FakeAudioContext {
    static decode: (b: ArrayBuffer) => Promise<Buf> = () => Promise.reject(new Error('sin decodificar'));
    currentTime = 0;
    sampleRate = 100;
    destination = {};
    resume() { return Promise.resolve(); }
    close() { return Promise.resolve(); }
    private node(kind: string) {
      created.push(kind);
      return { connect() {}, start() {}, stop() {}, type: '', loop: false, buffer: null, gain: param(), frequency: param(), playbackRate: param() };
    }
    createGain() { return this.node('gain'); }
    createDynamicsCompressor() { return this.node('compressor'); }
    createBiquadFilter() { return this.node('filter'); }
    createOscillator() { return this.node('oscillator'); }
    createBufferSource() { const n = this.node('source'); return n; }
    createBuffer(ch: number, len: number, sr: number) { return buffer(Array.from({ length: ch }, () => new Float32Array(len)), sr); }
    decodeAudioData(b: ArrayBuffer) { return FakeAudioContext.decode(b); }
  }

  beforeEach(() => {
    created.length = 0;
    vi.stubGlobal('AudioContext', FakeAudioContext);
  });
  afterEach(() => vi.unstubAllGlobals());

  it('arma un bucle sin costura: el final empalma con el principio y el resto es la grabación tal cual', () => {
    const sr = 100;
    const src = Float32Array.from({ length: 200 }, (_, i) => Math.sin(i * 0.37) * 0.5);
    const ctx = new FakeAudioContext() as unknown as BaseAudioContext;
    const loop = makeSeamlessLoop(ctx, buffer([src], sr) as unknown as AudioBuffer, 0.1, 0.3);
    const o = loop.getChannelData(0);
    // 200 muestras − 2×10 de margen − 30 de fundido
    expect(o.length).toBe(150);
    // Fuera del fundido es la grabación desplazada por el margen
    expect(o[30]).toBeCloseTo(src[40]);
    expect(o[149]).toBeCloseTo(src[159]);
    // Al volver al inicio, o[0] continúa exactamente donde terminó (src[160]) y se funde hacia src[10]
    expect(o[0]).toBeCloseTo(src[160], 1);
    expect(o[29]).toBeCloseTo(src[39], 1);
  });

  it('el volumen del redoble grabado crece con la tensión y se aprieta un poco al final', () => {
    expect(sampledRollGain(1) / sampledRollGain(0)).toBeGreaterThan(3.5);
    expect(sampledRollGain(0.5)).toBeGreaterThan(sampledRollGain(0.2));
    expect(sampledRollRate(0)).toBe(1);
    expect(sampledRollRate(1)).toBeCloseTo(1.06);
  });

  it('si las grabaciones no cargan, el sorteo suena igual con el redoble sintetizado', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new TypeError('sin conexión'))));
    const s = createDrawSound(false);
    s.start();
    // Golpes de caja sintetizados: osciladores del parche
    await waitFor(() => expect(created).toContain('oscillator'));
    s.reveal();
    s.stop();
  });

  it('con las grabaciones, el redoble es un bucle de la grabación y el final suena el platillo', async () => {
    const fetchMock = vi.fn(() => Promise.resolve(new Response(new ArrayBuffer(8))));
    vi.stubGlobal('fetch', fetchMock);
    FakeAudioContext.decode = () => Promise.resolve(buffer([new Float32Array(460)], 100));
    const s = createDrawSound(false);
    s.start();
    await waitFor(() => expect(created).toContain('source'));
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(created).not.toContain('oscillator');
    s.tick(1);
    s.reveal();
    // Platillo grabado (segundo source) + bombo sintetizado + fanfarria
    expect(created.filter((c) => c === 'source').length).toBe(2);
    expect(created).toContain('oscillator');
    s.stop();
  });
});

describe('escenario del sorteo', () => {
  const base = { prize: { orden: 1, nombre: 'Bicicleta' }, total: 300, soundOn: true, onToggleSound: () => {} };

  it('mientras gira no anuncia cada número; Escape o "Saltar animación" lo acelera', async () => {
    const user = userEvent.setup();
    const onSkip = vi.fn();
    render(<DrawStage {...base} stage={{ phase: 'rolling', numero: 7 }} onSkip={onSkip} onClose={() => {}} />);
    const dialog = screen.getByRole('dialog', { name: 'Sorteando…' });
    expect(within(dialog).getByText('007')).toBeInTheDocument();
    expect(within(dialog).getByText('1° premio · Bicicleta')).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Saltar animación' }));
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onSkip).toHaveBeenCalledTimes(2);
  });

  it('un número al agua se anuncia sin celebrar, con su dueño', () => {
    render(<DrawStage {...base} stage={{ phase: 'reveal', tipo: 'agua', numero: 42, ganador: 'Rosa D.' }} onSkip={() => {}} onClose={() => {}} />);
    const dialog = screen.getByRole('dialog', { name: /Al agua/ });
    expect(within(dialog).getByText('Número al agua', { exact: false }).parentElement).toHaveTextContent('Número al agua 042');
    expect(within(dialog).getByText('Era de Rosa D.')).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Continuar' })).toHaveFocus();
  });

  it('al revelar anuncia el número y el ganador, enfoca "Continuar" y se cierra con Escape', () => {
    const onClose = vi.fn();
    render(<DrawStage {...base} stage={{ phase: 'reveal', numero: 42, ganador: 'Juan S.' }} onSkip={() => {}} onClose={onClose} />);
    const dialog = screen.getByRole('dialog', { name: /Tenemos ganador/ });
    expect(within(dialog).getByText('Número ganador', { exact: false }).parentElement).toHaveTextContent('Número ganador 042');
    expect(within(dialog).getByText('Juan S.')).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Continuar' })).toHaveFocus();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).toHaveBeenCalled();
  });
});

describe('sorteo en vivo de punta a punta', () => {
  const USER = { id: 1, nombre: 'Ana', email: 'ana@example.cl' };
  const raffle = (): AdminRaffle => ({
    id: 7, slug: 's', nombre: 'Rifa', proposito: 'otro', objetivo: '', metaMonto: 0, precioNumero: 1000, cantidadTalonarios: 1,
    numerosPorTalonario: 10, maxNumerosPorOrden: 20, ttlReservaDias: 7, fechaSorteo: future, numeroAutorizacion: null,
    bancoNombre: null, bancoTipoCuenta: null, bancoNumeroCuenta: null, bancoTitular: null, bancoRut: null, bancoEmailAviso: null,
    estado: 'cerrada', premios: [{ id: 11, orden: 1, nombre: 'Bicicleta', descripcion: '', imagenUrl: null }], rol: 'organizador',
    resumen: { disponibles: 0, reservados: 0, pagados: 10, total: 10, talonariosDisponibles: 0, recaudado: 10000, porCobrar: 0, metaMonto: 0 }, vendedor: null,
  });
  const winner: AdminDraw = {
    id: 1, tipo: 'premio', premio: { id: 11, orden: 1, nombre: 'Bicicleta' }, numero: 4, modo: 'aleatorio', semilla: 'x', participantes: 10, posicion: 3,
    detalle: null, sorteadoEn: future, anuladoEn: null, motivoAnulacion: null, ordenId: 2, compradorNombre: 'Juan Soto',
    compradorContacto: '912345678', vendedorNombre: null,
  };
  let draws: AdminDraw[];

  beforeAll(() => import('../src/admin/AdminApp'));
  beforeEach(() => {
    draws = [];
    // jsdom no dibuja en canvas: el confeti se omite en silencio
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
    // Sin movimiento reducido: hay escenario, suspenso y celebración
    vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: false, addEventListener() {}, removeEventListener() {} })));
    const routes: Record<string, () => { status?: number; body: unknown }> = {
      'GET /api/auth/me': () => ({ body: USER }),
      'GET /api/admin/rifas/7': () => ({ body: raffle() }),
      'GET /api/admin/rifas/7/sorteos': () => ({ body: draws }),
      'GET /api/admin/rifas/7/numeros?estado=pagado': () => ({ body: Array.from({ length: 10 }, (_, i) => ({ numero: i + 1 })) }),
      'POST /api/admin/rifas/7/sorteos': () => {
        draws = [winner];
        return { status: 201, body: winner };
      },
    };
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init: RequestInit = {}) => {
        const h = routes[`${init.method ?? 'GET'} ${url}`];
        const res = h ? h() : { status: 404, body: { error: { code: 'not_found', message: 'No encontrado' } } };
        return new Response(JSON.stringify(res.body), { status: res.status ?? 200, headers: { 'Content-Type': 'application/json' } });
      }),
    );
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('gira, se puede saltar, revela al ganador y al cerrar queda la tarjeta del premio', async () => {
    const user = userEvent.setup();
    render(<MemoryRouter initialEntries={['/admin/rifas/7/sorteo']}><App /></MemoryRouter>);
    await user.click(await screen.findByRole('button', { name: 'Sortear al azar' }));
    const rolling = await screen.findByRole('dialog', { name: 'Sorteando…' }, { timeout: 2000 });
    await user.click(within(rolling).getByRole('button', { name: 'Saltar animación' }));

    const reveal = await screen.findByRole('dialog', { name: /Tenemos ganador/ }, { timeout: 4000 });
    expect(within(reveal).getByText('Juan S.')).toBeInTheDocument();
    expect(within(reveal).getByText('Número ganador', { exact: false }).parentElement).toHaveTextContent('04');
    await user.click(within(reveal).getByRole('button', { name: 'Continuar' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(within(screen.getByRole('article', { name: '1° premio: Bicicleta' })).getByText('Juan Soto')).toBeInTheDocument();
  }, 15000);

  it('el sonido se puede apagar antes de sortear y la preferencia se recuerda', async () => {
    const user = userEvent.setup();
    localStorage.removeItem('mis-rifas:sonido-sorteo');
    render(<MemoryRouter initialEntries={['/admin/rifas/7/sorteo']}><App /></MemoryRouter>);
    const toggle = await screen.findByRole('button', { name: 'Sonido del sorteo activado' });
    expect(toggle).toHaveAttribute('aria-pressed', 'true');
    await user.click(toggle);
    expect(screen.getByRole('button', { name: 'Sonido del sorteo desactivado' })).toHaveAttribute('aria-pressed', 'false');
    expect(localStorage.getItem('mis-rifas:sonido-sorteo')).toBe('off');
  });
});

describe('barra de pestañas', () => {
  const items = ['Resumen', 'Órdenes', 'Números', 'Vendedores', 'Contactos', 'Carga rápida', 'Enlaces de pago', 'Sorteo', 'Configuración'].map((label, i) => ({
    key: `t${i}`,
    label,
    to: `/t${i}`,
  }));

  afterEach(() => vi.restoreAllMocks());

  it('si no caben, muestra la flecha para ver más y desplaza al pulsarla', async () => {
    vi.spyOn(HTMLElement.prototype, 'scrollWidth', 'get').mockReturnValue(1200);
    vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(400);
    const scrollBy = vi.fn();
    Object.defineProperty(HTMLElement.prototype, 'scrollBy', { configurable: true, value: scrollBy });
    render(<MemoryRouter><TabBar label="Secciones" items={items} current="t0" /></MemoryRouter>);
    const more = await screen.findByRole('button', { name: 'Ver más secciones' });
    expect(screen.queryByRole('button', { name: 'Ver secciones anteriores' })).not.toBeInTheDocument();
    fireEvent.click(more);
    expect(scrollBy).toHaveBeenCalledWith({ left: 240, behavior: 'smooth' });
    // Todas las pestañas siguen en la navegación (nada queda fuera del alcance del teclado)
    expect(within(screen.getByRole('navigation', { name: 'Secciones' })).getAllByRole('link')).toHaveLength(9);
    expect(screen.getByRole('link', { name: 'Resumen' })).toHaveAttribute('aria-current', 'page');
  });

  it('si caben, no muestra flechas', () => {
    render(<MemoryRouter><TabBar label="Secciones" items={items.slice(0, 3)} current="t1" /></MemoryRouter>);
    expect(screen.queryByRole('button', { name: /secciones/ })).not.toBeInTheDocument();
  });
});

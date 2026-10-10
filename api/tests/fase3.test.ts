import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sequelize } from '../src/db';
import { Draw, Order } from '../src/models';
import { pickPosition } from '../src/services/draws';
import { outbox } from '../src/services/mailer';
import { H, PNG, activeRaffle, app, login, makeUser, resetDb } from './helpers';

let ana: request.Agent; // organizadora
let beto: request.Agent; // editor
let R: { id: number; slug: string };
let prizes: { id: number; orden: number }[];
let pendingToken: string;
let firstDraw: any;

const sale = (numeros: number[], compradorNombre: string, pagada = true) =>
  beto.post(`/api/admin/rifas/${R.id}/ordenes-manuales`).set(H)
    .send({ tipo: 'numeros', numeros, compradorNombre, compradorContacto: '+56911112222', canal: 'fisica', pagada });
const draw = (body: Record<string, unknown>, agent = ana) => agent.post(`/api/admin/rifas/${R.id}/sorteos`).set(H).send(body);
const publicView = async () => (await request(app).get(`/api/rifas/${R.slug}`)).body;
const setState = (estado: string) => ana.patch(`/api/admin/rifas/${R.id}`).set(H).send({ estado });

beforeAll(async () => {
  await resetDb();
  await makeUser('Ana', 'ana@example.com');
  await makeUser('Beto', 'beto@example.com');
  ana = await login('ana@example.com');
  beto = await login('beto@example.com');
  R = await activeRaffle(ana, { cantidadTalonarios: 2, numerosPorTalonario: 5 }); // números 1-10
  await ana.post(`/api/admin/rifas/${R.id}/miembros`).set(H).send({ email: 'beto@example.com' });
  prizes = [];
  for (const [orden, nombre] of [[1, 'Bicicleta'], [2, 'Canasta']] as const) {
    prizes.push((await ana.post(`/api/admin/rifas/${R.id}/premios`).set(H).send({ orden, nombre })).body);
  }
  await sale([1, 2, 3], 'Ana Compradora');
  await sale([4], 'Beto Comprador');
  const web = await request(app).post(`/api/rifas/${R.slug}/ordenes`).send({ tipo: 'numeros', numeros: [5], compradorNombre: 'Pendiente', compradorContacto: '+56900000000' });
  pendingToken = web.body.token;
});
afterAll(() => sequelize.close());

describe('posición del sorteo', () => {
  it('es SHA-256(semilla) mod participantes: determinista y dentro del rango', () => {
    expect(pickPosition('abc', 10)).toBe(pickPosition('abc', 10));
    // sha256("abc") = ba7816bf…15ad; su valor módulo 7 calculado aparte
    expect(pickPosition('abc', 7)).toBe(Number(BigInt('0xba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad') % 7n));
    const counts = new Array(5).fill(0);
    for (let i = 0; i < 2000; i++) counts[pickPosition(`semilla-${i}`, 5)]++;
    expect(Math.min(...counts)).toBeGreaterThan(300); // reparto razonable entre las 5 posiciones
  });
});

describe('avisos por correo al equipo', () => {
  it('al subir un comprobante se avisa al organizador y a los editores', async () => {
    outbox.length = 0;
    const up = await request(app).post(`/api/ordenes/${pendingToken}/comprobantes`).attach('archivo', PNG, 'transferencia.png');
    expect(up.status).toBe(201);
    await new Promise((r) => setTimeout(r, 50)); // el aviso no bloquea la respuesta
    expect(outbox).toHaveLength(1);
    expect(outbox[0].to).toEqual(['ana@example.com', 'beto@example.com']);
    expect(outbox[0].subject).toMatch(/Comprobante nuevo/);
    expect(outbox[0].text).toMatch(/Pendiente subió un comprobante.*números 5 por \$1\.000/);
    expect(outbox[0].text).toMatch(/http:\/\/localhost:5173\/admin\/rifas\/\d+\/ordenes/);
  });
});

describe('sorteo al azar', () => {
  it('solo el organizador sortea, y solo con la venta cerrada', async () => {
    expect((await draw({ premioId: prizes[0].id })).status).toBe(409);
    expect((await draw({ premioId: prizes[0].id })).body.error.message).toMatch(/Cierra la venta/);
    await setState('cerrada');
    expect((await draw({ premioId: prizes[0].id }, beto)).status).toBe(403);
  });

  it('avisa si hay reservas sin pagar; con confirmación sortea entre los números pagados', async () => {
    const warn = await draw({ premioId: prizes[0].id });
    expect(warn.status).toBe(409);
    expect(warn.body.error).toMatchObject({ code: 'pending_orders', details: { pendientes: 1, conComprobante: 1 } });

    outbox.length = 0;
    const res = await draw({ premioId: prizes[0].id, confirmarPendientes: true });
    expect(res.status).toBe(201);
    firstDraw = res.body;
    expect(firstDraw).toMatchObject({ modo: 'aleatorio', participantes: 4, premio: { nombre: 'Bicicleta' } });
    expect(firstDraw.semilla).toMatch(/^[0-9a-f]{64}$/);
    expect(firstDraw.posicion).toBe(pickPosition(firstDraw.semilla, 4));
    expect([1, 2, 3, 4][firstDraw.posicion]).toBe(firstDraw.numero);
    expect(firstDraw.compradorNombre).toBe(firstDraw.numero === 4 ? 'Beto Comprador' : 'Ana Compradora');

    await new Promise((r) => setTimeout(r, 50));
    expect(outbox[0].subject).toMatch(/Sorteo de .*: Bicicleta/);
    expect(outbox[0].text).toContain(`El número ${firstDraw.numero} ganó "Bicicleta"`);
  });

  it('cualquiera puede verificarlo: la lista de participantes y la cuenta son públicas', async () => {
    const pub = await publicView();
    const d = pub.sorteos.find((x: any) => x.id === firstDraw.id);
    expect(d).toMatchObject({ numero: firstDraw.numero, semilla: firstDraw.semilla, participantes: 4, anuladoEn: null });
    expect(d).not.toHaveProperty('compradorNombre');
    const parts = await request(app).get(`/api/rifas/${R.slug}/sorteos/${firstDraw.id}/participantes`);
    expect(parts.body.numeros).toEqual([1, 2, 3, 4]);
    expect(parts.body.numeros[pickPosition(d.semilla, parts.body.numeros.length)]).toBe(d.numero);
  });

  it('después del primer sorteo no se confirman, extienden ni registran ventas, ni se reabre la venta', async () => {
    const pending: any = await Order.findOne({ where: { token: pendingToken } });
    expect((await beto.post(`/api/admin/ordenes/${pending.id}/confirmar`).set(H)).status).toBe(409);
    expect((await beto.post(`/api/admin/ordenes/${pending.id}/extender`).set(H).send({ dias: 3 })).status).toBe(409);
    expect((await sale([6], 'Tarde')).status).toBe(409);
    expect((await setState('activa')).status).toBe(409);
    // Cancelar una orden sin premio sí se puede
    expect((await beto.post(`/api/admin/ordenes/${pending.id}/cancelar`).set(H)).status).toBe(200);
  });

  it('la orden ganadora no se puede cancelar y su comprador ve el premio', async () => {
    const winner: any = await Order.findOne({ where: { compradorNombre: firstDraw.compradorNombre } });
    const c = await beto.post(`/api/admin/ordenes/${winner.id}/cancelar`).set(H);
    expect(c.status).toBe(409);
    expect(c.body.error.message).toMatch(/ganó un premio/);
    const mine = await request(app).get(`/api/ordenes/${winner.token}`);
    expect(mine.body.premios).toEqual([{ numero: firstDraw.numero, orden: 1, nombre: 'Bicicleta' }]);
  });

  it('un premio con ganador no se sortea de nuevo sin anular', async () => {
    const again = await draw({ premioId: prizes[0].id, confirmarPendientes: true });
    expect(again.status).toBe(409);
    expect(again.body.error.message).toMatch(/ya tiene ganador/);
  });
});

describe('sorteo externo (Lotería, tómbola)', () => {
  it('valida el número y el detalle; con el último premio la rifa queda sorteada', async () => {
    const free = [1, 2, 3, 4].find((n) => n !== firstDraw.numero)!;
    expect((await draw({ premioId: prizes[1].id, modo: 'manual', numero: free })).status).toBe(400); // falta detalle
    const notPaid = await draw({ premioId: prizes[1].id, modo: 'manual', numero: 7, detalle: 'Lotería, 3 cifras' });
    expect(notPaid.body.error.message).toBe('El número 7 no está pagado: no participa');
    const twice = await draw({ premioId: prizes[1].id, modo: 'manual', numero: firstDraw.numero, detalle: 'Lotería, 3 cifras' });
    expect(twice.body.error.message).toBe(`El número ${firstDraw.numero} ya ganó otro premio`);

    const ok = await draw({ premioId: prizes[1].id, modo: 'manual', numero: free, detalle: 'Lotería del 12/11, 3 últimas cifras' });
    expect(ok.status).toBe(201);
    expect(ok.body).toMatchObject({ modo: 'manual', numero: free, semilla: null, detalle: 'Lotería del 12/11, 3 últimas cifras', participantes: 3 });
    expect((await publicView()).estado).toBe('sorteada');
    expect((await draw({ premioId: prizes[1].id })).body.error.message).toMatch(/Todos los premios/);
  });

  it('una rifa sorteada no acepta premios nuevos ni borrar premios sorteados', async () => {
    expect((await ana.post(`/api/admin/rifas/${R.id}/premios`).set(H).send({ orden: 3, nombre: 'Extra' })).status).toBe(409);
    expect((await ana.delete(`/api/admin/rifas/${R.id}/premios/${prizes[1].id}`).set(H)).status).toBe(409);
  });
});

describe('anular un sorteo', () => {
  it('solo el organizador, con motivo; queda publicado y el premio se vuelve a sortear', async () => {
    const d2: any = await Draw.findOne({ where: { prizeId: prizes[1].id, anuladoEn: null } });
    expect((await beto.post(`/api/admin/sorteos/${d2.id}/anular`).set(H).send({ motivo: 'Ganador no aparece' })).status).toBe(403);
    expect((await ana.post(`/api/admin/sorteos/${d2.id}/anular`).set(H).send({ motivo: 'no' })).status).toBe(400);
    const a = await ana.post(`/api/admin/sorteos/${d2.id}/anular`).set(H).send({ motivo: 'Error al anotar el número' });
    expect(a.status).toBe(200);
    expect(a.body.motivoAnulacion).toBe('Error al anotar el número');

    const pub = await publicView();
    expect(pub.estado).toBe('cerrada');
    expect(pub.sorteos.find((x: any) => x.id === d2.id)).toMatchObject({ motivoAnulacion: 'Error al anotar el número' });
    expect((await ana.post(`/api/admin/sorteos/${d2.id}/anular`).set(H).send({ motivo: 'Otra vez' })).status).toBe(409);

    const redo = await draw({ premioId: prizes[1].id });
    expect(redo.status).toBe(201);
    expect(redo.body.participantes).toBe(3); // el número anulado vuelve a participar
    expect((await publicView()).estado).toBe('sorteada');
    const list = (await beto.get(`/api/admin/rifas/${R.id}/sorteos`)).body;
    expect(list.map((d: any) => [d.premio.orden, d.anuladoEn === null])).toEqual([[1, true], [2, true], [2, false]]);
  });
});

describe('sorteos simultáneos', () => {
  it('con 5 sorteos a la vez del mismo premio solo uno gana', async () => {
    const S = await activeRaffle(ana, { nombre: 'Rifa Concurrencia', cantidadTalonarios: 1, numerosPorTalonario: 5 });
    const p = (await ana.post(`/api/admin/rifas/${S.id}/premios`).set(H).send({ orden: 1, nombre: 'Único' })).body;
    await ana.post(`/api/admin/rifas/${S.id}/ordenes-manuales`).set(H)
      .send({ tipo: 'talonario', talonario: 1, compradorNombre: 'Todo', compradorContacto: '912345678', canal: 'fisica', pagada: true });
    await ana.patch(`/api/admin/rifas/${S.id}`).set(H).send({ estado: 'cerrada' });
    const results = await Promise.all(Array.from({ length: 5 }, () => ana.post(`/api/admin/rifas/${S.id}/sorteos`).set(H).send({ premioId: p.id })));
    expect(results.filter((r) => r.status === 201)).toHaveLength(1);
    expect(await Draw.count({ where: { raffleId: S.id } })).toBe(1);
  });
});

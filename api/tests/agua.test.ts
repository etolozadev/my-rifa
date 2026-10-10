import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sequelize } from '../src/db';
import { Order } from '../src/models';
import { H, activeRaffle, app, login, makeUser, resetDb } from './helpers';

let ana: request.Agent; // organizadora
let beto: request.Agent; // editor
let R: { id: number; slug: string };
let prizes: { id: number; orden: number }[];
let firstWater: any;

const draw = (body: Record<string, unknown>, agent = ana) => agent.post(`/api/admin/rifas/${R.id}/sorteos`).set(H).send(body);
const publicView = async () => (await request(app).get(`/api/rifas/${R.slug}`)).body;

beforeAll(async () => {
  await resetDb();
  await makeUser('Ana', 'ana@example.com');
  await makeUser('Beto', 'beto@example.com');
  ana = await login('ana@example.com');
  beto = await login('beto@example.com');
  R = await activeRaffle(ana, { cantidadTalonarios: 1, numerosPorTalonario: 6 }); // números 1-6
  await ana.post(`/api/admin/rifas/${R.id}/miembros`).set(H).send({ email: 'beto@example.com' });
  prizes = [];
  for (const [orden, nombre] of [[1, 'Bicicleta'], [2, 'Canasta']] as const) {
    prizes.push((await ana.post(`/api/admin/rifas/${R.id}/premios`).set(H).send({ orden, nombre })).body);
  }
  // Un comprador por número, para ver después quién se fue al agua
  for (let n = 1; n <= 6; n++) {
    await ana.post(`/api/admin/rifas/${R.id}/ordenes-manuales`).set(H)
      .send({ tipo: 'numeros', numeros: [n], compradorNombre: `Comprador ${n}`, compradorContacto: '+56911112222', canal: 'fisica', pagada: true });
  }
  await ana.patch(`/api/admin/rifas/${R.id}`).set(H).send({ estado: 'cerrada' });
});
afterAll(() => sequelize.close());

describe('números al agua', () => {
  it('solo el organizador tira números al agua; el número sale al azar y el premio sigue pendiente', async () => {
    expect((await draw({ premioId: prizes[0].id, tipo: 'agua' }, beto)).status).toBe(403);
    const w = await draw({ premioId: prizes[0].id, tipo: 'agua' });
    expect(w.status).toBe(201);
    expect(w.body).toMatchObject({ tipo: 'agua', modo: 'aleatorio', participantes: 6, premio: { id: prizes[0].id } });
    expect(w.body.compradorNombre).toBe(`Comprador ${w.body.numero}`);
    firstWater = w.body;
    expect((await publicView()).estado).toBe('cerrada');
  });

  it('un número al agua no vuelve a salir, ni al azar ni registrado a mano', async () => {
    const again = await draw({ premioId: prizes[0].id, tipo: 'agua', modo: 'manual', numero: firstWater.numero, detalle: 'Tómbola en vivo' });
    expect(again.body.error.message).toBe(`El número ${firstWater.numero} ya se fue al agua`);
    const asWinner = await draw({ premioId: prizes[0].id, modo: 'manual', numero: firstWater.numero, detalle: 'Tómbola en vivo' });
    expect(asWinner.body.error.message).toBe(`El número ${firstWater.numero} ya se fue al agua`);

    const free = [1, 2, 3, 4, 5, 6].find((n) => n !== firstWater.numero)!;
    const manual = await draw({ premioId: prizes[0].id, tipo: 'agua', modo: 'manual', numero: free, detalle: 'Tómbola en vivo' });
    expect(manual.status).toBe(201);
    expect(manual.body).toMatchObject({ tipo: 'agua', modo: 'manual', numero: free, participantes: 5 });

    const winner = await draw({ premioId: prizes[0].id });
    expect(winner.status).toBe(201);
    expect(winner.body.tipo).toBe('premio');
    expect(winner.body.participantes).toBe(4);
    expect([firstWater.numero, free]).not.toContain(winner.body.numero);
  });

  it('con ganador ya no se tiran números al agua para ese premio', async () => {
    const late = await draw({ premioId: prizes[0].id, tipo: 'agua' });
    expect(late.status).toBe(409);
    expect(late.body.error.message).toMatch(/ya tiene ganador/);
  });

  it('siempre queda al menos un número para el premio', async () => {
    // Quedan 3: dos al agua y el tercero ya no puede irse
    expect((await draw({ premioId: prizes[1].id, tipo: 'agua' })).body.participantes).toBe(3);
    expect((await draw({ premioId: prizes[1].id, tipo: 'agua' })).body.participantes).toBe(2);
    const last = await draw({ premioId: prizes[1].id, tipo: 'agua' });
    expect(last.status).toBe(409);
    expect(last.body.error.message).toMatch(/Queda un solo número/);
    const winner = await draw({ premioId: prizes[1].id });
    expect(winner.body.participantes).toBe(1);
    expect((await publicView()).estado).toBe('sorteada');
  });

  it('se publican junto a los ganadores, y anular uno lo devuelve sin reabrir la rifa', async () => {
    const pub = await publicView();
    const tipos = pub.sorteos.map((d: any) => `${d.premio.orden}:${d.tipo}`);
    expect(tipos).toEqual(['1:agua', '1:agua', '1:premio', '2:agua', '2:agua', '2:premio']);
    // Los datos del comprador no se publican
    expect(pub.sorteos[0].compradorNombre).toBeUndefined();

    const a = await ana.post(`/api/admin/sorteos/${firstWater.id}/anular`).set(H).send({ motivo: 'Se registró por error' });
    expect(a.status).toBe(200);
    expect((await publicView()).estado).toBe('sorteada');
  });

  it('el comprador de un número al agua no ve premios en su orden', async () => {
    const order: any = await Order.findOne({ where: { raffleId: R.id, compradorNombre: `Comprador ${firstWater.numero}` } });
    const view = await request(app).get(`/api/ordenes/${order.token}`);
    expect(view.body.premios).toEqual([]);
  });
});

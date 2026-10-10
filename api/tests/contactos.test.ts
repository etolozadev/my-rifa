import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sequelize } from '../src/db';
import { Order } from '../src/models';
import { H, activeRaffle, app, login, makeUser, resetDb } from './helpers';

let ana: request.Agent; // organizadora
let beto: request.Agent; // editor
let vale: request.Agent; // vendedora
let R: { id: number; slug: string };
let R2: { id: number; slug: string };
let rosa: any; // contacto

const sale = (agent: request.Agent, body: Record<string, unknown>, raffleId = R.id) =>
  agent.post(`/api/admin/rifas/${raffleId}/ordenes-manuales`).set(H).send({ tipo: 'numeros', compradorNombre: 'Doña Marta', canal: 'fisica', pagada: true, ...body });

beforeAll(async () => {
  await resetDb();
  for (const [n, e] of [['Ana', 'ana'], ['Beto', 'beto'], ['Vale', 'vale']]) await makeUser(n, `${e}@example.com`);
  ana = await login('ana@example.com');
  beto = await login('beto@example.com');
  vale = await login('vale@example.com');
  R = await activeRaffle(ana, { cantidadTalonarios: 4, numerosPorTalonario: 5 }); // 1-20, $1.000 c/u
  R2 = await activeRaffle(ana, { nombre: 'Otra rifa' });
  await ana.post(`/api/admin/rifas/${R.id}/miembros`).set(H).send({ email: 'beto@example.com' });
  await ana.post(`/api/admin/rifas/${R.id}/miembros`).set(H).send({ email: 'vale@example.com', rol: 'vendedor' });
});
afterAll(() => sequelize.close());

describe('contactos de la rifa', () => {
  it('el organizador y los editores los gestionan; un vendedor no', async () => {
    const c = await beto.post(`/api/admin/rifas/${R.id}/contactos`).set(H).send({ nombre: 'Rosa Pérez', telefono: '+56 9 1111 2222', nota: 'hija de doña Marta' });
    expect(c.status).toBe(201);
    rosa = c.body;
    expect(rosa).toMatchObject({ nombre: 'Rosa Pérez', telefono: '+56 9 1111 2222', nota: 'hija de doña Marta', ordenes: 0, vendidos: 0 });
    expect((await vale.get(`/api/admin/rifas/${R.id}/contactos`)).status).toBe(403);
    expect((await vale.post(`/api/admin/rifas/${R.id}/contactos`).set(H).send({ nombre: 'X', telefono: '912345678' })).status).toBe(403);
    expect((await ana.get(`/api/admin/rifas/${R.id}/contactos`)).body.map((x: any) => x.nombre)).toEqual(['Rosa Pérez']);
  });

  it('valida los datos y no repite un teléfono en la misma rifa (comparando solo dígitos)', async () => {
    expect((await ana.post(`/api/admin/rifas/${R.id}/contactos`).set(H).send({ nombre: 'Sin fono', telefono: '123' })).status).toBe(400);
    const dup = await ana.post(`/api/admin/rifas/${R.id}/contactos`).set(H).send({ nombre: 'Otra Rosa', telefono: '56911112222' });
    expect(dup.status).toBe(409);
    expect(dup.body.error.message).toMatch(/Ya hay un contacto con ese teléfono/);
    // En otra rifa el mismo teléfono sí se puede
    expect((await ana.post(`/api/admin/rifas/${R2.id}/contactos`).set(H).send({ nombre: 'Rosa', telefono: '+56 9 1111 2222' })).status).toBe(201);
    const ed = await ana.patch(`/api/admin/rifas/${R.id}/contactos/${rosa.id}`).set(H).send({ nota: 'apoderada 4°B' });
    expect(ed.body).toMatchObject({ id: rosa.id, nota: 'apoderada 4°B' });
  });
});

describe('ventas con persona de contacto', () => {
  it('sin teléfono del comprador basta con la persona de contacto', async () => {
    const r = await sale(beto, { numeros: [1, 2], contactoId: rosa.id });
    expect(r.status).toBe(201);
    const o: any = await Order.findByPk(r.body.id);
    expect(o).toMatchObject({ compradorContacto: null, contactId: rosa.id, contactoVendio: false });
  });

  it('exige al menos el teléfono o la persona de contacto, y un teléfono válido si se escribe', async () => {
    const none = await sale(beto, { numeros: [3] });
    expect(none.status).toBe(400);
    expect(none.body.error.message).toBe('Indica el teléfono del comprador o una persona de contacto');
    expect((await sale(beto, { numeros: [3], compradorContacto: '' })).status).toBe(400);
    expect((await sale(beto, { numeros: [3], compradorContacto: '123' })).status).toBe(400);
    expect((await sale(beto, { numeros: [3], compradorContacto: '912345678' })).status).toBe(201);
  });

  it('no acepta un contacto de otra rifa ni marcar "vendió" sin contacto', async () => {
    const other = (await ana.get(`/api/admin/rifas/${R2.id}/contactos`)).body[0];
    expect((await sale(beto, { numeros: [4], contactoId: other.id })).status).toBe(404);
    expect((await sale(beto, { numeros: [4], compradorContacto: '912345678', contactoVendio: true })).status).toBe(400);
  });

  it('un vendedor registra con teléfono del comprador, pero no puede usar contactos', async () => {
    expect((await sale(vale, { numeros: [5], contactoId: rosa.id })).status).toBe(403);
    expect((await sale(vale, { numeros: [5], compradorContacto: '912345678' })).status).toBe(201);
  });

  it('la carga rápida acepta filas con contacto y sin teléfono; cada fila se valida', async () => {
    const res = await beto.post(`/api/admin/rifas/${R.id}/ventas-lote`).set(H).send({
      ventas: [
        { numeros: [6, 7], compradorNombre: 'Abuelo Juan', contactoId: rosa.id, contactoVendio: true, pagada: true },
        { numeros: [8], compradorNombre: 'Tía Luz', contactoId: rosa.id, contactoVendio: true, pagada: false },
        { numeros: [9], compradorNombre: 'Sin nada', pagada: true },
      ],
    });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ creadas: 2, fallidas: 1 });
    expect(res.body.resultados[2]).toMatchObject({ ok: false, error: 'Indica el teléfono del comprador o una persona de contacto' });
  });

  it('la rendición del contacto cuenta solo lo que vendió', async () => {
    const list = (await ana.get(`/api/admin/rifas/${R.id}/contactos`)).body;
    expect(list.find((c: any) => c.id === rosa.id)).toMatchObject({ ordenes: 3, vendidos: 2, reservados: 1, recaudado: 2000, porCobrar: 1000 });
  });

  it('las órdenes, los números y el sorteo muestran la persona de contacto', async () => {
    const orders = (await ana.get(`/api/admin/rifas/${R.id}/ordenes`)).body;
    const marta = orders.find((o: any) => o.numeros.includes(1));
    expect(marta).toMatchObject({ compradorContacto: null, contacto: { id: rosa.id, nombre: 'Rosa Pérez', telefono: '+56 9 1111 2222' }, contactoVendio: false });

    const nums = (await ana.get(`/api/admin/rifas/${R.id}/numeros`)).body;
    expect(nums.find((t: any) => t.numero === 6)).toMatchObject({ contactoNombre: 'Rosa Pérez', contactoTelefono: '+56 9 1111 2222', contactoVendio: true });
    // Un vendedor no ve el contacto de ventas ajenas
    const seen = (await vale.get(`/api/admin/rifas/${R.id}/numeros`)).body.find((t: any) => t.numero === 6);
    expect(seen).toMatchObject({ compradorNombre: null, contactoNombre: null, contactoTelefono: null });

    // Sorteo: solo números pagados de la rifa con contacto → el ganador trae el contacto
    const premio = (await ana.post(`/api/admin/rifas/${R.id}/premios`).set(H).send({ orden: 1, nombre: 'Canasta' })).body;
    await ana.patch(`/api/admin/rifas/${R.id}`).set(H).send({ estado: 'cerrada' });
    const d = await ana
      .post(`/api/admin/rifas/${R.id}/sorteos`)
      .set(H)
      .send({ premioId: premio.id, modo: 'manual', numero: 6, detalle: 'Tómbola en vivo', confirmarPendientes: true });
    expect(d.status).toBe(201);
    expect(d.body).toMatchObject({ numero: 6, compradorNombre: 'Abuelo Juan', compradorContacto: null, contactoNombre: 'Rosa Pérez', contactoTelefono: '+56 9 1111 2222' });
  });

  it('un contacto con órdenes no se puede eliminar; uno sin órdenes sí', async () => {
    const del = await ana.delete(`/api/admin/rifas/${R.id}/contactos/${rosa.id}`).set(H);
    expect(del.status).toBe(409);
    expect(del.body.error.message).toMatch(/tiene 3 órdenes asociadas/);
    const libre = (await ana.post(`/api/admin/rifas/${R.id}/contactos`).set(H).send({ nombre: 'Sin uso', telefono: '987654321' })).body;
    expect((await ana.delete(`/api/admin/rifas/${R.id}/contactos/${libre.id}`).set(H)).status).toBe(204);
  });

  it('la reserva pública sigue exigiendo el teléfono del comprador', async () => {
    const r = await request(app).post(`/api/rifas/${R2.slug}/ordenes`).send({ tipo: 'numeros', numeros: [1], compradorNombre: 'Web' });
    expect(r.status).toBe(400);
  });
});

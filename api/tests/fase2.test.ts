import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sequelize } from '../src/db';
import { AuditLog, Order, Seller, ShareLink } from '../src/models';
import { H, PASSWORD, activeRaffle, app, login, makeUser, resetDb } from './helpers';

let ana: request.Agent; // organizadora
let beto: request.Agent; // editor
let vale: request.Agent; // vendedora
let vico: request.Agent; // vendedor
let R: { id: number; slug: string };
let valeSeller: any;
let vicoSeller: any;

const grid = async (v?: string) => (await request(app).get(`/api/rifas/${R.slug}${v ? `?v=${v}` : ''}`)).body;
const stateOf = async (n: number, v?: string) => (await grid(v)).numeros.find((x: any) => x.n === n).e;
const buyer = { compradorNombre: 'Comprador Web', compradorContacto: '+56911112222' };
const reserveWeb = (numeros: number[], vendedor?: string) =>
  request(app).post(`/api/rifas/${R.slug}/ordenes`).send({ tipo: 'numeros', numeros, ...buyer, ...(vendedor ? { vendedor } : {}) });

beforeAll(async () => {
  await resetDb();
  for (const [n, e] of [['Ana', 'ana'], ['Beto', 'beto'], ['Vale', 'vale'], ['Vico', 'vico']]) await makeUser(n, `${e}@example.com`);
  ana = await login('ana@example.com');
  beto = await login('beto@example.com');
  vale = await login('vale@example.com');
  vico = await login('vico@example.com');
  // 4 talonarios de 5 números: 1-20
  R = await activeRaffle(ana, { cantidadTalonarios: 4, numerosPorTalonario: 5 });
  await ana.post(`/api/admin/rifas/${R.id}/miembros`).set(H).send({ email: 'beto@example.com' });
  expect((await ana.post(`/api/admin/rifas/${R.id}/miembros`).set(H).send({ email: 'vale@example.com', rol: 'vendedor' })).status).toBe(201);
  expect((await ana.post(`/api/admin/rifas/${R.id}/miembros`).set(H).send({ email: 'vico@example.com', rol: 'vendedor' })).status).toBe(201);
  const sellers: any[] = (await beto.get(`/api/admin/rifas/${R.id}/vendedores`)).body;
  valeSeller = sellers.find((s) => s.nombre === 'Vale');
  vicoSeller = sellers.find((s) => s.nombre === 'Vico');
});
afterAll(() => sequelize.close());

describe('vendedores', () => {
  it('cada vendedor tiene su enlace; ve la rifa y su rendición, pero no administra', async () => {
    expect(valeSeller.codigoEnlace).toMatch(/^[\w-]{8}$/);
    expect(valeSeller.codigoEnlace).not.toBe(vicoSeller.codigoEnlace);
    const me = await vale.get(`/api/admin/rifas/${R.id}`);
    expect(me.status).toBe(200);
    expect(me.body.rol).toBe('vendedor');
    expect(me.body.vendedor).toMatchObject({ id: valeSeller.id, codigoEnlace: valeSeller.codigoEnlace, vendidos: 0 });
    expect((await vale.get(`/api/admin/rifas/${R.id}/vendedores`)).status).toBe(403);
    expect((await vale.patch(`/api/admin/rifas/${R.id}`).set(H).send({ nombre: 'Otra' })).status).toBe(403);
    expect((await vale.get(`/api/admin/rifas/${R.id}/miembros`)).status).toBe(403);
    const list = (await vale.get('/api/admin/rifas')).body;
    expect(list).toEqual([expect.objectContaining({ id: R.id, rol: 'vendedor' })]);
  });

  it('los números asignados a un vendedor no se ofrecen en la web, salvo con su enlace', async () => {
    const a = await beto.post(`/api/admin/rifas/${R.id}/vendedores/${valeSeller.id}/asignar`).set(H).send({ talonarios: [1] });
    expect(a.status).toBe(200);
    expect(a.body.vendedor).toMatchObject({ asignados: 5, asignadosRangos: '1-5' });

    expect(await stateOf(1)).toBe('reservado');
    expect((await grid()).avance.disponibles).toBe(15);
    const viaVale = await grid(valeSeller.codigoEnlace);
    expect(viaVale.vendedor).toEqual({ nombre: 'Vale' });
    expect(viaVale.numeros.find((x: any) => x.n === 1).e).toBe('disponible');
    expect(await stateOf(1, vicoSeller.codigoEnlace)).toBe('reservado');

    const sinEnlace = await reserveWeb([1, 6]);
    expect(sinEnlace.status).toBe(409);
    expect(sinEnlace.body.error.details.noDisponibles).toEqual([1]);
    expect(await stateOf(6)).toBe('disponible'); // atómico

    const conVico = await reserveWeb([2], vicoSeller.codigoEnlace);
    expect(conVico.status).toBe(409);

    const conVale = await reserveWeb([1, 6], valeSeller.codigoEnlace);
    expect(conVale.status).toBe(201);
    const order: any = await Order.findOne({ where: { token: conVale.body.token } });
    expect(order.sellerId).toBe(valeSeller.id);
  });

  it('un código de vendedor inválido no bloquea la compra: queda sin atribución', async () => {
    const r = await reserveWeb([7], 'codigo-falso');
    expect(r.status).toBe(201);
    expect(((await Order.findOne({ where: { token: r.body.token } })) as any).sellerId).toBeNull();
    expect((await grid('codigo-falso')).vendedor).toBeNull();
  });

  it('no se asignan números ocupados ni de otro vendedor (todo o nada); se pueden liberar los no vendidos', async () => {
    const r = await beto.post(`/api/admin/rifas/${R.id}/vendedores/${vicoSeller.id}/asignar`).set(H).send({ numeros: [5, 6, 8] });
    expect(r.status).toBe(409);
    expect(r.body.error.details.noDisponibles).toEqual([5, 6]);
    expect(await stateOf(8)).toBe('disponible');

    expect((await beto.post(`/api/admin/rifas/${R.id}/vendedores/${vicoSeller.id}/asignar`).set(H).send({ numeros: [8, 9, 10] })).status).toBe(200);
    // El 1 ya está vendido (reservado): liberar solo devuelve los libres
    const l = await beto.post(`/api/admin/rifas/${R.id}/vendedores/${valeSeller.id}/liberar`).set(H).send({ numeros: [1, 5] });
    expect(l.body).toMatchObject({ liberados: 1, vendedor: { asignadosRangos: '1-4' } });
    expect(await stateOf(5)).toBe('disponible');
    expect((await vale.post(`/api/admin/rifas/${R.id}/vendedores/${valeSeller.id}/asignar`).set(H).send({ numeros: [5] })).status).toBe(403);
  });

  it('un vendedor registra ventas a su nombre solo con sus números o los libres; el equipo con cualquiera', async () => {
    const mine = await vale.post(`/api/admin/rifas/${R.id}/ordenes-manuales`).set(H)
      .send({ tipo: 'numeros', numeros: [2, 3], compradorNombre: 'Tía Rosa', compradorContacto: '+56922223333', canal: 'fisica', pagada: true });
    expect(mine.status).toBe(201);
    expect(((await Order.findByPk(mine.body.id)) as any).sellerId).toBe(valeSeller.id);

    const others = await vale.post(`/api/admin/rifas/${R.id}/ordenes-manuales`).set(H)
      .send({ tipo: 'numeros', numeros: [8], ...buyer, canal: 'fisica', pagada: true, vendedorId: vicoSeller.id });
    expect(others.status).toBe(409); // el 8 está en el talonario de Vico; vendedorId se ignora para un vendedor

    const teamSale = await beto.post(`/api/admin/rifas/${R.id}/ordenes-manuales`).set(H)
      .send({ tipo: 'numeros', numeros: [8], ...buyer, canal: 'fisica', pagada: true, vendedorId: vicoSeller.id });
    expect(teamSale.status).toBe(201);
    expect(((await Order.findByPk(teamSale.body.id)) as any).sellerId).toBe(vicoSeller.id);
  });

  it('un vendedor solo ve y opera sus propias ventas', async () => {
    const orders = (await vale.get(`/api/admin/rifas/${R.id}/ordenes`)).body;
    expect(orders.length).toBe(2);
    expect(orders.every((o: any) => o.vendedorNombre === 'Vale')).toBe(true);

    const nums = (await vale.get(`/api/admin/rifas/${R.id}/numeros`)).body;
    expect(nums.find((x: any) => x.numero === 8)).toMatchObject({ estado: 'pagado', compradorNombre: null, vendedorNombre: 'Vico' });
    expect(nums.find((x: any) => x.numero === 2)).toMatchObject({ compradorNombre: 'Tía Rosa', vendedorNombre: 'Vale' });

    const pending = orders.find((o: any) => o.estado === 'pendiente');
    expect((await vale.post(`/api/admin/ordenes/${pending.id}/confirmar`).set(H)).status).toBe(200);
    const vicoOrder: any = await Order.findOne({ where: { sellerId: vicoSeller.id } });
    expect((await vale.post(`/api/admin/ordenes/${vicoOrder.id}/cancelar`).set(H)).status).toBe(403);
    expect((await vico.get(`/api/admin/rifas/${R.id}/ordenes`)).body.map((o: any) => o.id)).toEqual([vicoOrder.id]);
  });

  it('la rendición cuenta vendidos, reservados y montos por vendedor', async () => {
    await reserveWeb([4], valeSeller.codigoEnlace); // queda reservado
    const stats: any[] = (await ana.get(`/api/admin/rifas/${R.id}/vendedores`)).body;
    expect(stats.find((s) => s.id === valeSeller.id)).toMatchObject({ vendidos: 4, reservados: 1, recaudado: 4000, porCobrar: 1000 });
    expect(stats.find((s) => s.id === vicoSeller.id)).toMatchObject({ vendidos: 1, asignados: 3, asignadosLibres: 2 });
  });

  it('quitar a un vendedor desactiva su enlace y libera sus números no vendidos, pero conserva sus ventas', async () => {
    const vicoUser = (await ana.get(`/api/admin/rifas/${R.id}/miembros`)).body.find((m: any) => m.nombre === 'Vico');
    expect((await ana.delete(`/api/admin/rifas/${R.id}/miembros/${vicoUser.userId}`).set(H)).status).toBe(204);
    expect(await stateOf(9)).toBe('disponible');
    expect((await grid(vicoSeller.codigoEnlace)).vendedor).toBeNull();
    expect(await Order.count({ where: { sellerId: vicoSeller.id } })).toBe(1);
    expect((await vico.get(`/api/admin/rifas/${R.id}`)).status).toBe(403);
    // Volver a sumarlo reactiva el mismo enlace
    await ana.post(`/api/admin/rifas/${R.id}/miembros`).set(H).send({ email: 'vico@example.com', rol: 'vendedor' });
    expect(((await Seller.findByPk(vicoSeller.id)) as any).activo).toBe(true);
    expect((await grid(vicoSeller.codigoEnlace)).vendedor).toEqual({ nombre: 'Vico' });
  });
});

describe('carga rápida', () => {
  it('registra varias ventas; cada fila es independiente y reporta los números ocupados', async () => {
    const res = await beto.post(`/api/admin/rifas/${R.id}/ventas-lote`).set(H).send({
      ventas: [
        { numeros: [11, 12], compradorNombre: 'Pedro', compradorContacto: '912345678', pagada: true },
        { numeros: [12, 13], compradorNombre: 'Juana', compradorContacto: '912345679', pagada: true },
        { numeros: [14], compradorNombre: 'Luis', compradorContacto: '912345670', pagada: false, vendedorId: valeSeller.id },
      ],
    });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ creadas: 2, fallidas: 1 });
    expect(res.body.resultados[1]).toMatchObject({ fila: 2, ok: false, noDisponibles: [12] });
    expect(await stateOf(11)).toBe('pagado');
    expect(await stateOf(13)).toBe('disponible');
    expect(await stateOf(14)).toBe('reservado');
    const luis: any = await Order.findByPk(res.body.resultados[2].ordenId);
    expect(luis).toMatchObject({ sellerId: valeSeller.id, canal: 'fisica' });
    expect(await AuditLog.count({ where: { accion: 'carga_lote' } })).toBe(1);
  });

  it('valida el lote completo antes de procesar', async () => {
    const bad = await beto.post(`/api/admin/rifas/${R.id}/ventas-lote`).set(H).send({ ventas: [{ numeros: [], compradorNombre: 'X', compradorContacto: '1' }] });
    expect(bad.status).toBe(400);
  });
});

describe('enlaces de pago previo', () => {
  it('quien ya pagó elige exactamente su cupo y la orden nace pagada; el enlace es de un solo uso', async () => {
    const c = await beto.post(`/api/admin/rifas/${R.id}/enlaces`).set(H).send({ cupo: 2, compradorNombre: 'Abuela Marta' });
    expect(c.status).toBe(201);
    expect(c.body).toMatchObject({ cupo: 2, estado: 'vigente', ordenId: null });

    const info = await request(app).get(`/api/enlaces/${c.body.token}`);
    expect(info.body).toMatchObject({ estado: 'vigente', cupo: 2, compradorNombre: 'Abuela Marta', ordenToken: null });
    expect(info.body.rifa.slug).toBe(R.slug);

    const use = (numeros: number[]) =>
      request(app).post(`/api/enlaces/${c.body.token}/usar`).send({ tipo: 'numeros', numeros, compradorNombre: 'Abuela Marta', compradorContacto: '+56933334444' });
    expect((await use([15])).status).toBe(400);
    const ok = await use([15, 16]);
    expect(ok.status).toBe(201);
    expect(ok.body.monto).toBe(2000);
    const order: any = await Order.findOne({ where: { token: ok.body.token } });
    expect(order).toMatchObject({ estado: 'pagada', canal: 'manual' });
    expect(await stateOf(16)).toBe('pagado');

    expect((await use([17, 18])).status).toBe(409);
    const after = await request(app).get(`/api/enlaces/${c.body.token}`);
    expect(after.body).toMatchObject({ estado: 'usado', ordenToken: ok.body.token });
    // El pedido público de la orden lo ve como pagada
    expect((await request(app).get(`/api/ordenes/${ok.body.token}`)).body.estado).toBe('pagada');
  });

  it('un enlace anulado o vencido no se puede usar', async () => {
    const a = (await beto.post(`/api/admin/rifas/${R.id}/enlaces`).set(H).send({ cupo: 1 })).body;
    expect((await beto.post(`/api/admin/enlaces/${a.id}/revocar`).set(H)).body.estado).toBe('revocado');
    const r1 = await request(app).post(`/api/enlaces/${a.token}/usar`).send({ tipo: 'numeros', numeros: [17], ...buyer });
    expect(r1.status).toBe(409);

    const b = (await beto.post(`/api/admin/rifas/${R.id}/enlaces`).set(H).send({ cupo: 1 })).body;
    await ShareLink.update({ venceEn: new Date(Date.now() - 1000) }, { where: { id: b.id } });
    expect((await request(app).get(`/api/enlaces/${b.token}`)).body.estado).toBe('vencido');
    expect((await request(app).post(`/api/enlaces/${b.token}/usar`).send({ tipo: 'numeros', numeros: [17], ...buyer })).status).toBe(409);
  });

  it('el enlace de un vendedor le permite elegir sus números asignados y la venta queda a su nombre', async () => {
    const link = (await vale.post(`/api/admin/rifas/${R.id}/enlaces`).set(H).send({ cupo: 1 })).body;
    expect(link.vendedorId).toBe(valeSeller.id);
    const info = await request(app).get(`/api/enlaces/${link.token}`);
    expect(info.body.rifa.numeros.find((x: any) => x.n === 5).e).toBe('disponible'); // 5 volvió al stock general
    await beto.post(`/api/admin/rifas/${R.id}/vendedores/${valeSeller.id}/asignar`).set(H).send({ numeros: [5] });
    expect((await request(app).get(`/api/enlaces/${link.token}`)).body.rifa.numeros.find((x: any) => x.n === 5).e).toBe('disponible');
    const ok = await request(app).post(`/api/enlaces/${link.token}/usar`).send({ tipo: 'numeros', numeros: [5], ...buyer });
    expect(ok.status).toBe(201);
    expect(((await Order.findOne({ where: { token: ok.body.token } })) as any).sellerId).toBe(valeSeller.id);
    // Un vendedor solo ve y anula sus propios enlaces
    expect((await vale.get(`/api/admin/rifas/${R.id}/enlaces`)).body.map((l: any) => l.id)).toEqual([link.id]);
    const teamLink = (await beto.post(`/api/admin/rifas/${R.id}/enlaces`).set(H).send({ cupo: 1 })).body;
    expect((await vale.post(`/api/admin/enlaces/${teamLink.id}/revocar`).set(H)).status).toBe(403);
  });
});

describe('invitaciones por link', () => {
  it('solo el organizador invita; la persona crea su cuenta al aceptar y queda como vendedora', async () => {
    expect((await beto.post(`/api/admin/rifas/${R.id}/invitaciones`).set(H).send({ rol: 'editor' })).status).toBe(403);
    const inv = (await ana.post(`/api/admin/rifas/${R.id}/invitaciones`).set(H).send({ rol: 'vendedor' })).body;
    expect(inv).toMatchObject({ rol: 'vendedor', estado: 'vigente' });

    const info = await request(app).get(`/api/invitaciones/${inv.token}`);
    expect(info.body).toMatchObject({ estado: 'vigente', rol: 'vendedor', rifa: { id: R.id }, invitadoPor: 'Ana', conSesion: false });

    const nueva = request.agent(app);
    // Sin la cabecera anti-CSRF no se acepta
    expect((await nueva.post(`/api/invitaciones/${inv.token}/aceptar`).send({ nombre: 'Nora', email: 'nora@example.com', password: 'clave-de-nora-123' })).status).toBe(403);
    const short = await nueva.post(`/api/invitaciones/${inv.token}/aceptar`).set(H).send({ nombre: 'Nora', email: 'nora@example.com', password: 'corta' });
    expect(short.status).toBe(400);
    const ok = await nueva.post(`/api/invitaciones/${inv.token}/aceptar`).set(H).send({ nombre: 'Nora', email: 'Nora@Example.com', password: 'clave-de-nora-123' });
    expect(ok.status).toBe(201);
    expect(ok.body).toEqual({ raffleId: R.id, rol: 'vendedor' });
    // Queda con sesión y puede entrar a la rifa como vendedora
    const me = await nueva.get(`/api/admin/rifas/${R.id}`);
    expect(me.body.rol).toBe('vendedor');
    expect(me.body.vendedor.codigoEnlace).toBeTruthy();
    // Y puede iniciar sesión normalmente después
    expect((await request(app).post('/api/auth/login').send({ email: 'nora@example.com', password: 'clave-de-nora-123' })).status).toBe(200);

    const again = await request(app).post(`/api/invitaciones/${inv.token}/aceptar`).set(H).send({ nombre: 'Otra', email: 'otra@example.com', password: 'clave-larga-123' });
    expect(again.status).toBe(409);
  });

  it('si el correo ya tiene cuenta pide iniciar sesión; con sesión se acepta directo', async () => {
    await makeUser('Olga', 'olga@example.com');
    const inv = (await ana.post(`/api/admin/rifas/${R.id}/invitaciones`).set(H).send({ rol: 'editor' })).body;
    const exists = await request(app).post(`/api/invitaciones/${inv.token}/aceptar`).set(H).send({ nombre: 'Olga', email: 'olga@example.com', password: PASSWORD });
    expect(exists.status).toBe(409);
    expect(exists.body.error.code).toBe('account_exists');

    const olga = await login('olga@example.com');
    expect((await olga.get(`/api/invitaciones/${inv.token}`)).body.conSesion).toBe(true);
    const ok = await olga.post(`/api/invitaciones/${inv.token}/aceptar`).set(H).send({});
    expect(ok.body).toEqual({ raffleId: R.id, rol: 'editor' });
    expect((await olga.get(`/api/admin/rifas/${R.id}/ordenes`)).status).toBe(200);
  });

  it('una invitación anulada o vencida no sirve; quien ya es parte no se suma dos veces', async () => {
    const a = (await ana.post(`/api/admin/rifas/${R.id}/invitaciones`).set(H).send({ rol: 'editor' })).body;
    expect((await ana.post(`/api/admin/invitaciones/${a.id}/revocar`).set(H)).body.estado).toBe('revocada');
    expect((await beto.post(`/api/invitaciones/${a.token}/aceptar`).set(H).send({})).status).toBe(409);

    const b = (await ana.post(`/api/admin/rifas/${R.id}/invitaciones`).set(H).send({ rol: 'editor' })).body;
    const dup = await beto.post(`/api/invitaciones/${b.token}/aceptar`).set(H).send({});
    expect(dup.status).toBe(409);
    expect(dup.body.error.message).toMatch(/ya es parte/);
    expect((await ana.get(`/api/admin/rifas/${R.id}/invitaciones`)).body.find((i: any) => i.id === b.id).estado).toBe('vigente');
  });
});

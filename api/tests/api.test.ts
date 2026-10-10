import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sequelize } from '../src/db';
import { Order, Raffle } from '../src/models';
import { PNG, PASSWORD, H, activeRaffle, app, bankData, inDays, login, makeUser, raffleBody, resetDb } from './helpers';

let ana: request.Agent; // organizadora
let beto: request.Agent; // editor
let carla: request.Agent; // sin relación con la rifa
let R: { id: number; slug: string };

const grid = async (slug = R.slug) => (await request(app).get(`/api/rifas/${slug}`)).body;
const stateOf = async (n: number, slug = R.slug) => (await grid(slug)).numeros.find((x: any) => x.n === n).e;
const reserve = (numeros: number[], nombre = 'Comprador Uno', slug = R.slug) =>
  request(app).post(`/api/rifas/${slug}/ordenes`).send({ tipo: 'numeros', numeros, compradorNombre: nombre, compradorContacto: '+56911112222' });

beforeAll(async () => {
  await resetDb();
  await makeUser('Ana', 'ana@example.com');
  await makeUser('Beto', 'beto@example.com');
  await makeUser('Carla', 'carla@example.com');
  ana = await login('ana@example.com');
  beto = await login('beto@example.com');
  carla = await login('carla@example.com');
});
afterAll(() => sequelize.close());

describe('autenticación', () => {
  it('rechaza credenciales incorrectas y rutas admin sin sesión', async () => {
    const bad = await request(app).post('/api/auth/login').send({ email: 'ana@example.com', password: 'mala' });
    expect(bad.status).toBe(401);
    const noUser = await request(app).post('/api/auth/login').send({ email: 'nadie@example.com', password: PASSWORD });
    expect(noUser.status).toBe(401);
    expect((await request(app).get('/api/admin/rifas')).status).toBe(401);
  });

  it('login entrega cookie httpOnly y /me responde', async () => {
    const res = await request(app).post('/api/auth/login').send({ email: 'ana@example.com', password: PASSWORD });
    expect(res.status).toBe(200);
    expect(String(res.headers['set-cookie'])).toMatch(/HttpOnly/i);
    const me = await ana.get('/api/auth/me');
    expect(me.body.email).toBe('ana@example.com');
    expect(me.body.passwordHash).toBeUndefined();
  });

  it('exige X-Requested-With en peticiones que cambian datos', async () => {
    const res = await ana.post('/api/admin/rifas').send(raffleBody());
    expect(res.status).toBe(403);
  });

  it('el registro está deshabilitado por defecto', async () => {
    const res = await request(app).post('/api/auth/register').send({ nombre: 'X', email: 'x@example.com', password: 'una-contraseña-larga' });
    expect(res.status).toBe(403);
  });
});

describe('crear y activar una rifa', () => {
  it('valida los datos', async () => {
    const past = await ana.post('/api/admin/rifas').set(H).send(raffleBody({ fechaSorteo: inDays(-1) }));
    expect(past.status).toBe(400);
    const bad = await ana.post('/api/admin/rifas').set(H).send(raffleBody({ precioNumero: 0 }));
    expect(bad.status).toBe(400);
    const extra = await ana.post('/api/admin/rifas').set(H).send({ ...raffleBody(), campoRaro: 1 });
    expect(extra.status).toBe(400);
  });

  it('genera talonarios y números con numeración global, y queda en borrador', async () => {
    const c = await ana.post('/api/admin/rifas').set(H).send(raffleBody());
    expect(c.status).toBe(201);
    expect(c.body.estado).toBe('borrador');
    const [{ b, t, mn, mx }] = (await sequelize.query(
      `SELECT (SELECT count(*)::int FROM booklets WHERE raffle_id=${c.body.id}) b,
              count(*)::int t, min(numero)::int mn, max(numero)::int mx FROM tickets WHERE raffle_id=${c.body.id}`,
    ))[0] as any[];
    expect([b, t, mn, mx]).toEqual([3, 15, 1, 15]);
    // un borrador no es público
    expect((await request(app).get(`/api/rifas/${c.body.slug}`)).status).toBe(404);
  });

  it('no permite activar sin datos bancarios; con ellos sí', async () => {
    const c = await ana.post('/api/admin/rifas').set(H).send(raffleBody());
    const sin = await ana.patch(`/api/admin/rifas/${c.body.id}`).set(H).send({ estado: 'activa' });
    expect(sin.status).toBe(400);
    const con = await ana.patch(`/api/admin/rifas/${c.body.id}`).set(H).send({ ...bankData, estado: 'activa' });
    expect(con.status).toBe(200);
    expect(con.body.estado).toBe('activa');
  });

  it('cambia la estructura solo en borrador y regenera los números', async () => {
    const c = await ana.post('/api/admin/rifas').set(H).send(raffleBody());
    const p = await ana.patch(`/api/admin/rifas/${c.body.id}`).set(H).send({ cantidadTalonarios: 4, numerosPorTalonario: 10 });
    expect(p.status).toBe(200);
    const [{ n }] = (await sequelize.query(`SELECT count(*)::int n FROM tickets WHERE raffle_id=${c.body.id}`))[0] as any[];
    expect(n).toBe(40);
    await ana.patch(`/api/admin/rifas/${c.body.id}`).set(H).send({ ...bankData, estado: 'activa' });
    const late = await ana.patch(`/api/admin/rifas/${c.body.id}`).set(H).send({ precioNumero: 2000 });
    expect(late.status).toBe(409);
  });

  it('premios: el organizador los gestiona y el público los ve', async () => {
    R = await activeRaffle(ana);
    const p1 = await ana.post(`/api/admin/rifas/${R.id}/premios`).set(H).send({ orden: 1, nombre: 'Tablet', descripcion: '10 pulgadas' });
    expect(p1.status).toBe(201);
    const dup = await ana.post(`/api/admin/rifas/${R.id}/premios`).set(H).send({ orden: 1, nombre: 'Otro' });
    expect(dup.status).toBe(409);
    const pub = await grid();
    expect(pub.premios).toEqual([{ orden: 1, nombre: 'Tablet', descripcion: '10 pulgadas', imagenUrl: null }]);
  });
});

describe('vista pública', () => {
  it('muestra números, datos bancarios, fecha y avance, sin datos de compradores', async () => {
    const g = await grid();
    expect(g.numeros).toHaveLength(15);
    expect(g.numeros.every((x: any) => x.e === 'disponible')).toBe(true);
    expect(g.datosBancarios.numeroCuenta).toBe('12345678');
    expect(g.precioTalonario).toBe(5000);
    expect(g.fechaSorteo).toBeTruthy();
    expect(g.avance).toMatchObject({ recaudado: 0, disponibles: 15, talonariosDisponibles: 3 });
    expect(JSON.stringify(g)).not.toMatch(/comprador/i);
  });
});

describe('reservas', () => {
  it('reserva números sueltos y calcula el monto', async () => {
    const r = await reserve([1, 2, 3]);
    expect(r.status).toBe(201);
    expect(r.body.monto).toBe(3000);
    expect(r.body.token).toHaveLength(32);
    expect(await stateOf(1)).toBe('reservado');
    const venceEn = new Date(r.body.venceEn).getTime();
    expect(Math.abs(venceEn - (Date.now() + 7 * 24 * 3600 * 1000))).toBeLessThan(60_000);
  });

  it('es atómica: si un número ya no está libre no se reserva ninguno', async () => {
    const r = await reserve([3, 4], 'Comprador Dos');
    expect(r.status).toBe(409);
    expect(r.body.error.details.noDisponibles).toEqual([3]);
    expect(await stateOf(4)).toBe('disponible');
  });

  it('un talonario solo se compra completo si todos sus números están libres', async () => {
    const buy = (talonario: number) =>
      request(app).post(`/api/rifas/${R.slug}/ordenes`).send({ tipo: 'talonario', talonario, compradorNombre: 'Familia Soto', compradorContacto: 'soto@example.com' });
    expect((await buy(1)).status).toBe(409); // números 1-3 ya tomados
    const ok = await buy(2); // números 6..10
    expect(ok.status).toBe(201);
    expect(ok.body.numeros).toEqual([6, 7, 8, 9, 10]);
    expect(ok.body.monto).toBe(5000);
    expect((await grid()).avance.talonariosDisponibles).toBe(1); // solo el talonario 3 sigue completo
  });

  it('respeta el máximo de números por orden y los rangos', async () => {
    const chica = await activeRaffle(ana, { nombre: 'Rifa chica', cantidadTalonarios: 5, numerosPorTalonario: 10, maxNumerosPorOrden: 3 });
    expect((await reserve([1, 2, 3, 4], 'X Y', chica.slug)).status).toBe(400);
    expect((await reserve([999], 'X Y', chica.slug)).status).toBe(400);
    expect((await reserve([1, 2, 3], 'X Y', chica.slug)).status).toBe(201);
  });

  it('valida los datos del comprador', async () => {
    const r = await request(app).post(`/api/rifas/${R.slug}/ordenes`).send({ tipo: 'numeros', numeros: [11], compradorNombre: 'A', compradorContacto: '1' });
    expect(r.status).toBe(400);
  });

  it('con 10 reservas simultáneas del mismo número solo una gana', async () => {
    const results = await Promise.all(Array.from({ length: 10 }, (_, i) => reserve([15], `Comprador ${i + 10}`)));
    const codes = results.map((r) => r.status).sort();
    expect(codes.filter((c) => c === 201)).toHaveLength(1);
    expect(codes.filter((c) => c === 409)).toHaveLength(9);
    const [{ n }] = (await sequelize.query(`SELECT count(*)::int n FROM tickets WHERE raffle_id=${R.id} AND numero=15 AND estado='reservado'`))[0] as any[];
    expect(n).toBe(1);
  });

  it('no acepta reservas cuando la rifa está cerrada o llegó la fecha del sorteo', async () => {
    const otra = await activeRaffle(ana, { nombre: 'Rifa que cierra' });
    await ana.patch(`/api/admin/rifas/${otra.id}`).set(H).send({ estado: 'cerrada' });
    expect((await reserve([1], 'X Y', otra.slug)).status).toBe(409);
    await ana.patch(`/api/admin/rifas/${otra.id}`).set(H).send({ estado: 'activa' });
    await Raffle.update({ fechaSorteo: new Date(Date.now() - 1000) }, { where: { id: otra.id } });
    expect((await reserve([1], 'X Y', otra.slug)).status).toBe(409);
  });
});

describe('comprobante y confirmación de pago', () => {
  let token: string;
  let orderId: number;

  it('el comprador ve su orden con datos bancarios y sube un comprobante', async () => {
    const r = await reserve([11, 12], 'María López');
    token = r.body.token;
    const view = await request(app).get(`/api/ordenes/${token}`);
    expect(view.body).toMatchObject({ estado: 'pendiente', numeros: [11, 12], monto: 2000 });
    expect(view.body.datosBancarios.titular).toBe('Ana Pérez');

    const up = await request(app).post(`/api/ordenes/${token}/comprobantes`).attach('archivo', PNG, 'transferencia.png');
    expect(up.status).toBe(201);
    const after = await request(app).get(`/api/ordenes/${token}`);
    expect(after.body.comprobantes).toHaveLength(1);
  });

  it('rechaza archivos que no son imagen ni PDF, aunque tengan extensión válida', async () => {
    const fake = await request(app).post(`/api/ordenes/${token}/comprobantes`).attach('archivo', Buffer.from('<script>alert(1)</script>'), 'falso.png');
    expect(fake.status).toBe(400);
  });

  it('rechaza archivos de más de 5 MB', async () => {
    const big = Buffer.concat([PNG, Buffer.alloc(6 * 1024 * 1024)]);
    const res = await request(app).post(`/api/ordenes/${token}/comprobantes`).attach('archivo', big, 'grande.png');
    expect(res.status).toBe(413);
  });

  it('una orden con token desconocido da 404', async () => {
    expect((await request(app).get('/api/ordenes/no-existe')).status).toBe(404);
  });

  it('el equipo ve compradores, contacto, fecha y comprobantes; el token no se expone', async () => {
    const nums = (await ana.get(`/api/admin/rifas/${R.id}/numeros?estado=reservado`)).body;
    const n11 = nums.find((x: any) => x.numero === 11);
    expect(n11).toMatchObject({ compradorNombre: 'María López', compradorContacto: '+56911112222', talonario: 3 });
    expect(n11.fecha).toBeTruthy();
    const orders = (await ana.get(`/api/admin/rifas/${R.id}/ordenes?estado=pendiente`)).body;
    const o = orders.find((x: any) => x.compradorNombre === 'María López');
    orderId = o.id;
    expect(o.comprobantes).toHaveLength(1);
    expect(o.token).toBeUndefined();
    const file = await ana.get(`/api/admin/comprobantes/${o.comprobantes[0].id}`);
    expect(file.status).toBe(200);
    expect(file.headers['content-type']).toBe('image/png');
  });

  it('solo el organizador o un editor confirma; un tercero no puede ni ver el comprobante', async () => {
    expect((await carla.post(`/api/admin/ordenes/${orderId}/confirmar`).set(H)).status).toBe(403);
    expect((await request(app).post(`/api/admin/ordenes/${orderId}/confirmar`).set(H)).status).toBe(401);
    expect((await carla.get(`/api/admin/comprobantes/1`)).status).toBe(403);
  });

  it('confirmar el pago pasa la orden y sus números a pagado, y es idempotente', async () => {
    const c = await ana.post(`/api/admin/ordenes/${orderId}/confirmar`).set(H);
    expect(c.status).toBe(200);
    expect(c.body.estado).toBe('pagada');
    expect(await stateOf(11)).toBe('pagado');
    expect((await ana.post(`/api/admin/ordenes/${orderId}/confirmar`).set(H)).status).toBe(200);
    const g = await grid();
    expect(g.avance.recaudado).toBe(2000);
    const late = await request(app).post(`/api/ordenes/${token}/comprobantes`).attach('archivo', PNG, 'otra.png');
    expect(late.status).toBe(409);
  });

  it('cancelar una orden libera sus números', async () => {
    const c = await ana.post(`/api/admin/ordenes/${orderId}/cancelar`).set(H);
    expect(c.body.estado).toBe('cancelada');
    expect(await stateOf(11)).toBe('disponible');
    expect((await ana.post(`/api/admin/ordenes/${orderId}/confirmar`).set(H)).status).toBe(409);
  });

  it('la auditoría registra confirmaciones y cancelaciones', async () => {
    const rows = (await sequelize.query(`SELECT accion FROM audit_log WHERE entidad='orden' AND raffle_id=${R.id} ORDER BY id`))[0] as any[];
    expect(rows.map((r) => r.accion)).toEqual(['confirmar_pago', 'cancelar']);
  });
});

describe('vencimiento de reservas', () => {
  it('las reservas vencidas se liberan solas y pueden reactivarse si los números siguen libres', async () => {
    const V = await activeRaffle(ana, { nombre: 'Rifa vencimientos' });
    const r = await reserve([1, 2], 'Pedro Pablo', V.slug);
    await Order.update({ venceEn: new Date(Date.now() - 60_000) }, { where: { token: r.body.token } });

    expect(await stateOf(1, V.slug)).toBe('disponible'); // la consulta pública dispara el vencimiento
    const view = await request(app).get(`/api/ordenes/${r.body.token}`);
    expect(view.body.estado).toBe('vencida');
    expect(view.body.datosBancarios).toBeNull();

    const orderId = (await Order.findOne({ where: { token: r.body.token } }) as any).id;
    const ext = await ana.post(`/api/admin/ordenes/${orderId}/extender`).set(H).send({ dias: 3 });
    expect(ext.body.estado).toBe('pendiente');
    expect(await stateOf(1, V.slug)).toBe('reservado');
  });

  it('confirmar una orden vencida retoma los números; si alguien los tomó, da conflicto', async () => {
    const V = await activeRaffle(ana, { nombre: 'Rifa pago tardío' });
    const a = await reserve([5], 'Ana Tardía', V.slug);
    const b = await reserve([6], 'Beto Tardío', V.slug);
    await Order.update({ venceEn: new Date(Date.now() - 60_000) }, { where: { token: [a.body.token, b.body.token] } });
    await grid(V.slug); // vence ambas
    const ordA = (await Order.findOne({ where: { token: a.body.token } }) as any).id;
    const ordB = (await Order.findOne({ where: { token: b.body.token } }) as any).id;

    expect((await ana.post(`/api/admin/ordenes/${ordA}/confirmar`).set(H)).status).toBe(200);
    expect(await stateOf(5, V.slug)).toBe('pagado');

    expect((await reserve([6], 'Otra Persona', V.slug)).status).toBe(201); // alguien toma el 6
    const late = await ana.post(`/api/admin/ordenes/${ordB}/confirmar`).set(H);
    expect(late.status).toBe(409);
    expect(late.body.error.details.noDisponibles).toEqual([6]);
  });
});

describe('roles', () => {
  it('el organizador agrega un editor; el editor opera pero no administra', async () => {
    expect((await beto.get(`/api/admin/rifas/${R.id}`)).status).toBe(403);
    const add = await ana.post(`/api/admin/rifas/${R.id}/miembros`).set(H).send({ email: 'beto@example.com' });
    expect(add.status).toBe(201);
    expect(add.body.rol).toBe('editor');

    expect((await beto.get(`/api/admin/rifas/${R.id}`)).status).toBe(200);
    expect((await beto.get(`/api/admin/rifas/${R.id}/ordenes`)).status).toBe(200);
    expect((await beto.patch(`/api/admin/rifas/${R.id}`).set(H).send({ nombre: 'Hackeada' })).status).toBe(403);
    expect((await beto.post(`/api/admin/rifas/${R.id}/premios`).set(H).send({ orden: 2, nombre: 'X' })).status).toBe(403);
    expect((await beto.post(`/api/admin/rifas/${R.id}/miembros`).set(H).send({ email: 'carla@example.com' })).status).toBe(403);
    expect((await carla.get(`/api/admin/rifas/${R.id}/ordenes`)).status).toBe(403);
  });

  it('cada persona solo ve sus propias rifas', async () => {
    const mine = (await carla.get('/api/admin/rifas')).body;
    expect(mine).toEqual([]);
    const anas = (await ana.get('/api/admin/rifas')).body;
    expect(anas.length).toBeGreaterThan(3);
    expect(anas[0].rol).toBe('organizador');
  });

  it('un editor puede confirmar pagos pero no quitar al organizador', async () => {
    const r = await reserve([13], 'Cliente Editor');
    const orderId = (await Order.findOne({ where: { token: r.body.token } }) as any).id;
    expect((await beto.post(`/api/admin/ordenes/${orderId}/confirmar`).set(H)).status).toBe(200);
    const users = (await ana.get(`/api/admin/rifas/${R.id}/miembros`)).body;
    const anaId = users.find((u: any) => u.email === 'ana@example.com').userId;
    expect((await ana.delete(`/api/admin/rifas/${R.id}/miembros/${anaId}`).set(H)).status).toBe(409);
  });
});

describe('ventas registradas por el equipo', () => {
  it('una venta física nace pagada y queda registrada en la grilla', async () => {
    const F = await activeRaffle(ana, { nombre: 'Rifa física' });
    const res = await ana
      .post(`/api/admin/rifas/${F.id}/ordenes-manuales`)
      .set(H)
      .send({ tipo: 'talonario', talonario: 2, compradorNombre: 'Vecina Rosa', compradorContacto: '+56922223333', canal: 'fisica', pagada: true });
    expect(res.status).toBe(201);
    expect(res.body.estado).toBe('pagada');
    expect(res.body.numeros).toEqual([6, 7, 8, 9, 10]);
    expect(await stateOf(7, F.slug)).toBe('pagado');
    const nums = (await ana.get(`/api/admin/rifas/${F.id}/numeros?estado=pagado`)).body;
    expect(nums).toHaveLength(5);
    expect(nums[0]).toMatchObject({ compradorNombre: 'Vecina Rosa', canal: 'fisica' });
  });
});

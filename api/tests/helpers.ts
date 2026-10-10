import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import bcrypt from 'bcryptjs';
import request from 'supertest';
import { createApp } from '../src/app';
import { sequelize } from '../src/db';
import { User } from '../src/models';

export const app = createApp();
export const H = { 'X-Requested-With': 'mis-rifas' };
export const PASSWORD = 'contraseña-de-prueba-123';

export async function resetDb() {
  await sequelize.query(readFileSync(join(__dirname, '../db/schema.sql'), 'utf8'));
  await sequelize.query(
    `TRUNCATE users, raffles, raffle_members, booklets, tickets, sellers, orders, payment_proofs, prizes, draws, share_links, invitations, contacts, audit_log RESTART IDENTITY CASCADE`,
  );
}

export async function makeUser(nombre: string, email: string) {
  return (await User.create({ nombre, email, passwordHash: await bcrypt.hash(PASSWORD, 4) })) as any;
}

export async function login(email: string) {
  const agent = request.agent(app);
  const res = await agent.post('/api/auth/login').send({ email, password: PASSWORD });
  if (res.status !== 200) throw new Error(`login falló: ${res.status}`);
  return agent;
}

export const inDays = (d: number) => new Date(Date.now() + d * 24 * 3600 * 1000).toISOString();

export const raffleBody = (over: Record<string, unknown> = {}) => ({
  nombre: 'Rifa Viaje de Estudio',
  proposito: 'viaje',
  objetivo: 'Financiar el viaje de estudio de 4° medio',
  metaMonto: 500000,
  precioNumero: 1000,
  cantidadTalonarios: 3,
  numerosPorTalonario: 5,
  fechaSorteo: inDays(30),
  ...over,
});

export const bankData = {
  bancoNombre: 'Banco Estado',
  bancoTipoCuenta: 'Cuenta RUT',
  bancoNumeroCuenta: '12345678',
  bancoTitular: 'Ana Pérez',
  bancoRut: '12.345.678-9',
  bancoEmailAviso: 'ana@example.com',
};

// PNG mínimo válido (firma correcta)
export const PNG = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.alloc(64, 1),
]);

/** Crea una rifa activa con datos bancarios y devuelve { id, slug } */
export async function activeRaffle(agent: request.Agent, over: Record<string, unknown> = {}) {
  const c = await agent.post('/api/admin/rifas').set(H).send(raffleBody(over));
  if (c.status !== 201) throw new Error(`crear rifa: ${c.status} ${JSON.stringify(c.body)}`);
  const p = await agent.patch(`/api/admin/rifas/${c.body.id}`).set(H).send({ ...bankData, estado: 'activa' });
  if (p.status !== 200) throw new Error(`activar rifa: ${p.status} ${JSON.stringify(p.body)}`);
  return { id: c.body.id as number, slug: c.body.slug as string };
}

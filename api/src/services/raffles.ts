import crypto from 'node:crypto';
import { QueryTypes, Transaction } from 'sequelize';
import { sequelize } from '../db';
import { conflict } from '../errors';
import { AuditLog, Raffle, RaffleMember } from '../models';

export const slugify = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40) || 'rifa';

export async function audit(
  userId: number | null,
  raffleId: number | null,
  accion: string,
  entidad: string,
  entidadId: number | null,
  detalle: object = {},
  t?: Transaction,
) {
  await AuditLog.create({ userId, raffleId, accion, entidad, entidadId, detalle }, { transaction: t });
}

/** Genera talonarios y números (todos 'disponible'). Numeración global: talonario k → (k-1)*M+1 … k*M */
export async function generateTickets(raffleId: number, talonarios: number, porTalonario: number, t: Transaction) {
  await sequelize.query(
    `INSERT INTO booklets (raffle_id, numero) SELECT :raffleId, g FROM generate_series(1, :talonarios::int) g`,
    { replacements: { raffleId, talonarios }, transaction: t },
  );
  await sequelize.query(
    `INSERT INTO tickets (raffle_id, booklet_id, numero, estado)
     SELECT :raffleId, b.id, (b.numero - 1) * :porTalonario::int + s, 'disponible'
     FROM booklets b CROSS JOIN generate_series(1, :porTalonario::int) s
     WHERE b.raffle_id = :raffleId`,
    { replacements: { raffleId, porTalonario }, transaction: t },
  );
}

export async function createRaffle(userId: number, input: Record<string, any>) {
  return sequelize.transaction(async (t) => {
    const slug = `${slugify(input.nombre)}-${crypto.randomBytes(2).toString('hex')}`;
    const raffle: any = await Raffle.create(
      { ...input, slug, estado: 'borrador', creadoEn: new Date(), actualizadoEn: new Date() },
      { transaction: t },
    );
    await RaffleMember.create({ raffleId: raffle.id, userId, rol: 'organizador' }, { transaction: t });
    await generateTickets(raffle.id, raffle.cantidadTalonarios, raffle.numerosPorTalonario, t);
    await audit(userId, raffle.id, 'crear', 'rifa', raffle.id, {}, t);
    return raffle;
  });
}

/** Cambiar la estructura solo es posible en borrador y sin números ocupados. */
export async function regenerateStructure(raffle: any, talonarios: number, porTalonario: number, t: Transaction) {
  const [{ ocupados }] = (await sequelize.query(
    `SELECT count(*)::int AS ocupados FROM tickets WHERE raffle_id = :id AND estado <> 'disponible'`,
    { replacements: { id: raffle.id }, type: QueryTypes.SELECT, transaction: t },
  )) as any[];
  if (ocupados > 0) throw conflict('No se puede cambiar la estructura: ya hay números reservados o pagados');
  await sequelize.query(`DELETE FROM tickets WHERE raffle_id = :id`, { replacements: { id: raffle.id }, transaction: t });
  await sequelize.query(`DELETE FROM booklets WHERE raffle_id = :id`, { replacements: { id: raffle.id }, transaction: t });
  await generateTickets(raffle.id, talonarios, porTalonario, t);
}

export async function raffleSummary(raffleId: number) {
  const [row] = (await sequelize.query(
    `SELECT
       count(*) FILTER (WHERE estado = 'disponible')::int AS disponibles,
       count(*) FILTER (WHERE estado = 'reservado')::int  AS reservados,
       count(*) FILTER (WHERE estado = 'pagado')::int     AS pagados,
       count(*)::int                                      AS total
     FROM tickets WHERE raffle_id = :raffleId`,
    { replacements: { raffleId }, type: QueryTypes.SELECT },
  )) as any[];
  const raffle: any = await Raffle.findByPk(raffleId);
  const talonariosDisponibles = (
    (await sequelize.query(
      `SELECT count(*)::int AS n FROM (
         SELECT booklet_id FROM tickets WHERE raffle_id = :raffleId
         GROUP BY booklet_id HAVING bool_and(estado = 'disponible')
       ) x`,
      { replacements: { raffleId }, type: QueryTypes.SELECT },
    )) as any[]
  )[0].n;
  return {
    ...row,
    talonariosDisponibles,
    recaudado: row.pagados * raffle.precioNumero,
    porCobrar: row.reservados * raffle.precioNumero,
    metaMonto: raffle.metaMonto,
  };
}

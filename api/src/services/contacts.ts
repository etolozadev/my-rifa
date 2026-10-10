import { QueryTypes, UniqueConstraintError } from 'sequelize';
import { sequelize } from '../db';
import { badRequest, conflict, notFound } from '../errors';
import { Contact, Order } from '../models';
import { audit } from './raffles';

export interface ContactInput {
  nombre: string;
  telefono: string;
  nota?: string;
}

export interface ContactView {
  id: number;
  nombre: string;
  telefono: string;
  nota: string;
  /** Órdenes a cargo de este contacto (cualquier estado salvo canceladas) */
  ordenes: number;
  /** Rendición de lo que vendió (órdenes con contacto_vendio) */
  vendidos: number;
  reservados: number;
  recaudado: number;
  porCobrar: number;
}

/** Contactos de la rifa con su rendición, ordenados por nombre */
export async function listContacts(raffle: any): Promise<ContactView[]> {
  const rows = (await sequelize.query(
    `SELECT c.id, c.nombre, c.telefono, c.nota,
       (SELECT count(*)::int FROM orders o WHERE o.contact_id = c.id AND o.estado <> 'cancelada') AS ordenes,
       (SELECT count(*)::int FROM tickets t JOIN orders o ON o.id = t.order_id
         WHERE o.contact_id = c.id AND o.contacto_vendio AND t.estado = 'pagado') AS vendidos,
       (SELECT count(*)::int FROM tickets t JOIN orders o ON o.id = t.order_id
         WHERE o.contact_id = c.id AND o.contacto_vendio AND t.estado = 'reservado') AS reservados
     FROM contacts c WHERE c.raffle_id = :raffleId ORDER BY lower(c.nombre), c.id`,
    { replacements: { raffleId: raffle.id }, type: QueryTypes.SELECT },
  )) as any[];
  return rows.map((r) => ({ ...r, recaudado: r.vendidos * raffle.precioNumero, porCobrar: r.reservados * raffle.precioNumero }));
}

const duplicate = () => conflict('Ya hay un contacto con ese teléfono en esta rifa');

export async function createContact(raffleId: number, data: ContactInput, actorId: number) {
  try {
    const c: any = await Contact.create({ raffleId, nombre: data.nombre, telefono: data.telefono, nota: data.nota ?? '', creadoPor: actorId, creadoEn: new Date() });
    await audit(actorId, raffleId, 'crear_contacto', 'contacto', c.id, { nombre: data.nombre });
    return c;
  } catch (e) {
    if (e instanceof UniqueConstraintError) throw duplicate();
    throw e;
  }
}

export async function findContact(raffleId: number, contactId: number): Promise<any> {
  const c: any = await Contact.findOne({ where: { id: contactId, raffleId } });
  if (!c) throw notFound('Contacto no encontrado');
  return c;
}

export async function updateContact(raffleId: number, contactId: number, data: Partial<ContactInput>, actorId: number) {
  const c = await findContact(raffleId, contactId);
  try {
    await c.update(data);
  } catch (e) {
    if (e instanceof UniqueConstraintError) throw duplicate();
    throw e;
  }
  await audit(actorId, raffleId, 'editar_contacto', 'contacto', c.id, { campos: Object.keys(data) });
  return c;
}

/** Solo se elimina un contacto que no está asociado a ninguna orden (las órdenes dependen de él para ubicar al comprador). */
export async function deleteContact(raffleId: number, contactId: number, actorId: number) {
  const c = await findContact(raffleId, contactId);
  const used = await Order.count({ where: { contactId: c.id } });
  if (used) throw conflict(`No se puede eliminar: tiene ${used} ${used === 1 ? 'orden asociada' : 'órdenes asociadas'}`);
  await c.destroy();
  await audit(actorId, raffleId, 'eliminar_contacto', 'contacto', c.id, { nombre: c.nombre });
}

/**
 * Valida la forma de ubicar al comprador en una venta registrada por el equipo: teléfono propio
 * y/o persona de contacto de la misma rifa (al menos uno). Devuelve los campos para la orden.
 */
export async function contactFields(
  raffleId: number,
  input: { compradorContacto?: string | null; contactoId?: number | null; contactoVendio?: boolean },
) {
  const phone = input.compradorContacto?.trim() || null;
  if (phone && phone.length < 6) throw badRequest('El teléfono del comprador debe tener al menos 6 caracteres');
  let contactId: number | null = null;
  if (input.contactoId) contactId = (await findContact(raffleId, input.contactoId)).id;
  if (!phone && !contactId) throw badRequest('Indica el teléfono del comprador o una persona de contacto');
  if (input.contactoVendio && !contactId) throw badRequest('Para marcar quién vendió, elige la persona de contacto');
  return { compradorContacto: phone, contactId, contactoVendio: Boolean(contactId && input.contactoVendio) };
}

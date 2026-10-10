import { Router } from 'express';
import { z } from 'zod';
import { notFound, wrap } from '../errors';
import { AuthedRequest, raffleRole } from '../middleware/auth';
import { Raffle } from '../models';
import { createContact, deleteContact, listContacts, updateContact } from '../services/contacts';

/** Personas de contacto de una rifa. Se monta dentro de adminRouter (exige sesión y X-Requested-With). */
export const contactsRouter = Router();

const uid = (req: any) => (req as AuthedRequest).userId;
// Las gestionan el organizador y los editores (los vendedores registran el teléfono del comprador)
const team = raffleRole('organizador', 'editor');

const body = z
  .object({
    nombre: z.string().trim().min(2, 'Escribe el nombre').max(120),
    telefono: z.string().trim().min(6, 'El teléfono debe tener al menos 6 caracteres').max(40),
    nota: z.string().trim().max(200).default(''),
  })
  .strict();

async function raffleOr404(id: string): Promise<any> {
  const raffle = await Raffle.findByPk(id);
  if (!raffle) throw notFound();
  return raffle;
}

contactsRouter.get(
  '/rifas/:id/contactos',
  team,
  wrap(async (req, res) => {
    res.json(await listContacts(await raffleOr404(req.params.id)));
  }),
);

contactsRouter.post(
  '/rifas/:id/contactos',
  team,
  wrap(async (req, res) => {
    const raffle = await raffleOr404(req.params.id);
    const c = await createContact(raffle.id, body.parse(req.body), uid(req));
    res.status(201).json((await listContacts(raffle)).find((x) => x.id === c.id));
  }),
);

contactsRouter.patch(
  '/rifas/:id/contactos/:contactId',
  team,
  wrap(async (req, res) => {
    const raffle = await raffleOr404(req.params.id);
    const c = await updateContact(raffle.id, Number(req.params.contactId), body.partial().parse(req.body), uid(req));
    res.json((await listContacts(raffle)).find((x) => x.id === c.id));
  }),
);

contactsRouter.delete(
  '/rifas/:id/contactos/:contactId',
  team,
  wrap(async (req, res) => {
    await deleteContact(Number(req.params.id), Number(req.params.contactId), uid(req));
    res.status(204).end();
  }),
);

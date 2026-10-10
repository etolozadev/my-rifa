import type { AdminDraw, AdminOrder, AdminRaffle } from './admin';
import { longDate, money, shortDate } from './format';

/**
 * Avisos a compradores: mensajes ya redactados para enviar por WhatsApp con un clic (wa.me),
 * sin servicios de pago ni números de empresa. Si el contacto no es un teléfono, se copian.
 */

/** Enlace de WhatsApp si el contacto parece un celular chileno (9 dígitos) o un número internacional */
export function whatsappLink(contact: string): string | null {
  const digits = contact.replace(/\D/g, '');
  if (digits.length === 9 && digits.startsWith('9')) return `https://wa.me/56${digits}`;
  if (digits.length >= 10 && digits.length <= 15) return `https://wa.me/${digits}`;
  return null;
}

export function whatsappUrl(contact: string, text: string): string | null {
  const base = whatsappLink(contact);
  return base ? `${base}?text=${encodeURIComponent(text)}` : null;
}

const firstName = (name: string) => name.trim().split(/\s+/)[0];

function bankLines(r: AdminRaffle): string {
  return [
    r.bancoTitular && `Titular: ${r.bancoTitular}`,
    r.bancoRut && `RUT: ${r.bancoRut}`,
    r.bancoNombre && `Banco: ${r.bancoNombre}`,
    r.bancoTipoCuenta && `Tipo de cuenta: ${r.bancoTipoCuenta}`,
    r.bancoNumeroCuenta && `N° de cuenta: ${r.bancoNumeroCuenta}`,
    r.bancoEmailAviso && `Correo: ${r.bancoEmailAviso}`,
  ]
    .filter(Boolean)
    .join('\n');
}

/** A quién avisar: el comprador si dejó teléfono; si no, su persona de contacto */
export interface Recipient {
  nombre: string;
  telefono: string;
  /** Es la persona de contacto, no el comprador: el mensaje habla del comprador en tercera persona */
  esContacto: boolean;
}

export function orderRecipient(o: Pick<AdminOrder, 'compradorNombre' | 'compradorContacto' | 'contacto'>): Recipient | null {
  if (o.compradorContacto) return { nombre: o.compradorNombre, telefono: o.compradorContacto, esContacto: false };
  if (o.contacto) return { nombre: o.contacto.nombre, telefono: o.contacto.telefono, esContacto: true };
  return null;
}

export function drawRecipient(d: AdminDraw): Recipient | null {
  if (d.compradorContacto) return { nombre: d.compradorNombre ?? '', telefono: d.compradorContacto, esContacto: false };
  if (d.contactoTelefono) return { nombre: d.contactoNombre ?? '', telefono: d.contactoTelefono, esContacto: true };
  return null;
}

/** Mensaje según el estado de la orden; null si no corresponde avisar (cancelada) o no hay a quién */
export function orderMessage(o: AdminOrder, r: AdminRaffle): string | null {
  const to = orderRecipient(o);
  if (!to) return null;
  const name = firstName(to.nombre);
  const buyer = o.compradorNombre;
  const nums = o.numeros.join(', ');
  const numsLabel = `${o.numeros.length === 1 ? 'número' : 'números'} ${nums}`;
  switch (o.estado) {
    case 'pendiente':
      return (
        (to.esContacto
          ? `Hola ${name}, te escribo por la reserva de ${buyer} en la rifa "${r.nombre}": ${numsLabel} por ${money(o.monto)}. `
          : `Hola ${name}, te escribo por tu reserva en la rifa "${r.nombre}": ${numsLabel} por ${money(o.monto)}. `) +
        `La reserva vence el ${shortDate(o.venceEn)}.\n\nDatos para transferir:\n${bankLines(r)}\n\n` +
        `Cuando transfieras, sube el comprobante en el enlace que recibiste al reservar o envíamelo por aquí. ¡Gracias!`
      );
    case 'pagada':
      return to.esContacto
        ? `Hola ${name}, confirmamos el pago de ${buyer} (${money(o.monto)}) en la rifa "${r.nombre}". ` +
            `Sus números ${nums} participan en el sorteo del ${longDate(r.fechaSorteo)} ¡Mucha suerte!`
        : `Hola ${name}, confirmamos tu pago de ${money(o.monto)} en la rifa "${r.nombre}". ` +
            `Tus números ${nums} participan en el sorteo del ${longDate(r.fechaSorteo)} ¡Mucha suerte!`;
    case 'vencida':
      return to.esContacto
        ? `Hola ${name}, la reserva de ${buyer} (${numsLabel}) en la rifa "${r.nombre}" venció y los números quedaron libres. ` +
            `Si ya transfirió, avísame y la reactivo.`
        : `Hola ${name}, tu reserva de los números ${nums} en la rifa "${r.nombre}" venció y los números quedaron libres. ` +
            `Si ya transferiste, avísame y la reactivo.`;
    default:
      return null;
  }
}

export function winnerMessage(d: AdminDraw, r: AdminRaffle): string {
  const to = drawRecipient(d);
  if (to?.esContacto) {
    return (
      `¡Hola ${firstName(to.nombre)}! El número ${d.numero} de ${d.compradorNombre ?? 'tu referido'} ganó el ${d.premio.orden}° premio de la rifa ` +
      `"${r.nombre}": ${d.premio.nombre}. Escríbeme para coordinar la entrega. ¡Felicitaciones!`
    );
  }
  return (
    `¡Hola ${firstName(d.compradorNombre ?? '')}! Tu número ${d.numero} ganó el ${d.premio.orden}° premio de la rifa ` +
    `"${r.nombre}": ${d.premio.nombre}. Escríbeme para coordinar la entrega. ¡Felicitaciones!`
  );
}

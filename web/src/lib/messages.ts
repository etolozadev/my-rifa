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

/** Mensaje según el estado de la orden; null si no corresponde avisar (cancelada) */
export function orderMessage(o: AdminOrder, r: AdminRaffle): string | null {
  const name = firstName(o.compradorNombre);
  const nums = o.numeros.join(', ');
  switch (o.estado) {
    case 'pendiente':
      return (
        `Hola ${name}, te escribo por tu reserva en la rifa "${r.nombre}": ${o.numeros.length === 1 ? 'número' : 'números'} ${nums} ` +
        `por ${money(o.monto)}. La reserva vence el ${shortDate(o.venceEn)}.\n\nDatos para transferir:\n${bankLines(r)}\n\n` +
        `Cuando transfieras, sube el comprobante en el enlace que recibiste al reservar o envíamelo por aquí. ¡Gracias!`
      );
    case 'pagada':
      return (
        `Hola ${name}, confirmamos tu pago de ${money(o.monto)} en la rifa "${r.nombre}". ` +
        `Tus números ${nums} participan en el sorteo del ${longDate(r.fechaSorteo)} ¡Mucha suerte!`
      );
    case 'vencida':
      return (
        `Hola ${name}, tu reserva de los números ${nums} en la rifa "${r.nombre}" venció y los números quedaron libres. ` +
        `Si ya transferiste, avísame y la reactivo.`
      );
    default:
      return null;
  }
}

export function winnerMessage(d: AdminDraw, r: AdminRaffle): string {
  return (
    `¡Hola ${firstName(d.compradorNombre ?? '')}! Tu número ${d.numero} ganó el ${d.premio.orden}° premio de la rifa ` +
    `"${r.nombre}": ${d.premio.nombre}. Escríbeme para coordinar la entrega. ¡Felicitaciones!`
  );
}

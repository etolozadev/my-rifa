import { whatsappLink } from '../lib/messages';

/** Teléfono como enlace a WhatsApp cuando parece un celular; si no, texto plano */
export function Phone({ value }: { value: string }) {
  const wa = whatsappLink(value);
  return wa ? (
    <a href={wa} target="_blank" rel="noreferrer">
      {value}
    </a>
  ) : (
    <>{value}</>
  );
}

/** "Contacto: Rosa Pérez · +56 9…" con la marca de si vendió el número */
export function ContactLine({ nombre, telefono, vendio }: { nombre: string; telefono: string; vendio?: boolean }) {
  return (
    <span className="contact-line">
      Contacto: <b>{nombre}</b> · <Phone value={telefono} />
      {vendio && <span className="chip neutral">vendió</span>}
    </span>
  );
}

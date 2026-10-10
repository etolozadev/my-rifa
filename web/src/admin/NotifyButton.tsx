import { useState } from 'react';
import { CopyIcon, WhatsappLogoIcon } from '../components/icons';
import { whatsappUrl } from '../lib/messages';

/** Abre WhatsApp con el mensaje escrito; si el contacto no es un teléfono, copia el mensaje. */
export function NotifyButton({ contact, text, label = 'Avisar por WhatsApp' }: { contact: string; text: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  const url = whatsappUrl(contact, text);
  if (url) {
    return (
      <a className="btn small" href={url} target="_blank" rel="noreferrer">
        <WhatsappLogoIcon size={18} aria-hidden="true" />
        {label}
      </a>
    );
  }
  return (
    <button
      type="button"
      className="btn small"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setCopied(true);
          setTimeout(() => setCopied(false), 2000);
        } catch {
          /* sin portapapeles */
        }
      }}
    >
      <CopyIcon size={16} aria-hidden="true" />
      {copied ? 'Mensaje copiado' : 'Copiar mensaje'}
    </button>
  );
}

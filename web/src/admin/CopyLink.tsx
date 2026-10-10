import { useState } from 'react';

/** Enlace visible con botones para copiarlo y abrirlo (el texto queda a la vista por si no hay portapapeles). */
export function CopyLink({ url, label = 'Copiar enlace', disabled = false }: { url: string; label?: string; disabled?: boolean }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* sin portapapeles: el enlace queda visible para copiarlo a mano */
    }
  }

  return (
    <div className="stack">
      <code className="url">{url}</code>
      <div className="row">
        <button type="button" className="btn small" onClick={copy}>{copied ? 'Enlace copiado' : label}</button>
        {!disabled && <a className="btn small" href={url} target="_blank" rel="noreferrer">Abrir</a>}
      </div>
    </div>
  );
}

import { useState } from 'react';
import type { BankData } from '../lib/api';
import { CheckIcon, CopyIcon } from './icons';

function CopyButton({ text, label }: { text: string; label: string }) {
  const [done, setDone] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const el = document.createElement('textarea');
      el.value = text;
      document.body.appendChild(el);
      el.select();
      document.execCommand('copy');
      el.remove();
    }
    setDone(true);
    setTimeout(() => setDone(false), 2000);
  };
  return (
    <button type="button" className="btn small" onClick={copy} aria-label={`Copiar ${label}`}>
      {done ? <CheckIcon size={16} weight="bold" aria-hidden="true" /> : <CopyIcon size={16} aria-hidden="true" />}
      {done ? 'Copiado' : 'Copiar'}
    </button>
  );
}

export function BankCard({ bank, title = 'Datos para transferir', note }: { bank: BankData; title?: string; note?: string }) {
  const rows: { k: string; v: string | null; copy?: boolean }[] = [
    { k: 'Titular', v: bank.titular },
    { k: 'RUT', v: bank.rut, copy: true },
    { k: 'Banco', v: bank.banco },
    { k: 'Tipo de cuenta', v: bank.tipoCuenta },
    { k: 'N° de cuenta', v: bank.numeroCuenta, copy: true },
    { k: 'Correo', v: bank.emailAviso, copy: true },
  ];
  return (
    <section className="card" aria-labelledby="bank-title">
      <h2 id="bank-title">{title}</h2>
      <ul className="bank">
        {rows
          .filter((r) => r.v)
          .map((r) => (
            <li key={r.k}>
              <div>
                <span className="label">{r.k}</span>
                <b>{r.v}</b>
              </div>
              {r.copy ? <CopyButton text={r.v!} label={r.k} /> : null}
            </li>
          ))}
      </ul>
      {note && <p className="muted small">{note}</p>}
    </section>
  );
}

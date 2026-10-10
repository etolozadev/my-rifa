import { FormEvent, useEffect, useRef, useState } from 'react';
import { ApiError, api, type PublicRaffle } from '../lib/api';
import { money, plural } from '../lib/format';
import { exactBooklet } from '../lib/selection';

interface Props {
  raffle: PublicRaffle;
  numbers: number[];
  onClose: () => void;
  onDone: (r: { token: string; numeros: number[]; monto: number }) => void;
  /** Algunos números se ocuparon mientras el comprador elegía */
  onConflict: (noDisponibles: number[]) => void;
  /** Código del vendedor cuyo enlace se está usando */
  sellerCode?: string | null;
}

export function ReserveSheet({ raffle, numbers, onClose, onDone, onConflict, sellerCode }: Props) {
  const [nombre, setNombre] = useState('');
  const [contacto, setContacto] = useState('');
  const [touched, setTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const first = useRef<HTMLInputElement>(null);

  useEffect(() => {
    first.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && !busy && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [busy, onClose]);

  const nameErr = nombre.trim().length < 2 ? 'Escribe tu nombre' : null;
  const contactErr = contacto.trim().length < 6 ? 'Escribe un teléfono o WhatsApp con al menos 6 dígitos' : null;
  const total = numbers.length * raffle.precioNumero;

  async function submit(e: FormEvent) {
    e.preventDefault();
    setTouched(true);
    if (nameErr || contactErr) return;
    setBusy(true);
    setError(null);
    const booklet = exactBooklet(numbers, raffle.numerosPorTalonario, raffle.cantidadTalonarios);
    try {
      const res = await api.reserve(raffle.slug, {
        ...(booklet ? { tipo: 'talonario' as const, talonario: booklet } : { tipo: 'numeros' as const, numeros: numbers }),
        compradorNombre: nombre.trim(),
        compradorContacto: contacto.trim(),
        ...(sellerCode ? { vendedor: sellerCode } : {}),
      });
      onDone(res);
    } catch (err) {
      if (err instanceof ApiError && err.status === 409 && err.details?.noDisponibles) {
        onConflict(err.details.noDisponibles as number[]);
        return;
      }
      setError(err instanceof ApiError ? err.message : 'No se pudo reservar. Inténtalo de nuevo.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && !busy && onClose()}>
      <form className="sheet" role="dialog" aria-modal="true" aria-labelledby="reserve-title" onSubmit={submit} noValidate>
        <div className="stack">
          <h2 id="reserve-title">Reservar {plural(numbers.length, 'número', 'números')}</h2>
          <div className="chips" aria-label="Números elegidos">
            {numbers.map((n) => (
              <span key={n} className="chip">{n}</span>
            ))}
          </div>
          <p className="muted small">
            Tu reserva dura {plural(raffle.ttlReservaDias, 'día', 'días')}. Transfiere dentro de ese plazo y sube el comprobante:
            si no, los números se liberan.
          </p>
        </div>

        <div className="field">
          <label htmlFor="nombre">Tu nombre</label>
          <input ref={first} id="nombre" autoComplete="name" value={nombre} onChange={(e) => setNombre(e.target.value)} aria-invalid={touched && !!nameErr} aria-describedby={touched && nameErr ? 'nombre-err' : undefined} />
          {touched && nameErr && <span id="nombre-err" className="err">{nameErr}</span>}
        </div>
        <div className="field">
          <label htmlFor="contacto">Teléfono o WhatsApp</label>
          <input id="contacto" type="tel" inputMode="tel" autoComplete="tel" placeholder="+56 9 1234 5678" value={contacto} onChange={(e) => setContacto(e.target.value)} aria-invalid={touched && !!contactErr} aria-describedby="contacto-hint" />
          <span id="contacto-hint" className="hint">Solo lo usa el organizador para avisarte. No se muestra públicamente.</span>
          {touched && contactErr && <span className="err">{contactErr}</span>}
        </div>

        {error && <div className="banner error" role="alert">{error}</div>}

        <div className="row between">
          <span className="muted">Total a transferir</span>
          <b style={{ fontSize: '1.3rem' }}>{money(total)}</b>
        </div>
        <div className="row" style={{ justifyContent: 'flex-end' }}>
          <button type="button" className="btn" onClick={onClose} disabled={busy}>Cancelar</button>
          <button type="submit" className="btn cta" disabled={busy}>{busy ? 'Reservando…' : 'Reservar'}</button>
        </div>
      </form>
    </div>
  );
}

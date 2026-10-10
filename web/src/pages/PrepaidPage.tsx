import { FormEvent, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { NumberGrid } from '../components/NumberGrid';
import { ApiError, api } from '../lib/api';
import { longDate, plural } from '../lib/format';
import { saveOrder } from '../lib/myOrders';
import { bookletNumbers, pruneSelection, toggleNumber } from '../lib/selection';
import { useLoad } from '../lib/useLoad';
import { NotFoundPage } from './NotFoundPage';

/** Enlace para quien ya pagó: elige exactamente sus N números y la orden queda pagada. */
export function PrepaidPage() {
  const { token = '' } = useParams();
  const navigate = useNavigate();
  const { data: link, error, loading, reload } = useLoad(() => api.getLink(token));
  const [selection, setSelection] = useState<Set<number>>(new Set());
  const [notice, setNotice] = useState<string | null>(null);
  const [nombre, setNombre] = useState<string | null>(null);
  const [contacto, setContacto] = useState('');
  const [touched, setTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  // Si alguien toma un número elegido mientras tanto, se quita de la selección
  useEffect(() => {
    if (!link) return;
    setSelection((sel) => {
      const next = pruneSelection(sel, link.rifa);
      if (next.size !== sel.size) setNotice('Algunos números que elegiste ya fueron tomados por otra persona.');
      return next.size === sel.size ? sel : next;
    });
  }, [link]);

  const sorted = useMemo(() => [...selection].sort((a, b) => a - b), [selection]);

  if (loading) return <div className="center" role="status">Cargando…</div>;
  if (error?.status === 404) return <NotFoundPage title="No encontramos este enlace" text="Revisa que esté completo o pide uno nuevo al organizador." />;
  if (!link) {
    return (
      <div className="center">
        <p role="alert">{error?.message ?? 'No se pudo cargar el enlace.'}</p>
        <button className="btn primary" onClick={reload}>Reintentar</button>
      </div>
    );
  }

  const { rifa, cupo } = link;
  const name = nombre ?? link.compradorNombre ?? '';
  const remaining = cupo - selection.size;

  if (link.estado !== 'vigente') {
    const text = {
      usado: 'Ya elegiste tus números con este enlace.',
      vencido: 'Este enlace venció. Pídele uno nuevo al organizador.',
      revocado: 'Este enlace fue anulado por el organizador.',
    }[link.estado];
    return (
      <main className="page">
        <section className="card center">
          <h1>{rifa.nombre}</h1>
          <p>{text}</p>
          {link.ordenToken && <Link className="btn primary" to={`/orden/${link.ordenToken}`}>Ver mis números</Link>}
        </section>
      </main>
    );
  }

  const onToggle = (n: number) => {
    setNotice(null);
    if (!selection.has(n) && remaining <= 0) {
      setNotice(`Ya elegiste tus ${plural(cupo, 'número', 'números')}. Quita uno para cambiarlo.`);
      return;
    }
    setSelection(toggleNumber(selection, n));
  };
  const onToggleBooklet = (k: number) => {
    setNotice(null);
    const nums = bookletNumbers(k, rifa.numerosPorTalonario);
    if (nums.every((n) => selection.has(n))) {
      setSelection(new Set([...selection].filter((n) => !nums.includes(n))));
      return;
    }
    const added = nums.filter((n) => !selection.has(n));
    if (added.length > remaining) {
      setNotice(`Un talonario tiene ${rifa.numerosPorTalonario} números y te quedan ${remaining} por elegir.`);
      return;
    }
    setSelection(new Set([...selection, ...nums]));
  };

  const nameErr = name.trim().length < 2 ? 'Escribe tu nombre' : null;
  const contactErr = contacto.trim().length < 6 ? 'Escribe un teléfono o WhatsApp con al menos 6 dígitos' : null;

  async function submit(e: FormEvent) {
    e.preventDefault();
    setTouched(true);
    if (remaining !== 0 || nameErr || contactErr) return;
    setBusy(true);
    setFormError(null);
    try {
      const r = await api.useLink(token, { tipo: 'numeros', numeros: sorted, compradorNombre: name.trim(), compradorContacto: contacto.trim() });
      saveOrder({ token: r.token, slug: rifa.slug, numeros: r.numeros, monto: r.monto, creadaEn: new Date().toISOString() });
      navigate(`/orden/${r.token}`);
    } catch (err) {
      if (err instanceof ApiError && err.status === 409 && err.details?.noDisponibles) {
        const taken = err.details.noDisponibles as number[];
        setSelection((s) => new Set([...s].filter((n) => !taken.includes(n))));
        setNotice(`Los números ${taken.join(', ')} ya fueron tomados. Elige otros.`);
        reload();
      } else {
        setFormError(err instanceof ApiError ? err.message : 'No se pudo guardar. Inténtalo de nuevo.');
      }
      setBusy(false);
    }
  }

  return (
    <main className="page">
      <header className="card hero">
        <h1>{rifa.nombre}</h1>
        <div className="banner ok">
          {/* La fecha termina en "a. m." / "p. m.": sin punto final para no duplicarlo */}
          Tu pago ya está registrado: elige {plural(cupo, 'número', 'números')} para participar en el sorteo del {longDate(rifa.fechaSorteo)}
        </div>
      </header>

      <section aria-labelledby="grid-title" className="stack">
        <h2 id="grid-title">Elige tus números</h2>
        <p className="muted small" role="status">
          {remaining > 0 ? `Te ${remaining === 1 ? 'falta' : 'faltan'} ${plural(remaining, 'número', 'números')} por elegir.` : 'Listo: ya elegiste todos tus números.'}
        </p>
        {notice && <div className="banner" role="status">{notice}</div>}
        <NumberGrid raffle={rifa} selection={selection} onToggle={onToggle} onToggleBooklet={onToggleBooklet} />
      </section>

      <form className="card" onSubmit={submit} noValidate aria-labelledby="confirm-title">
        <h2 id="confirm-title">Tus datos</h2>
        {sorted.length > 0 && (
          <div className="chips" aria-label="Números elegidos">
            {sorted.map((n) => <span key={n} className="chip">{n}</span>)}
          </div>
        )}
        <div className="field">
          <label htmlFor="p-nombre">Tu nombre</label>
          <input id="p-nombre" autoComplete="name" value={name} onChange={(e) => setNombre(e.target.value)} aria-invalid={touched && !!nameErr} />
          {touched && nameErr && <span className="err">{nameErr}</span>}
        </div>
        <div className="field">
          <label htmlFor="p-contacto">Teléfono o WhatsApp</label>
          <input id="p-contacto" type="tel" inputMode="tel" autoComplete="tel" value={contacto} onChange={(e) => setContacto(e.target.value)} aria-invalid={touched && !!contactErr} />
          <span className="hint">Solo lo usa el organizador para avisarte. No se muestra públicamente.</span>
          {touched && contactErr && <span className="err">{contactErr}</span>}
        </div>
        {touched && remaining > 0 && <div className="banner error" role="alert">Elige {plural(remaining, 'número más', 'números más')}.</div>}
        {formError && <div className="banner error" role="alert">{formError}</div>}
        <button type="submit" className="btn cta" disabled={busy}>{busy ? 'Guardando…' : 'Confirmar mis números'}</button>
      </form>
    </main>
  );
}

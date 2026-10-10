import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { BankCard } from '../components/BankCard';
import { NumberGrid } from '../components/NumberGrid';
import { ReserveSheet } from '../components/ReserveSheet';
import { api } from '../lib/api';
import { dayLabel, money, plural, timeLabel, timeLeft } from '../lib/format';
import { loadOrders, saveOrder } from '../lib/myOrders';
import { bookletNumbers, exactBooklet, pruneSelection, toggleNumber } from '../lib/selection';
import { useLoad } from '../lib/useLoad';
import { NotFoundPage } from './NotFoundPage';

const PURPOSE = { beneficio: 'A beneficio', viaje: 'Viaje de estudio', otro: 'Rifa' } as const;

export function RafflePage() {
  const { slug = '' } = useParams();
  const navigate = useNavigate();
  // Enlace de un vendedor: /r/<slug>?v=<codigo> (sus números asignados quedan disponibles y la venta va a su nombre)
  const [params] = useSearchParams();
  const sellerCode = params.get('v');
  const { data: raffle, error, loading, reload } = useLoad(() => api.getRaffle(slug, sellerCode));
  const [selection, setSelection] = useState<Set<number>>(new Set());
  const [sheet, setSheet] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  // Si alguien más toma un número que tenías elegido, se quita de tu selección
  useEffect(() => {
    if (!raffle) return;
    setSelection((sel) => {
      const next = pruneSelection(sel, raffle);
      if (next.size !== sel.size) setNotice('Algunos números que elegiste ya fueron tomados por otra persona.');
      return next.size === sel.size ? sel : next;
    });
  }, [raffle]);

  const sorted = useMemo(() => [...selection].sort((a, b) => a - b), [selection]);
  const saved = useMemo(() => loadOrders(slug), [slug, sheet]);

  if (loading) return <div className="center" role="status">Cargando rifa…</div>;
  if (error?.status === 404) return <NotFoundPage />;
  if (!raffle) {
    return (
      <div className="center">
        <p role="alert">{error?.message ?? 'No se pudo cargar la rifa.'}</p>
        <button className="btn primary" onClick={reload}>Reintentar</button>
      </div>
    );
  }

  const open = raffle.estado === 'activa' && new Date(raffle.fechaSorteo).getTime() > Date.now();
  const pct = raffle.metaMonto > 0 ? Math.min(100, Math.round((raffle.avance.recaudado / raffle.metaMonto) * 100)) : 0;
  const isBooklet = exactBooklet(sorted, raffle.numerosPorTalonario, raffle.cantidadTalonarios) !== null;
  const overLimit = !isBooklet && sorted.length > raffle.maxNumerosPorOrden;

  const onToggle = (n: number) => {
    setNotice(null);
    if (!selection.has(n) && selection.size >= raffle.maxNumerosPorOrden && !isBooklet) {
      setNotice(`Puedes reservar hasta ${raffle.maxNumerosPorOrden} números por orden.`);
      return;
    }
    setSelection(toggleNumber(selection, n));
  };
  const onToggleBooklet = (k: number) => {
    setNotice(null);
    const nums = bookletNumbers(k, raffle.numerosPorTalonario);
    const all = nums.every((n) => selection.has(n));
    setSelection(all ? new Set([...selection].filter((n) => !nums.includes(n))) : new Set([...selection, ...nums]));
  };

  return (
    <>
      <main className="page">
        <header className="card hero">
          <div className="row">
            <span className="chip">{PURPOSE[raffle.proposito]}</span>
            {raffle.estado === 'cerrada' && <span className="chip warn">Venta cerrada</span>}
            {raffle.estado === 'sorteada' && <span className="chip ok">Sorteo realizado</span>}
          </div>
          <h1>{raffle.nombre}</h1>
          {raffle.objetivo && <p className="goal">{raffle.objetivo}</p>}

          {raffle.metaMonto > 0 && (
            <div className="stack">
              <div className="row between">
                <b>{money(raffle.avance.recaudado)} recaudados</b>
                <span className="muted small">meta {money(raffle.metaMonto)}</span>
              </div>
              <div className="progress" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} aria-label="Avance hacia la meta">
                <span style={{ width: `${pct}%` }} />
              </div>
            </div>
          )}

          <div className="facts">
            <div className="fact"><b>{dayLabel(raffle.fechaSorteo)}</b><span>Sorteo a las {timeLabel(raffle.fechaSorteo)} · {timeLeft(raffle.fechaSorteo)}</span></div>
            <div className="fact"><b>{money(raffle.precioNumero)}</b><span>por número</span></div>
            <div className="fact"><b>{money(raffle.precioTalonario)}</b><span>talonario de {raffle.numerosPorTalonario}</span></div>
            <div className="fact"><b>{raffle.avance.disponibles}</b><span>{raffle.avance.disponibles === 1 ? 'número disponible' : 'números disponibles'}</span></div>
          </div>
          {raffle.numeroAutorizacion && <p className="muted small">Autorización N° {raffle.numeroAutorizacion}</p>}
        </header>

        {!open && raffle.estado === 'activa' && <div className="banner">La venta cerró porque ya llegó la fecha del sorteo.</div>}
        {raffle.estado === 'cerrada' && <div className="banner">La venta de esta rifa está cerrada. Ya no se aceptan reservas.</div>}
        {raffle.estado === 'sorteada' && <div className="banner ok">El sorteo ya se realizó. ¡Gracias por participar!</div>}

        {raffle.vendedor && open && (
          <div className="banner ok" role="status">Estás comprando con el enlace de {raffle.vendedor.nombre}.</div>
        )}

        {saved.length > 0 && (
          <section className="card" aria-labelledby="saved-title">
            <h2 id="saved-title">Tus reservas en este dispositivo</h2>
            {saved.map((o) => (
              <div key={o.token} className="row between">
                <span>Números {o.numeros.join(', ')} · {money(o.monto)}</span>
                <Link className="btn small" to={`/orden/${o.token}`}>Ver estado</Link>
              </div>
            ))}
          </section>
        )}

        {raffle.premios.length > 0 && (
          <section className="card" aria-labelledby="prizes-title">
            <h2 id="prizes-title">Premios</h2>
            <ol className="prizes">
              {raffle.premios.map((p) => (
                <li key={p.orden} className="prize">
                  <span className="rank" aria-label={`Premio ${p.orden}`}>{p.orden}°</span>
                  <div>
                    <b>{p.nombre}</b>
                    {p.descripcion && <p className="muted small">{p.descripcion}</p>}
                  </div>
                  {p.imagenUrl && <img src={p.imagenUrl} alt={p.nombre} loading="lazy" />}
                </li>
              ))}
            </ol>
          </section>
        )}

        {raffle.datosBancarios && (
          <BankCard bank={raffle.datosBancarios} note="Primero reserva tus números; al reservar verás el monto exacto y podrás subir tu comprobante." />
        )}

        <section aria-labelledby="grid-title" className="stack">
          <h2 id="grid-title">{open ? 'Elige tus números' : 'Números'}</h2>
          {open && <p className="muted small">Toca los números disponibles, o elige un talonario completo. Máximo {raffle.maxNumerosPorOrden} números sueltos por orden.</p>}
          {notice && <div className="banner" role="status">{notice}</div>}
          <NumberGrid raffle={raffle} selection={selection} onToggle={onToggle} onToggleBooklet={onToggleBooklet} readOnly={!open} />
        </section>
      </main>

      {open && sorted.length > 0 && (
        <div className="bar" role="region" aria-label="Tu selección">
          <div>
            <div>
              <div className="total">{money(sorted.length * raffle.precioNumero)}</div>
              <div className="muted small">
                {plural(sorted.length, 'número', 'números')}
                {overLimit ? ` · máximo ${raffle.maxNumerosPorOrden}` : ''}
              </div>
            </div>
            <div className="row">
              <button className="btn" onClick={() => setSelection(new Set())}>Limpiar</button>
              <button className="btn primary" disabled={overLimit} onClick={() => setSheet(true)}>Reservar</button>
            </div>
          </div>
        </div>
      )}

      {sheet && (
        <ReserveSheet
          raffle={raffle}
          sellerCode={raffle.vendedor ? sellerCode : null}
          numbers={sorted}
          onClose={() => setSheet(false)}
          onConflict={(taken) => {
            setSheet(false);
            setSelection((s) => new Set([...s].filter((n) => !taken.includes(n))));
            setNotice(`Los números ${taken.join(', ')} ya fueron tomados por otra persona. Elige otros y vuelve a intentar.`);
            reload();
          }}
          onDone={(r) => {
            saveOrder({ token: r.token, slug, numeros: r.numeros, monto: r.monto, creadaEn: new Date().toISOString() });
            navigate(`/orden/${r.token}`);
          }}
        />
      )}
    </>
  );
}

import { FormEvent, useState } from 'react';
import { ApiError } from '../lib/api';
import { adminApi, describeError, type AdminDraw, type AdminRaffle, type DrawInput, type Prize } from '../lib/admin';
import { plural, shortDate } from '../lib/format';
import { whatsappLink, winnerMessage } from '../lib/messages';
import { CopyLink } from './CopyLink';
import { NotifyButton } from './NotifyButton';
import { useAdminLoad } from './session';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
/** Sin matchMedia (o con movimiento reducido) no hay animación */
const reducedMotion = () => !window.matchMedia || window.matchMedia('(prefers-reduced-motion: reduce)').matches;

export function DrawTab({ raffle, onChanged }: { raffle: AdminRaffle; onChanged: () => void }) {
  const { data: draws, error, loading, reload } = useAdminLoad(() => adminApi.draws(raffle.id), 60_000);
  // Números pagados: la animación solo muestra números que de verdad participan
  const paid = useAdminLoad(() => adminApi.tickets(raffle.id, 'pagado'), 60_000);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const isOrganizer = raffle.rol === 'organizador';
  const prizes = [...raffle.premios].sort((a, b) => a.orden - b.orden);
  const valid = (draws ?? []).filter((d) => !d.anuladoEn);
  const annulled = (draws ?? []).filter((d) => d.anuladoEn);
  const participants = raffle.resumen.pagados - valid.length;
  const won = new Set(valid.map((d) => d.numero));
  const pool = (paid.data ?? []).map((t) => t.numero).filter((n) => !won.has(n));

  const refresh = async () => {
    await Promise.all([reload(), paid.reload()]);
    onChanged();
  };

  async function closeSale() {
    setBusy(true);
    setMsg(null);
    try {
      await adminApi.updateRaffle(raffle.id, { estado: 'cerrada' });
      onChanged();
    } catch (err) {
      setMsg(err instanceof ApiError ? describeError(err) : 'No se pudo cerrar la venta.');
    } finally {
      setBusy(false);
    }
  }

  if (loading) return <p role="status">Cargando sorteo…</p>;
  if (!draws) return <div className="banner error" role="alert">{error?.message ?? 'No se pudo cargar el sorteo.'}</div>;

  return (
    <div className="stack gap16">
      <section className="card" aria-labelledby="draw-title">
        <h2 id="draw-title">Sorteo</h2>
        {raffle.estado === 'borrador' && <p className="muted small">Activa la rifa y vende números antes de sortear.</p>}
        {raffle.estado === 'activa' && (
          <>
            <p className="muted small">Para sortear, primero cierra la venta: así nadie reserva mientras sorteas.</p>
            {isOrganizer && <button className="btn" disabled={busy} onClick={closeSale}>Cerrar venta</button>}
          </>
        )}
        {raffle.estado === 'cerrada' && (
          <p className="small">
            Participan <b>{plural(participants, 'número pagado', 'números pagados')}</b>. Un número que ya ganó no vuelve a participar.
            {raffle.resumen.reservados > 0 &&
              ` Hay ${plural(raffle.resumen.reservados, 'número reservado', 'números reservados')} sin pagar: ${raffle.resumen.reservados === 1 ? 'no participa' : 'no participan'}.`}
          </p>
        )}
        {raffle.estado === 'sorteada' && (
          <>
            <p className="small">Todos los premios fueron sorteados. Los resultados quedaron publicados en la página de la rifa, con la forma de verificarlos.</p>
            <CopyLink url={`${window.location.origin}/r/${raffle.slug}`} label="Copiar enlace de resultados" />
          </>
        )}
        {msg && <div className="banner error" role="alert">{msg}</div>}
      </section>

      {prizes.length === 0 && <p className="banner">Agrega premios en Configuración para poder sortearlos.</p>}
      <ul className="list">
        {prizes.map((p) => (
          <li key={p.id}>
            <PrizeDraw
              raffle={raffle}
              prize={p}
              draw={valid.find((d) => d.premio.id === p.id) ?? null}
              pool={pool}
              canDraw={isOrganizer && raffle.estado === 'cerrada'}
              onChanged={refresh}
            />
          </li>
        ))}
      </ul>

      {annulled.length > 0 && (
        <section className="card" aria-labelledby="annulled-title">
          <h2 id="annulled-title">Sorteos anulados</h2>
          <p className="muted small">Quedan publicados con su motivo, para que todo el proceso sea transparente.</p>
          <ul className="stack small" style={{ margin: 0, paddingLeft: 18 }}>
            {annulled.map((d) => (
              <li key={d.id}>
                {d.premio.nombre}: N° {d.numero} ({shortDate(d.sorteadoEn)}), anulado el {shortDate(d.anuladoEn!)}. Motivo: {d.motivoAnulacion}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

interface PrizeDrawProps {
  raffle: AdminRaffle;
  prize: Prize;
  draw: AdminDraw | null;
  /** Números que participan (para la animación) */
  pool: number[];
  canDraw: boolean;
  onChanged: () => Promise<void>;
}

function PrizeDraw({ raffle, prize, draw, pool, canDraw, onChanged }: PrizeDrawProps) {
  const total = raffle.cantidadTalonarios * raffle.numerosPorTalonario;
  const [manual, setManual] = useState(false);
  const [numero, setNumero] = useState('');
  const [detalle, setDetalle] = useState('');
  const [busy, setBusy] = useState(false);
  const [rolling, setRolling] = useState<number | null>(null);
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function run(confirmarPendientes = false) {
    const body: DrawInput = manual
      ? { premioId: prize.id, modo: 'manual', numero: Number(numero), detalle: detalle.trim(), confirmarPendientes }
      : { premioId: prize.id, modo: 'aleatorio', confirmarPendientes };
    setBusy(true);
    setError(null);
    // Animación de "tómbola" mientras sale el número (útil si se comparte la pantalla en vivo)
    const animate = !manual && pool.length > 1 && !reducedMotion();
    const timer = animate ? setInterval(() => setRolling(pool[Math.floor(Math.random() * pool.length)]), 70) : undefined;
    const started = Date.now();
    try {
      await adminApi.drawPrize(raffle.id, body);
      if (animate) await sleep(Math.max(0, 1500 - (Date.now() - started)));
      setPending(null);
      setManual(false);
      await onChanged();
    } catch (err) {
      if (err instanceof ApiError && err.code === 'pending_orders') setPending(err.message);
      else setError(err instanceof ApiError ? describeError(err) : 'No se pudo sortear.');
    } finally {
      clearInterval(timer);
      setRolling(null);
      setBusy(false);
    }
  }

  function submitManual(e: FormEvent) {
    e.preventDefault();
    const n = Number(numero);
    if (!Number.isInteger(n) || n < 1 || n > total) return setError(`El número va del 1 al ${total}`);
    if (detalle.trim().length < 3) return setError('Indica de dónde salió el número');
    run();
  }

  return (
    <article className="card" aria-labelledby={`p-${prize.id}`}>
      <div className="row between">
        <h3 id={`p-${prize.id}`}>
          {prize.orden}° premio: {prize.nombre}
        </h3>
        {draw ? <span className="chip ok">Sorteado</span> : <span className="chip neutral">Pendiente</span>}
      </div>

      {rolling !== null && (
        <div className="drum" aria-live="off" aria-hidden="true">
          N° {rolling}
        </div>
      )}

      {draw ? (
        <Winner raffle={raffle} draw={draw} canAnnul={raffle.rol === 'organizador'} onChanged={onChanged} />
      ) : (
        canDraw &&
        rolling === null && (
          <>
            {!manual ? (
              <div className="row">
                <button className="btn primary" disabled={busy} onClick={() => run()}>Sortear al azar</button>
                <button className="btn" disabled={busy} onClick={() => setManual(true)}>Registrar resultado externo</button>
              </div>
            ) : (
              <form className="subform" onSubmit={submitManual} noValidate aria-label={`Resultado externo de ${prize.nombre}`}>
                <div className="grid2">
                  <div className="field">
                    <label htmlFor={`n-${prize.id}`}>Número ganador</label>
                    <input id={`n-${prize.id}`} type="number" min={1} max={total} inputMode="numeric" value={numero} onChange={(e) => setNumero(e.target.value)} />
                  </div>
                  <div className="field">
                    <label htmlFor={`d-${prize.id}`}>De dónde salió</label>
                    <input id={`d-${prize.id}`} maxLength={300} placeholder="Ej: Lotería del 12/11, 3 últimas cifras" value={detalle} onChange={(e) => setDetalle(e.target.value)} />
                  </div>
                </div>
                <div className="row" style={{ justifyContent: 'flex-end' }}>
                  <button type="button" className="btn small" disabled={busy} onClick={() => setManual(false)}>Cancelar</button>
                  <button type="submit" className="btn small primary" disabled={busy}>Registrar ganador</button>
                </div>
              </form>
            )}
          </>
        )
      )}

      {pending && (
        <div className="banner" role="alert">
          {pending} ¿Sortear igual?
          <div className="row" style={{ marginTop: 8 }}>
            <button className="btn small primary" disabled={busy} onClick={() => run(true)}>Sortear igual</button>
            <button className="btn small" disabled={busy} onClick={() => setPending(null)}>Revisar primero</button>
          </div>
        </div>
      )}
      {error && <div className="banner error" role="alert">{error}</div>}
    </article>
  );
}

function Winner({ raffle, draw: d, canAnnul, onChanged }: { raffle: AdminRaffle; draw: AdminDraw; canAnnul: boolean; onChanged: () => Promise<void> }) {
  const [annulling, setAnnulling] = useState(false);
  const [motivo, setMotivo] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const wa = d.compradorContacto ? whatsappLink(d.compradorContacto) : null;

  async function annul(e: FormEvent) {
    e.preventDefault();
    if (motivo.trim().length < 5) return setError('Explica el motivo (queda publicado)');
    setBusy(true);
    setError(null);
    try {
      await adminApi.annulDraw(d.id, motivo.trim());
      await onChanged();
    } catch (err) {
      setError(err instanceof ApiError ? describeError(err) : 'No se pudo anular.');
      setBusy(false);
    }
  }

  return (
    <div className="stack">
      <div className="result-row">
        <span className="winner big">
          <span className="sr-only">Número ganador </span>
          <span aria-hidden="true">N° </span>
          {d.numero}
        </span>
        <div>
          <b>{d.compradorNombre ?? 'Sin comprador'}</b>
          {d.compradorContacto && (
            <span className="small"> · {wa ? <a href={wa} target="_blank" rel="noreferrer">{d.compradorContacto}</a> : d.compradorContacto}</span>
          )}
          <p className="muted small">
            {d.modo === 'aleatorio' ? `Al azar entre ${d.participantes} números` : `Sorteo externo: ${d.detalle}`} · {shortDate(d.sorteadoEn)}
            {d.ordenId && ` · orden #${d.ordenId}`}
            {d.vendedorNombre && ` · vendedor: ${d.vendedorNombre}`}
          </p>
        </div>
      </div>
      <div className="row">
        {d.compradorContacto && <NotifyButton contact={d.compradorContacto} text={winnerMessage(d, raffle)} label="Avisar al ganador" />}
        {canAnnul && !annulling && <button className="btn small danger" onClick={() => setAnnulling(true)}>Anular sorteo</button>}
      </div>
      {annulling && (
        <form className="subform" onSubmit={annul} noValidate aria-label="Anular sorteo">
          <div className="field">
            <label htmlFor={`m-${d.id}`}>Motivo (se publica junto al resultado)</label>
            <input id={`m-${d.id}`} maxLength={300} value={motivo} onChange={(e) => setMotivo(e.target.value)} placeholder="Ej: el ganador no respondió en 7 días" />
          </div>
          <div className="row" style={{ justifyContent: 'flex-end' }}>
            <button type="button" className="btn small" disabled={busy} onClick={() => setAnnulling(false)}>Cancelar</button>
            <button type="submit" className="btn small danger" disabled={busy}>Anular y permitir repetir</button>
          </div>
        </form>
      )}
      {error && <div className="banner error" role="alert">{error}</div>}
    </div>
  );
}

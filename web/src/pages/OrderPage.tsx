import { ChangeEvent, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { BankCard } from '../components/BankCard';
import { ApiError, api } from '../lib/api';
import { longDate, money, shortDate, timeLeft } from '../lib/format';
import { useLoad } from '../lib/useLoad';
import { NotFoundPage } from './NotFoundPage';

const STATUS = {
  pendiente: { label: 'Pendiente de pago', cls: 'warn' },
  pagada: { label: 'Pago confirmado', cls: 'ok' },
  vencida: { label: 'Reserva vencida', cls: 'bad' },
  cancelada: { label: 'Cancelada', cls: 'neutral' },
} as const;

const MAX_MB = 5;

export function OrderPage() {
  const { token = '' } = useParams();
  const { data: order, error, loading, reload } = useLoad(() => api.getOrder(token), 60_000);
  const [uploading, setUploading] = useState(false);
  const [msg, setMsg] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  const [copied, setCopied] = useState(false);

  if (loading) return <div className="center" role="status">Cargando tu reserva…</div>;
  if (error?.status === 404) return <NotFoundPage title="No encontramos esta reserva" text="Revisa que el enlace esté completo." />;
  if (!order) {
    return (
      <div className="center">
        <p role="alert">{error?.message ?? 'No se pudo cargar la reserva.'}</p>
        <button className="btn primary" onClick={reload}>Reintentar</button>
      </div>
    );
  }

  const st = STATUS[order.estado];
  const canUpload = order.estado === 'pendiente' && order.comprobantes.length < 5;

  async function onFile(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (file.size > MAX_MB * 1024 * 1024) {
      setMsg({ kind: 'error', text: `El archivo pesa más de ${MAX_MB} MB.` });
      return;
    }
    setUploading(true);
    setMsg(null);
    try {
      await api.uploadProof(token, file);
      setMsg({ kind: 'ok', text: 'Comprobante enviado. El organizador confirmará tu pago pronto.' });
      await reload();
    } catch (err) {
      setMsg({ kind: 'error', text: err instanceof ApiError ? err.message : 'No se pudo subir el archivo.' });
    } finally {
      setUploading(false);
    }
  }

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* sin portapapeles: el enlace está en la barra del navegador */
    }
  }

  return (
    <main className="page">
      {/* La reserva es el boleto del comprador: mismo talón que la rifa, con sus números en la parte desprendible */}
      <header className="stub">
        <div className="stub-main">
          <div className="row"><span className={`chip ${st.cls}`}>{st.label}</span></div>
          <h1>Tu reserva en {order.rifa.nombre}</h1>
          {/* La fecha termina en "a. m." / "p. m.": sin punto final para no duplicarlo */}
          <p className="muted">Hola {order.compradorNombre}. Sorteo: {longDate(order.rifa.fechaSorteo)}</p>
        </div>
        <div className="stub-tear" aria-hidden="true" />
        <dl className="stub-facts">
          <div style={{ gridColumn: '1 / -1' }}>
            <dt>{order.numeros.length === 1 ? 'Tu número' : `Tus ${order.numeros.length} números`}</dt>
            <dd className="chips" aria-label="Números">
              {order.numeros.map((n) => <span key={n} className="chip">{n}</span>)}
            </dd>
          </div>
          <div>
            <dt>Total</dt>
            <dd>{money(order.monto)}</dd>
          </div>
          <div>
            <dt>Rifa</dt>
            <dd><Link to={`/r/${order.rifa.slug}`}>Ver la rifa</Link></dd>
          </div>
        </dl>
      </header>

      {order.estado === 'pendiente' && (
        <div className="banner" role="status">
          Transfiere {money(order.monto)} antes del {shortDate(order.venceEn)} ({timeLeft(order.venceEn)}); después sube tu comprobante.
        </div>
      )}
      {order.premios && order.premios.length > 0 ? (
        <div className="banner ok winner-banner" role="status">
          ¡Felicitaciones!{' '}
          {order.premios.map((p) => `Tu número ${p.numero} ganó el ${p.orden}° premio: ${p.nombre}.`).join(' ')} El organizador te contactará para
          entregártelo.
        </div>
      ) : (
        order.estado === 'pagada' &&
        (order.rifa.estado === 'sorteada' ? (
          <div className="banner">El sorteo ya se realizó. Revisa los resultados en la página de la rifa. ¡Gracias por participar!</div>
        ) : (
          <div className="banner ok">¡Listo! Tu pago está confirmado y tus números participan del sorteo.</div>
        ))
      )}
      {order.estado === 'vencida' && (
        <div className="banner error">
          Tu reserva venció y los números se liberaron. Si ya transferiste, avísale al organizador: puede reactivarla si los números siguen libres.
        </div>
      )}

      {order.datosBancarios && <BankCard bank={order.datosBancarios} note={`Transfiere exactamente ${money(order.monto)}.`} />}

      {(canUpload || order.comprobantes.length > 0) && (
        <section className="card" aria-labelledby="proof-title">
          <h2 id="proof-title">Comprobante de transferencia</h2>
          {order.comprobantes.length > 0 && (
            <ul className="stack" style={{ margin: 0, paddingLeft: 18 }}>
              {order.comprobantes.map((c) => (
                <li key={c.id}>
                  <a href={api.proofUrl(token, c.id)} target="_blank" rel="noreferrer">{c.nombre}</a>{' '}
                  <span className="muted small">· enviado el {shortDate(c.subidoEn)}</span>
                </li>
              ))}
            </ul>
          )}
          {canUpload && (
            <div className="upload">
              <label htmlFor="proof" style={{ fontWeight: 600 }}>{order.comprobantes.length ? 'Subir otro comprobante' : 'Sube una foto o PDF de tu transferencia'}</label>
              <input id="proof" type="file" accept="image/jpeg,image/png,image/webp,application/pdf" onChange={onFile} disabled={uploading} />
              <span className="muted small">JPG, PNG, WebP o PDF · máximo {MAX_MB} MB</span>
              {uploading && <span role="status">Subiendo…</span>}
            </div>
          )}
          {msg && <div className={`banner ${msg.kind}`} role={msg.kind === 'error' ? 'alert' : 'status'}>{msg.text}</div>}
        </section>
      )}

      <section className="card">
        <h2>Guarda este enlace</h2>
        <p className="muted small">Con este enlace puedes volver a ver el estado de tu reserva y subir tu comprobante. No lo compartas: cualquiera que lo tenga puede verlo.</p>
        <button className="btn small" style={{ justifySelf: 'start' }} onClick={copyLink}>{copied ? 'Enlace copiado' : 'Copiar enlace'}</button>
      </section>
    </main>
  );
}

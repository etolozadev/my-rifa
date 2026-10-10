import { FormEvent, useState } from 'react';
import { ApiError } from '../lib/api';
import { adminApi, describeError, shareLinkUrl, type AdminRaffle, type LinkState, type ShareLinkView } from '../lib/admin';
import { money, plural, shortDate } from '../lib/format';
import { CopyLink } from './CopyLink';
import { useAdminLoad } from './session';

const STATE: Record<LinkState, { label: string; cls: string }> = {
  vigente: { label: 'Sin usar', cls: 'warn' },
  usado: { label: 'Usado', cls: 'ok' },
  vencido: { label: 'Vencido', cls: 'bad' },
  revocado: { label: 'Anulado', cls: 'neutral' },
};

/** Enlaces para quien ya pagó: elige sus números y la orden nace pagada. */
export function LinksTab({ raffle }: { raffle: AdminRaffle }) {
  const { data: links, error, loading, reload } = useAdminLoad(() => adminApi.links(raffle.id), 60_000);
  const [cupo, setCupo] = useState('1');
  const [nombre, setNombre] = useState('');
  const [contacto, setContacto] = useState('');
  const [dias, setDias] = useState('7');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [created, setCreated] = useState<ShareLinkView | null>(null);
  const selling = raffle.estado === 'activa' || raffle.estado === 'cerrada';
  const n = Number(cupo);

  async function create(e: FormEvent) {
    e.preventDefault();
    if (!Number.isInteger(n) || n < 1 || n > 200) return setMsg('La cantidad va de 1 a 200 números');
    const d = Number(dias);
    if (!Number.isInteger(d) || d < 1 || d > 60) return setMsg('La vigencia va de 1 a 60 días');
    setBusy(true);
    setMsg(null);
    try {
      const link = await adminApi.createLink(raffle.id, {
        cupo: n,
        venceDias: d,
        compradorNombre: nombre.trim() || null,
        compradorContacto: contacto.trim() || null,
      });
      setCreated(link);
      setNombre('');
      setContacto('');
      setCupo('1');
      await reload();
    } catch (err) {
      setMsg(err instanceof ApiError ? describeError(err) : 'No se pudo crear el enlace.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="stack gap16">
      <section className="card" aria-labelledby="new-link-title">
        <h2 id="new-link-title">Enlace de pago previo</h2>
        <p className="muted small">
          Para quien ya te pagó (en efectivo o por transferencia) y quiere elegir sus números: crea un enlace por la cantidad pagada y
          envíaselo. Al usarlo, sus números quedan pagados de inmediato. Sirve una sola vez.
        </p>
        {!selling ? (
          <p className="banner">{raffle.estado === 'borrador' ? 'Activa la rifa para crear enlaces.' : 'La rifa ya fue sorteada.'}</p>
        ) : (
          <form className="stack" onSubmit={create} noValidate>
            <div className="grid2">
              <div className="field">
                <label htmlFor="l-cupo">Números pagados</label>
                <input id="l-cupo" type="number" min={1} max={200} inputMode="numeric" value={cupo} onChange={(e) => setCupo(e.target.value)} />
                {Number.isInteger(n) && n > 0 && <span className="hint">Equivale a {money(n * raffle.precioNumero)}</span>}
              </div>
              <div className="field">
                <label htmlFor="l-dias">Vigencia (días)</label>
                <input id="l-dias" type="number" min={1} max={60} inputMode="numeric" value={dias} onChange={(e) => setDias(e.target.value)} />
              </div>
              <div className="field">
                <label htmlFor="l-nombre">Comprador (opcional)</label>
                <input id="l-nombre" maxLength={120} value={nombre} onChange={(e) => setNombre(e.target.value)} />
              </div>
              <div className="field">
                <label htmlFor="l-contacto">Contacto (opcional)</label>
                <input id="l-contacto" type="tel" maxLength={120} value={contacto} onChange={(e) => setContacto(e.target.value)} />
              </div>
            </div>
            {msg && <div className="banner error" role="alert">{msg}</div>}
            <button type="submit" className="btn primary" disabled={busy}>{busy ? 'Creando…' : 'Crear enlace'}</button>
          </form>
        )}
        {created && (
          <div className="banner ok" role="status">
            Enlace creado por {plural(created.cupo, 'número', 'números')}. Envíaselo al comprador:
            <CopyLink url={shareLinkUrl(created.token)} />
          </div>
        )}
      </section>

      {loading && <p role="status">Cargando enlaces…</p>}
      {!loading && !links && <div className="banner error" role="alert">{error?.message ?? 'No se pudieron cargar los enlaces.'}</div>}
      {links && links.length > 0 && (
        <ul className="list">
          {links.map((l) => (
            <li key={l.id}>
              <LinkCard link={l} onChanged={reload} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function LinkCard({ link: l, onChanged }: { link: ShareLinkView; onChanged: () => Promise<void> }) {
  const [confirm, setConfirm] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const st = STATE[l.estado];

  async function revoke() {
    try {
      await adminApi.revokeLink(l.id);
      await onChanged();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'No se pudo anular.');
    }
  }

  return (
    <article className="card" aria-labelledby={`l-${l.id}`}>
      <div className="row between">
        <h3 id={`l-${l.id}`}>
          {l.compradorNombre ?? 'Sin nombre'} <span className="muted small">· {plural(l.cupo, 'número', 'números')}</span>
        </h3>
        <span className={`chip ${st.cls}`}>{st.label}</span>
      </div>
      <p className="muted small">
        Creado el {shortDate(l.creadoEn)}
        {l.estado === 'vigente' && ` · vence el ${shortDate(l.venceEn)}`}
        {l.vendedorNombre && ` · vendedor: ${l.vendedorNombre}`}
        {l.compradorContacto && ` · ${l.compradorContacto}`}
        {l.ordenId && ` · orden #${l.ordenId}`}
      </p>
      {l.estado === 'vigente' && (
        <>
          <CopyLink url={shareLinkUrl(l.token)} />
          <div className="row">
            {confirm ? (
              <span className="row confirm" role="group" aria-label="Confirmar anulación">
                <span className="small">¿Anular el enlace?</span>
                <button className="btn small danger" onClick={revoke}>Sí, anular</button>
                <button className="btn small" onClick={() => setConfirm(false)}>No</button>
              </span>
            ) : (
              <button className="btn small danger" onClick={() => setConfirm(true)}>Anular</button>
            )}
          </div>
        </>
      )}
      {error && <div className="banner error" role="alert">{error}</div>}
    </article>
  );
}

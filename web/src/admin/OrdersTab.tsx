import { useMemo, useState } from 'react';
import { ApiError } from '../lib/api';
import { adminApi, describeError, type AdminOrder, type AdminRaffle } from '../lib/admin';
import { money, plural, shortDate, timeLeft } from '../lib/format';
import { CHANNEL, ORDER_STATE } from './labels';
import { ManualSaleSheet } from './ManualSaleSheet';
import { useAdminLoad } from './session';

type Filter = 'revisar' | 'pendiente' | 'pagada' | 'vencida' | 'cancelada' | 'todas';

const FILTERS: { key: Filter; label: string; test: (o: AdminOrder) => boolean }[] = [
  { key: 'revisar', label: 'Por revisar', test: (o) => o.estado === 'pendiente' && o.comprobantes.length > 0 },
  { key: 'pendiente', label: 'Pendientes', test: (o) => o.estado === 'pendiente' },
  { key: 'pagada', label: 'Pagadas', test: (o) => o.estado === 'pagada' },
  { key: 'vencida', label: 'Vencidas', test: (o) => o.estado === 'vencida' },
  { key: 'cancelada', label: 'Canceladas', test: (o) => o.estado === 'cancelada' },
  { key: 'todas', label: 'Todas', test: () => true },
];

/** Enlace de WhatsApp si el contacto parece un teléfono chileno o internacional */
export function whatsappLink(contact: string): string | null {
  const digits = contact.replace(/\D/g, '');
  if (digits.length === 9 && digits.startsWith('9')) return `https://wa.me/56${digits}`;
  if (digits.length >= 10 && digits.length <= 15) return `https://wa.me/${digits}`;
  return null;
}

export function OrdersTab({ raffle, onChanged }: { raffle: AdminRaffle; onChanged: () => void }) {
  const { data: orders, error, loading, reload } = useAdminLoad(() => adminApi.orders(raffle.id));
  // Sin elegir: 'Por revisar' si hay comprobantes nuevos, si no 'Todas'
  const [chosen, setFilter] = useState<Filter | null>(null);
  const [query, setQuery] = useState('');
  const [sale, setSale] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const counts = useMemo(() => Object.fromEntries(FILTERS.map((f) => [f.key, orders?.filter(f.test).length ?? 0])), [orders]);
  const filter: Filter = chosen ?? (counts.revisar > 0 ? 'revisar' : 'todas');
  const visible = useMemo(() => {
    const f = FILTERS.find((x) => x.key === filter)!;
    const q = query.trim().toLowerCase();
    const n = Number(q);
    return (orders ?? []).filter(
      (o) =>
        f.test(o) &&
        (!q ||
          o.compradorNombre.toLowerCase().includes(q) ||
          (o.vendedorNombre ?? '').toLowerCase().includes(q) ||
          o.compradorContacto.toLowerCase().includes(q) ||
          (Number.isInteger(n) && (o.numeros.includes(n) || o.id === n))),
    );
  }, [orders, filter, query]);

  const refresh = async () => {
    await reload();
    onChanged();
  };

  return (
    <div className="stack gap16">
      <div className="row between">
        <div className="field grow">
          <label htmlFor="q" className="sr-only">Buscar</label>
          <input id="q" type="search" placeholder="Buscar por nombre, contacto o número" value={query} onChange={(e) => setQuery(e.target.value)} />
        </div>
        <button className="btn primary" onClick={() => setSale(true)}>Registrar venta</button>
      </div>

      <div className="filters" role="group" aria-label="Filtrar órdenes">
        {FILTERS.map((f) => (
          <button key={f.key} type="button" className={`btn small ${filter === f.key ? 'active' : ''}`} aria-pressed={filter === f.key} onClick={() => setFilter(f.key)}>
            {f.label} <span className="count">{counts[f.key]}</span>
          </button>
        ))}
      </div>

      {notice && <div className="banner ok" role="status">{notice}</div>}
      {loading && <p role="status">Cargando órdenes…</p>}
      {!loading && !orders && <div className="banner error" role="alert">{error?.message ?? 'No se pudieron cargar las órdenes.'}</div>}
      {orders && visible.length === 0 && (
        <p className="muted center">{filter === 'revisar' ? 'No hay comprobantes por revisar.' : 'No hay órdenes aquí.'}</p>
      )}

      <ul className="list">
        {visible.map((o) => (
          <li key={o.id}>
            <OrderCard order={o} onChanged={refresh} />
          </li>
        ))}
      </ul>

      {sale && (
        <ManualSaleSheet
          raffle={raffle}
          onClose={() => setSale(false)}
          onDone={async (text) => {
            setSale(false);
            setNotice(text);
            await refresh();
          }}
        />
      )}
    </div>
  );
}

function OrderCard({ order: o, onChanged }: { order: AdminOrder; onChanged: () => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const st = ORDER_STATE[o.estado];
  const wa = whatsappLink(o.compradorContacto);

  async function run(action: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try {
      await action();
      setConfirmCancel(false);
      await onChanged();
    } catch (err) {
      if (err instanceof ApiError && err.details?.noDisponibles) {
        setError(`${err.message}: ${(err.details.noDisponibles as number[]).join(', ')}`);
      } else {
        setError(err instanceof ApiError ? describeError(err) : 'No se pudo completar la acción.');
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <article className="card" aria-labelledby={`o-${o.id}`}>
      <div className="row between">
        <h3 id={`o-${o.id}`}>
          {o.compradorNombre} <span className="muted small">· orden #{o.id}</span>
        </h3>
        <span className={`chip ${st.cls}`}>{st.label}</span>
      </div>
      <p className="small">
        {wa ? <a href={wa} target="_blank" rel="noreferrer">{o.compradorContacto}</a> : o.compradorContacto}
        <span className="muted">
          {' '}· {o.shareLinkId ? 'Enlace de pago previo' : CHANNEL[o.canal]} · {shortDate(o.creadaEn)}
          {o.vendedorNombre && ` · vendedor: ${o.vendedorNombre}`}
        </span>
      </p>
      <div className="chips" aria-label="Números">
        {o.numeros.map((n) => <span key={n} className="chip">{n}</span>)}
      </div>
      <p>
        <b>{money(o.monto)}</b> <span className="muted small">({plural(o.numeros.length, 'número', 'números')}{o.tipo === 'talonario' ? ', talonario completo' : ''})</span>
      </p>
      {o.estado === 'pendiente' && <p className="muted small">Vence el {shortDate(o.venceEn)} ({timeLeft(o.venceEn)})</p>}
      {o.estado === 'pagada' && o.pagadaEn && <p className="muted small">Pago confirmado el {shortDate(o.pagadaEn)}</p>}

      {o.comprobantes.length > 0 && (
        <div className="stack">
          <span className="small" style={{ fontWeight: 600 }}>Comprobantes</span>
          <ul className="proofs">
            {o.comprobantes.map((c) => (
              <li key={c.id}>
                <a href={adminApi.proofUrl(c.id)} target="_blank" rel="noreferrer">{c.nombreOriginal}</a>
                <span className="muted small"> · {shortDate(c.subidoEn)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {error && <div className="banner error" role="alert">{error}</div>}

      {o.estado !== 'cancelada' && (
        <div className="row">
          {(o.estado === 'pendiente' || o.estado === 'vencida') && (
            <button className="btn small primary" disabled={busy} onClick={() => run(() => adminApi.confirmOrder(o.id))}>
              Confirmar pago
            </button>
          )}
          {o.estado === 'pendiente' && (
            <button className="btn small" disabled={busy} onClick={() => run(() => adminApi.extendOrder(o.id, 7))}>Dar 7 días más</button>
          )}
          {o.estado === 'vencida' && (
            <button className="btn small" disabled={busy} onClick={() => run(() => adminApi.extendOrder(o.id, 7))}>Reactivar 7 días</button>
          )}
          {!confirmCancel ? (
            <button className="btn small danger" disabled={busy} onClick={() => setConfirmCancel(true)}>
              {o.estado === 'pagada' ? 'Anular venta' : 'Cancelar'}
            </button>
          ) : (
            <span className="row confirm" role="group" aria-label="Confirmar cancelación">
              <span className="small">Los números quedarán libres. ¿Seguro?</span>
              <button className="btn small danger" disabled={busy} onClick={() => run(() => adminApi.cancelOrder(o.id))}>Sí, cancelar</button>
              <button className="btn small" disabled={busy} onClick={() => setConfirmCancel(false)}>No</button>
            </span>
          )}
        </div>
      )}
    </article>
  );
}

import { useState } from 'react';
import { ApiError } from '../lib/api';
import { adminApi, describeError, parseNumberList, sellerUrl, type AdminRaffle, type SellerStats } from '../lib/admin';
import { money } from '../lib/format';
import { CopyLink } from './CopyLink';
import { useAdminLoad } from './session';

export function SellersTab({ raffle }: { raffle: AdminRaffle }) {
  const { data: sellers, error, loading, reload } = useAdminLoad(() => adminApi.sellers(raffle.id), 60_000);

  if (loading) return <p role="status">Cargando vendedores…</p>;
  if (!sellers) return <div className="banner error" role="alert">{error?.message ?? 'No se pudieron cargar los vendedores.'}</div>;

  const active = sellers.filter((s) => s.activo);
  const totals = active.reduce((a, s) => ({ vendidos: a.vendidos + s.vendidos, recaudado: a.recaudado + s.recaudado, porCobrar: a.porCobrar + s.porCobrar }), {
    vendidos: 0,
    recaudado: 0,
    porCobrar: 0,
  });

  return (
    <div className="stack gap16">
      <p className="muted small">
        Cada vendedor tiene su propio enlace: lo que se reserve con él queda a su nombre. Si le entregas talonarios físicos,
        asígnale esos números: dejan de ofrecerse en la web (salvo con su enlace) para que no se vendan dos veces.
      </p>
      {sellers.length === 0 ? (
        <section className="card center">
          <h2>Aún no hay vendedores</h2>
          <p className="muted">
            {raffle.rol === 'organizador'
              ? 'Súmalos en Configuración → Equipo, por correo o con una invitación por link.'
              : 'El organizador puede sumarlos desde Configuración → Equipo.'}
          </p>
        </section>
      ) : (
        <>
          {active.length > 1 && (
            <div className="facts">
              <div className="fact"><b>{totals.vendidos}</b><span>vendidos por vendedores</span></div>
              <div className="fact"><b>{money(totals.recaudado)}</b><span>recaudado por vendedores</span></div>
              <div className="fact"><b>{money(totals.porCobrar)}</b><span>por cobrar</span></div>
            </div>
          )}
          <ul className="list">
            {sellers.map((s) => (
              <li key={s.id}>
                <SellerCard raffle={raffle} seller={s} onChanged={reload} />
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

function SellerCard({ raffle, seller: s, onChanged }: { raffle: AdminRaffle; seller: SellerStats; onChanged: () => Promise<void> }) {
  const total = raffle.cantidadTalonarios * raffle.numerosPorTalonario;
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);

  async function run(kind: 'asignar' | 'liberar') {
    const nums = parseNumberList(text, total);
    if (typeof nums === 'string') return setMsg({ kind: 'error', text: nums });
    setBusy(true);
    setMsg(null);
    try {
      if (kind === 'asignar') {
        const r = await adminApi.assign(raffle.id, s.id, nums);
        setMsg({ kind: 'ok', text: `${r.asignados} números asignados a ${s.nombre}.` });
      } else {
        const r = await adminApi.release(raffle.id, s.id, nums);
        setMsg({ kind: 'ok', text: r.liberados ? `${r.liberados} números volvieron a la venta general.` : 'No había números libres de ese vendedor en ese rango.' });
      }
      setText('');
      await onChanged();
    } catch (err) {
      const e = err instanceof ApiError ? err : null;
      setMsg({ kind: 'error', text: e?.details?.noDisponibles ? `${e.message}: ${(e.details.noDisponibles as number[]).join(', ')}` : e ? describeError(e) : 'No se pudo guardar.' });
    } finally {
      setBusy(false);
    }
  }

  return (
    <article className="card" aria-labelledby={`s-${s.id}`}>
      <div className="row between">
        <h3 id={`s-${s.id}`}>
          {s.nombre} <span className="muted small">{s.email}</span>
        </h3>
        {!s.activo && <span className="chip neutral">Ya no está en el equipo</span>}
      </div>
      <div className="facts">
        <div className="fact"><b>{s.vendidos}</b><span>vendidos · {money(s.recaudado)}</span></div>
        <div className="fact"><b>{s.reservados}</b><span>reservados · {money(s.porCobrar)} por cobrar</span></div>
        <div className="fact"><b>{s.asignadosLibres}</b><span>libres de {s.asignados} asignados</span></div>
      </div>
      {s.asignadosRangos && <p className="small">Talonario asignado: <b>{s.asignadosRangos}</b></p>}

      {s.activo && (
        <>
          <CopyLink url={sellerUrl(raffle.slug, s.codigoEnlace)} label="Copiar su enlace" disabled={raffle.estado === 'borrador'} />
          <div className="row">
            <div className="field grow">
              <label htmlFor={`as-${s.id}`}>Números o rangos</label>
              <input id={`as-${s.id}`} inputMode="numeric" placeholder="Ej: 1-50, 75" value={text} onChange={(e) => setText(e.target.value)} />
            </div>
            <button type="button" className="btn small" disabled={busy || !text.trim()} onClick={() => run('asignar')}>Asignar</button>
            <button type="button" className="btn small" disabled={busy || !text.trim()} onClick={() => run('liberar')}>Quitar asignación</button>
          </div>
        </>
      )}
      {msg && <div className={`banner ${msg.kind}`} role={msg.kind === 'error' ? 'alert' : 'status'}>{msg.text}</div>}
    </article>
  );
}

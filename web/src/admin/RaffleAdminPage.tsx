import { ArrowLeftIcon } from '../components/icons';
import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ApiError } from '../lib/api';
import { adminApi, describeError, sellerUrl, type AdminRaffle, type RaffleState, type Rol } from '../lib/admin';
import { longDate, money } from '../lib/format';
import { NotFoundPage } from '../pages/NotFoundPage';
import { BulkTab } from './BulkTab';
import { ContactsTab } from './ContactsTab';
import { CopyLink } from './CopyLink';
import { DrawTab } from './DrawTab';
import { RAFFLE_STATE } from './labels';
import { LinksTab } from './LinksTab';
import { NumbersTab } from './NumbersTab';
import { OrdersTab } from './OrdersTab';
import { SellersTab } from './SellersTab';
import { SettingsTab } from './SettingsTab';
import { TabBar } from './TabBar';
import { useAdminLoad } from './session';

const ALL: Rol[] = ['organizador', 'editor', 'vendedor'];
const TEAM: Rol[] = ['organizador', 'editor'];
const TABS: { key: string; label: string; roles: Rol[] }[] = [
  { key: 'resumen', label: 'Resumen', roles: ALL },
  { key: 'ordenes', label: 'Órdenes', roles: ALL },
  { key: 'numeros', label: 'Números', roles: ALL },
  { key: 'vendedores', label: 'Vendedores', roles: TEAM },
  { key: 'contactos', label: 'Contactos', roles: TEAM },
  { key: 'carga', label: 'Carga rápida', roles: ALL },
  { key: 'enlaces', label: 'Enlaces de pago', roles: ALL },
  { key: 'sorteo', label: 'Sorteo', roles: TEAM },
  { key: 'configuracion', label: 'Configuración', roles: ['organizador'] },
];

export function RaffleAdminPage() {
  const { id: idParam = '', tab = 'resumen' } = useParams();
  const id = Number(idParam);
  const { data: raffle, error, loading, reload } = useAdminLoad(() => adminApi.raffle(id));

  if (loading) return <div className="center" role="status">Cargando rifa…</div>;
  if (error?.status === 404 || error?.status === 403 || !Number.isInteger(id)) {
    return <NotFoundPage title="Rifa no encontrada" text="No existe o no eres parte de su equipo." />;
  }
  if (!raffle) {
    return (
      <div className="center">
        <p role="alert">{error?.message ?? 'No se pudo cargar la rifa.'}</p>
        <button className="btn primary" onClick={reload}>Reintentar</button>
      </div>
    );
  }

  const tabs = TABS.filter((t) => t.roles.includes(raffle.rol));
  const allowed = tabs.some((t) => t.key === tab);
  const st = RAFFLE_STATE[raffle.estado];

  return (
    <main className="page wide">
      <Link to="/admin" className="link-back"><ArrowLeftIcon size={16} aria-hidden="true" />Mis rifas</Link>
      <header className="stack raffle-head">
        <div className="row between">
          <h1>{raffle.nombre}</h1>
          <span className={`chip ${st.cls}`}>{st.label}</span>
        </div>
        <p className="muted small">Sorteo: {longDate(raffle.fechaSorteo)}</p>
      </header>

      <TabBar label="Secciones de la rifa" current={tab} items={tabs.map((t) => ({ key: t.key, label: t.label, to: `/admin/rifas/${id}/${t.key}` }))} />

      {!allowed && TABS.some((t) => t.key === tab) && <p className="banner">Tu rol en esta rifa no tiene acceso a esta sección.</p>}
      {!TABS.some((t) => t.key === tab) && <NotFoundPage title="Sección no encontrada" text="" />}
      {allowed && tab === 'resumen' && <Overview raffle={raffle} onChanged={reload} />}
      {allowed && tab === 'ordenes' && <OrdersTab raffle={raffle} onChanged={reload} />}
      {allowed && tab === 'numeros' && <NumbersTab raffle={raffle} />}
      {allowed && tab === 'vendedores' && <SellersTab raffle={raffle} />}
      {allowed && tab === 'contactos' && <ContactsTab raffle={raffle} />}
      {allowed && tab === 'carga' && <BulkTab raffle={raffle} onChanged={reload} />}
      {allowed && tab === 'enlaces' && <LinksTab raffle={raffle} />}
      {allowed && tab === 'sorteo' && <DrawTab raffle={raffle} onChanged={reload} />}
      {allowed && tab === 'configuracion' && <SettingsTab raffle={raffle} onChanged={reload} />}
    </main>
  );
}

function Overview({ raffle, onChanged }: { raffle: AdminRaffle; onChanged: () => void }) {
  const r = raffle.resumen;
  const pct = r.metaMonto > 0 ? Math.min(100, Math.round((r.recaudado / r.metaMonto) * 100)) : 0;
  const publicUrl = `${window.location.origin}/r/${raffle.slug}`;
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);

  const missing = [
    !raffle.bancoNombre || !raffle.bancoNumeroCuenta || !raffle.bancoTitular ? 'Completa los datos bancarios' : null,
    raffle.premios.length === 0 ? 'Agrega al menos un premio' : null,
    new Date(raffle.fechaSorteo).getTime() <= Date.now() ? 'La fecha del sorteo ya pasó' : null,
  ].filter(Boolean) as string[];

  async function changeState(estado: RaffleState, ok: string) {
    setBusy(true);
    setMsg(null);
    try {
      await adminApi.updateRaffle(raffle.id, { estado });
      setMsg({ kind: 'ok', text: ok });
      onChanged();
    } catch (err) {
      setMsg({ kind: 'error', text: err instanceof ApiError ? describeError(err) : 'No se pudo cambiar el estado.' });
    } finally {
      setBusy(false);
    }
  }

  const me = raffle.vendedor;

  return (
    <div className="stack gap16">
      {me && (
        <section className="card" aria-labelledby="mine-title">
          <h2 id="mine-title">Tus ventas</h2>
          <p className="muted small">
            Comparte tu enlace: lo que se reserve con él queda a tu nombre
            {me.asignados > 0 ? ' y los compradores también pueden elegir los números de tu talonario.' : '.'}
          </p>
          <CopyLink url={sellerUrl(raffle.slug, me.codigoEnlace)} label="Copiar mi enlace" disabled={raffle.estado === 'borrador'} />
          <div className="facts">
            <div className="fact"><b>{me.vendidos}</b><span>vendidos · {money(me.recaudado)}</span></div>
            <div className="fact"><b>{me.reservados}</b><span>reservados · {money(me.porCobrar)} por cobrar</span></div>
            <div className="fact"><b>{me.asignadosLibres}</b><span>libres de tu talonario{me.asignadosRangos ? ` (${me.asignadosRangos})` : ''}</span></div>
          </div>
        </section>
      )}

      <section className="card" aria-labelledby="progress-title">
        <h2 id="progress-title">Avance</h2>
        <div className="row between">
          <b style={{ fontSize: '1.4rem' }}>{money(r.recaudado)}</b>
          <span className="muted">{r.metaMonto > 0 ? `de ${money(r.metaMonto)} (${pct}%)` : 'sin meta definida'}</span>
        </div>
        {r.metaMonto > 0 && (
          <div className="progress" role="progressbar" aria-label="Avance hacia la meta" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct}>
            <span style={{ width: `${pct}%` }} />
          </div>
        )}
        <div className="facts">
          <div className="fact"><b>{r.pagados}</b><span>vendidos</span></div>
          <div className="fact"><b>{r.reservados}</b><span>reservados · {money(r.porCobrar)} por cobrar</span></div>
          <div className="fact"><b>{r.disponibles}</b><span>disponibles de {r.total}</span></div>
          <div className="fact"><b>{r.talonariosDisponibles}</b><span>talonarios completos libres</span></div>
        </div>
      </section>

      {!me && (
        <section className="card" aria-labelledby="share-title">
          <h2 id="share-title">Enlace público</h2>
          {raffle.estado === 'borrador' ? (
            <p className="muted small">La rifa es borrador: el enlace no funciona hasta que la actives.</p>
          ) : (
            <p className="muted small">Compártelo por WhatsApp: ahí los compradores eligen sus números y reservan.</p>
          )}
          <CopyLink url={publicUrl} disabled={raffle.estado === 'borrador'} />
        </section>
      )}

      {raffle.rol === 'organizador' && raffle.estado !== 'sorteada' && (
        <section className="card" aria-labelledby="state-title">
          <h2 id="state-title">Estado de la venta</h2>
          {raffle.estado === 'borrador' && (
            <>
              {missing.length > 0 ? (
                <ul className="checklist">{missing.map((m) => <li key={m}>{m}</li>)}</ul>
              ) : (
                <p className="muted small">Todo listo. Al activarla ya no podrás cambiar el precio ni los talonarios.</p>
              )}
              <button className="btn primary" disabled={busy} onClick={() => changeState('activa', 'La rifa está activa: ya puedes compartir el enlace.')}>
                Activar rifa
              </button>
            </>
          )}
          {raffle.estado === 'activa' && (
            <>
              <p className="muted small">Cerrar la venta impide nuevas reservas; las reservas pendientes se pueden seguir confirmando.</p>
              <button className="btn" disabled={busy} onClick={() => changeState('cerrada', 'Venta cerrada.')}>Cerrar venta</button>
            </>
          )}
          {raffle.estado === 'cerrada' && (
            <button className="btn primary" disabled={busy} onClick={() => changeState('activa', 'Venta reabierta.')}>Reabrir venta</button>
          )}
          {msg && <div className={`banner ${msg.kind}`} role={msg.kind === 'error' ? 'alert' : 'status'}>{msg.text}</div>}
        </section>
      )}
    </div>
  );
}

import { FormEvent, useState } from 'react';
import { ApiError } from '../lib/api';
import { adminApi, describeError, invitationUrl, toLocalInput, type AdminRaffle, type Prize } from '../lib/admin';
import { plural, shortDate } from '../lib/format';
import { CopyLink } from './CopyLink';
import { RaffleForm, toValues } from './RaffleForm';
import { useAdminLoad, useSession } from './session';

const errText = (err: unknown, fallback: string) => (err instanceof ApiError ? describeError(err) : fallback);

export function SettingsTab({ raffle, onChanged }: { raffle: AdminRaffle; onChanged: () => void }) {
  return (
    <div className="stack gap16">
      <RaffleForm
        initial={toValues(raffle)}
        structureLocked={raffle.estado !== 'borrador'}
        submitLabel="Guardar cambios"
        onSubmit={async (input) => {
          // Solo se envía lo que cambió (el precio y los talonarios se rechazan fuera de borrador)
          const diff = Object.fromEntries(
            Object.entries(input).filter(([k, v]) =>
              // la fecha se edita a minutos: comparar con la misma precisión
              k === 'fechaSorteo' ? toLocalInput(v as string) !== toLocalInput(raffle.fechaSorteo) : v !== (raffle as any)[k],
            ),
          );
          if (Object.keys(diff).length) await adminApi.updateRaffle(raffle.id, diff);
          onChanged();
        }}
      />
      <Prizes raffle={raffle} onChanged={onChanged} />
      <Team raffle={raffle} />
    </div>
  );
}

// ---------- Premios ----------
function Prizes({ raffle, onChanged }: { raffle: AdminRaffle; onChanged: () => void }) {
  const prizes = [...raffle.premios].sort((a, b) => a.orden - b.orden);
  const [editing, setEditing] = useState<number | 'new' | null>(null);
  const nextOrder = (prizes.at(-1)?.orden ?? 0) + 1;

  return (
    <section className="card" aria-labelledby="prizes-title">
      <div className="row between">
        <h2 id="prizes-title">Premios</h2>
        {editing === null && <button className="btn small" onClick={() => setEditing('new')}>Agregar premio</button>}
      </div>
      {prizes.length === 0 && editing !== 'new' && <p className="muted small">Aún no hay premios.</p>}
      <ul className="list">
        {prizes.map((p) =>
          editing === p.id ? (
            <li key={p.id}>
              <PrizeForm raffleId={raffle.id} prize={p} onDone={() => { setEditing(null); onChanged(); }} onCancel={() => setEditing(null)} />
            </li>
          ) : (
            <li key={p.id} className="prize-row">
              <span className="rank">{p.orden}°</span>
              <div>
                <b>{p.nombre}</b>
                {p.descripcion && <p className="muted small">{p.descripcion}</p>}
              </div>
              <PrizeActions raffleId={raffle.id} prize={p} disabled={editing !== null} onEdit={() => setEditing(p.id)} onDeleted={onChanged} />
            </li>
          ),
        )}
      </ul>
      {editing === 'new' && (
        <PrizeForm raffleId={raffle.id} initialOrder={nextOrder} onDone={() => { setEditing(null); onChanged(); }} onCancel={() => setEditing(null)} />
      )}
    </section>
  );
}

function PrizeActions({ raffleId, prize, disabled, onEdit, onDeleted }: { raffleId: number; prize: Prize; disabled: boolean; onEdit: () => void; onDeleted: () => void }) {
  const [confirm, setConfirm] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const remove = async () => {
    try {
      await adminApi.deletePrize(raffleId, prize.id);
      onDeleted();
    } catch (err) {
      setError(errText(err, 'No se pudo eliminar'));
    }
  };
  return (
    <div className="row">
      {confirm ? (
        <>
          <button className="btn small danger" onClick={remove}>Sí, eliminar</button>
          <button className="btn small" onClick={() => setConfirm(false)}>No</button>
        </>
      ) : (
        <>
          <button className="btn small" disabled={disabled} onClick={onEdit} aria-label={`Editar ${prize.nombre}`}>Editar</button>
          <button className="btn small danger" disabled={disabled} onClick={() => setConfirm(true)} aria-label={`Eliminar ${prize.nombre}`}>Eliminar</button>
        </>
      )}
      {error && <span className="err small" role="alert">{error}</span>}
    </div>
  );
}

function PrizeForm({ raffleId, prize, initialOrder = 1, onDone, onCancel }: { raffleId: number; prize?: Prize; initialOrder?: number; onDone: () => void; onCancel: () => void }) {
  const [orden, setOrden] = useState(String(prize?.orden ?? initialOrder));
  const [nombre, setNombre] = useState(prize?.nombre ?? '');
  const [descripcion, setDescripcion] = useState(prize?.descripcion ?? '');
  const [imagenUrl, setImagenUrl] = useState(prize?.imagenUrl ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    const n = Number(orden);
    if (!Number.isInteger(n) || n < 1 || n > 100) return setError('El lugar va del 1 al 100');
    if (!nombre.trim()) return setError('Escribe el nombre del premio');
    setBusy(true);
    setError(null);
    const body = { orden: n, nombre: nombre.trim(), descripcion: descripcion.trim(), imagenUrl: imagenUrl.trim() || null };
    try {
      if (prize) await adminApi.updatePrize(raffleId, prize.id, body);
      else await adminApi.addPrize(raffleId, body);
      onDone();
    } catch (err) {
      setError(errText(err, 'No se pudo guardar el premio'));
      setBusy(false);
    }
  }

  const id = prize ? `p${prize.id}` : 'pnew';
  return (
    <form className="subform" onSubmit={submit} noValidate aria-label={prize ? `Editar ${prize.nombre}` : 'Nuevo premio'}>
      <div className="grid2">
        <div className="field">
          <label htmlFor={`${id}-orden`}>Lugar</label>
          <input id={`${id}-orden`} type="number" min={1} max={100} value={orden} onChange={(e) => setOrden(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor={`${id}-nombre`}>Premio</label>
          <input id={`${id}-nombre`} maxLength={120} value={nombre} onChange={(e) => setNombre(e.target.value)} />
        </div>
      </div>
      <div className="field">
        <label htmlFor={`${id}-desc`}>Descripción (opcional)</label>
        <input id={`${id}-desc`} maxLength={500} value={descripcion} onChange={(e) => setDescripcion(e.target.value)} />
      </div>
      <div className="field">
        <label htmlFor={`${id}-img`}>URL de imagen (opcional)</label>
        <input id={`${id}-img`} type="url" maxLength={500} placeholder="https://…" value={imagenUrl} onChange={(e) => setImagenUrl(e.target.value)} />
      </div>
      {error && <div className="banner error" role="alert">{error}</div>}
      <div className="row" style={{ justifyContent: 'flex-end' }}>
        <button type="button" className="btn small" onClick={onCancel} disabled={busy}>Cancelar</button>
        <button type="submit" className="btn small primary" disabled={busy}>{prize ? 'Guardar premio' : 'Agregar'}</button>
      </div>
    </form>
  );
}

// ---------- Equipo ----------
function Team({ raffle }: { raffle: AdminRaffle }) {
  const { user } = useSession();
  const { data: members, reload } = useAdminLoad(() => adminApi.members(raffle.id), 120_000);
  const [email, setEmail] = useState('');
  const [rol, setRol] = useState<'editor' | 'vendedor'>('editor');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);

  async function add(e: FormEvent) {
    e.preventDefault();
    if (!/^\S+@\S+\.\S+$/.test(email.trim())) return setMsg({ kind: 'error', text: 'Escribe un correo válido' });
    setBusy(true);
    setMsg(null);
    try {
      const m = await adminApi.addMember(raffle.id, email.trim(), rol);
      setEmail('');
      setMsg({ kind: 'ok', text: `${m.nombre} ahora es ${ROLE_LABEL[rol].toLowerCase()} de la rifa.` });
      await reload();
    } catch (err) {
      setMsg({ kind: 'error', text: errText(err, 'No se pudo agregar') });
    } finally {
      setBusy(false);
    }
  }

  async function remove(userId: number) {
    setMsg(null);
    try {
      await adminApi.removeMember(raffle.id, userId);
      await reload();
    } catch (err) {
      setMsg({ kind: 'error', text: errText(err, 'No se pudo quitar') });
    }
  }

  return (
    <section className="card" aria-labelledby="team-title">
      <h2 id="team-title">Equipo</h2>
      <p className="muted small">
        <b>Editores</b>: ven las órdenes y los números, confirman pagos, registran ventas y gestionan vendedores; no cambian la
        configuración. <b>Vendedores</b>: tienen su propio enlace de venta y solo ven y operan sus ventas.
      </p>
      <ul className="list">
        {(members ?? []).map((m) => (
          <li key={m.userId} className="row between member">
            <div>
              <b>{m.nombre}</b> <span className="muted small">{m.email}{m.userId === user.id ? ' (tú)' : ''}</span>
            </div>
            <div className="row">
              <span className={`chip ${m.rol === 'organizador' ? '' : 'neutral'}`}>{ROLE_LABEL[m.rol]}</span>
              {m.rol !== 'organizador' && (
                <button className="btn small danger" onClick={() => remove(m.userId)} aria-label={`Quitar a ${m.nombre}`}>Quitar</button>
              )}
            </div>
          </li>
        ))}
      </ul>
      <form className="row end" onSubmit={add} noValidate>
        <div className="field grow">
          <label htmlFor="member-email">Agregar por correo</label>
          <input id="member-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="correo@ejemplo.cl" />
        </div>
        <div className="field">
          <label htmlFor="member-rol">Rol</label>
          <select id="member-rol" value={rol} onChange={(e) => setRol(e.target.value as 'editor' | 'vendedor')}>
            <option value="editor">Editor</option>
            <option value="vendedor">Vendedor</option>
          </select>
        </div>
        <button type="submit" className="btn" disabled={busy}>Agregar</button>
      </form>
      <p className="muted small">Si la persona aún no tiene cuenta, envíale una invitación por link.</p>
      {msg && <div className={`banner ${msg.kind}`} role={msg.kind === 'error' ? 'alert' : 'status'}>{msg.text}</div>}
      <Invitations raffle={raffle} onAccepted={reload} />
    </section>
  );
}

const ROLE_LABEL = { organizador: 'Organizador', editor: 'Editor', vendedor: 'Vendedor' } as const;
const INV_STATE = { vigente: 'Sin usar', usada: 'Aceptada', vencida: 'Vencida', revocada: 'Anulada' } as const;

function Invitations({ raffle, onAccepted }: { raffle: AdminRaffle; onAccepted: () => Promise<void> }) {
  const { data: invitations, reload } = useAdminLoad(() => adminApi.invitations(raffle.id), 60_000);
  const [rol, setRol] = useState<'editor' | 'vendedor'>('vendedor');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pending = (invitations ?? []).filter((i) => i.estado === 'vigente');
  const accepted = (invitations ?? []).filter((i) => i.estado === 'usada').length;

  async function create() {
    setBusy(true);
    setError(null);
    try {
      await adminApi.createInvitation(raffle.id, rol);
      await reload();
      await onAccepted();
    } catch (err) {
      setError(errText(err, 'No se pudo crear la invitación'));
    } finally {
      setBusy(false);
    }
  }

  async function revoke(id: number) {
    try {
      await adminApi.revokeInvitation(id);
      await reload();
    } catch (err) {
      setError(errText(err, 'No se pudo anular'));
    }
  }

  return (
    <div className="stack subform" aria-labelledby="inv-title">
      <h3 id="inv-title">Invitaciones por link</h3>
      <p className="muted small">
        Cada link sirve para una persona y vence en 7 días. Al abrirlo crea su cuenta (o entra con la suya) y queda en el equipo.
        {accepted > 0 && ` ${plural(accepted, 'invitación aceptada', 'invitaciones aceptadas')}.`}
      </p>
      <div className="row end">
        <div className="field">
          <label htmlFor="inv-rol">Invitar como</label>
          <select id="inv-rol" value={rol} onChange={(e) => setRol(e.target.value as 'editor' | 'vendedor')}>
            <option value="vendedor">Vendedor</option>
            <option value="editor">Editor</option>
          </select>
        </div>
        <button type="button" className="btn" disabled={busy} onClick={create}>Crear invitación</button>
      </div>
      {error && <div className="banner error" role="alert">{error}</div>}
      {pending.length > 0 && (
        <ul className="list">
          {pending.map((i) => (
            <li key={i.id} className="stack">
              <div className="row between">
                <span className="small">
                  <b>{ROLE_LABEL[i.rol]}</b> · {INV_STATE[i.estado]} · vence el {shortDate(i.venceEn)}
                </span>
                <button className="btn small danger" onClick={() => revoke(i.id)} aria-label={`Anular invitación de ${ROLE_LABEL[i.rol].toLowerCase()}`}>Anular</button>
              </div>
              <CopyLink url={invitationUrl(i.token)} label="Copiar invitación" disabled />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

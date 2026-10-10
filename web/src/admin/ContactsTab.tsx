import { FormEvent, useMemo, useState } from 'react';
import { ApiError } from '../lib/api';
import { adminApi, describeError, type AdminRaffle, type Contact, type ContactInput } from '../lib/admin';
import { money, plural } from '../lib/format';
import { Phone } from './Phone';
import { useAdminLoad } from './session';

const errText = (err: unknown, fallback: string) => (err instanceof ApiError ? describeError(err) : fallback);

/** Valida los datos de un contacto; devuelve el error o null */
function validate(v: ContactInput): string | null {
  if (v.nombre.trim().length < 2) return 'Escribe el nombre';
  if (v.telefono.trim().length < 6) return 'El teléfono debe tener al menos 6 caracteres';
  return null;
}

/**
 * Personas de contacto de la rifa: a quién llamar por una venta cuando el comprador no dejó teléfono.
 * Si una persona vendió números (marcado en la venta), aquí aparece su rendición.
 */
export function ContactsTab({ raffle }: { raffle: AdminRaffle }) {
  const { data: contacts, error, loading, reload } = useAdminLoad(() => adminApi.contacts(raffle.id), 60_000);
  const [query, setQuery] = useState('');
  const [adding, setAdding] = useState(false);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    const d = q.replace(/\D/g, '');
    return (contacts ?? []).filter(
      (c) => !q || c.nombre.toLowerCase().includes(q) || c.nota.toLowerCase().includes(q) || (d.length >= 3 && c.telefono.replace(/\D/g, '').includes(d)),
    );
  }, [contacts, query]);
  const sold = (contacts ?? []).filter((c) => c.vendidos + c.reservados > 0);

  if (loading) return <p role="status">Cargando contactos…</p>;
  if (!contacts) return <div className="banner error" role="alert">{error?.message ?? 'No se pudieron cargar los contactos.'}</div>;

  return (
    <div className="stack gap16">
      <p className="muted small">
        Personas a quién llamar por una venta cuando el comprador no dejó teléfono (por ejemplo, la hija que compró para su mamá).
        Al registrar la venta puedes marcar que esa persona vendió el número: entonces aparece aquí lo que vendió y lo que debe rendir.
      </p>

      {sold.length > 0 && (
        <section className="card" aria-labelledby="contacts-sold-title">
          <h2 id="contacts-sold-title">Lo que vendieron</h2>
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr><th>Persona</th><th>Vendidos</th><th>Recaudado</th><th>Reservados</th><th>Por cobrar</th></tr>
              </thead>
              <tbody>
                {sold.map((c) => (
                  <tr key={c.id}>
                    <td>{c.nombre}</td>
                    <td>{c.vendidos}</td>
                    <td>{money(c.recaudado)}</td>
                    <td>{c.reservados}</td>
                    <td>{money(c.porCobrar)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      <div className="row between">
        <div className="field grow">
          <label htmlFor="contacts-q" className="sr-only">Buscar contacto</label>
          <input id="contacts-q" type="search" placeholder="Buscar por nombre, teléfono o nota" value={query} onChange={(e) => setQuery(e.target.value)} />
        </div>
        {!adding && <button className="btn primary" onClick={() => setAdding(true)}>Agregar contacto</button>}
      </div>

      {adding && (
        <ContactForm
          title="Nuevo contacto"
          submitLabel="Agregar"
          onCancel={() => setAdding(false)}
          onSubmit={async (v) => {
            await adminApi.createContact(raffle.id, v);
            setAdding(false);
            await reload();
          }}
        />
      )}

      {contacts.length === 0 && !adding && (
        <section className="card center">
          <h2>Aún no hay contactos</h2>
          <p className="muted">Agrégalos aquí o directamente al registrar una venta.</p>
        </section>
      )}
      {contacts.length > 0 && visible.length === 0 && <p className="muted center">Ningún contacto coincide con la búsqueda.</p>}

      <ul className="list">
        {visible.map((c) => (
          <li key={c.id}>
            <ContactCard raffleId={raffle.id} contact={c} onChanged={reload} />
          </li>
        ))}
      </ul>
    </div>
  );
}

function ContactCard({ raffleId, contact: c, onChanged }: { raffleId: number; contact: Contact; onChanged: () => Promise<void> }) {
  const [editing, setEditing] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (editing) {
    return (
      <ContactForm
        title={`Editar a ${c.nombre}`}
        submitLabel="Guardar"
        initial={{ nombre: c.nombre, telefono: c.telefono, nota: c.nota }}
        onCancel={() => setEditing(false)}
        onSubmit={async (v) => {
          await adminApi.updateContact(raffleId, c.id, v);
          setEditing(false);
          await onChanged();
        }}
      />
    );
  }

  async function remove() {
    setError(null);
    try {
      await adminApi.deleteContact(raffleId, c.id);
      await onChanged();
    } catch (err) {
      setError(errText(err, 'No se pudo eliminar'));
      setConfirmDelete(false);
    }
  }

  return (
    <article className="card" aria-labelledby={`c-${c.id}`}>
      <div className="row between">
        <h3 id={`c-${c.id}`}>{c.nombre}</h3>
        <span className="chip neutral">{plural(c.ordenes, 'orden', 'órdenes')}</span>
      </div>
      <p className="small">
        <Phone value={c.telefono} />
        {c.nota && <span className="muted"> · {c.nota}</span>}
      </p>
      {c.vendidos + c.reservados > 0 && (
        <p className="small">
          Vendió {plural(c.vendidos, 'número', 'números')} ({money(c.recaudado)})
          {c.reservados > 0 && `; ${plural(c.reservados, 'reservado', 'reservados')} por cobrar (${money(c.porCobrar)})`}
        </p>
      )}
      <div className="row">
        {confirmDelete ? (
          <span className="row confirm" role="group" aria-label="Confirmar eliminación">
            <span className="small">¿Eliminar a {c.nombre}?</span>
            <button className="btn small danger" onClick={remove}>Sí, eliminar</button>
            <button className="btn small" onClick={() => setConfirmDelete(false)}>No</button>
          </span>
        ) : (
          <>
            <button className="btn small" onClick={() => setEditing(true)} aria-label={`Editar a ${c.nombre}`}>Editar</button>
            <button className="btn small danger" onClick={() => setConfirmDelete(true)} aria-label={`Eliminar a ${c.nombre}`}>Eliminar</button>
          </>
        )}
      </div>
      {error && <div className="banner error" role="alert">{error}</div>}
    </article>
  );
}

function ContactForm({
  title,
  submitLabel,
  initial = { nombre: '', telefono: '', nota: '' },
  onSubmit,
  onCancel,
}: {
  title: string;
  submitLabel: string;
  initial?: ContactInput;
  onSubmit: (v: ContactInput) => Promise<void>;
  onCancel: () => void;
}) {
  const [v, setV] = useState<ContactInput>(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    const err = validate(v);
    if (err) return setError(err);
    setBusy(true);
    setError(null);
    try {
      await onSubmit({ nombre: v.nombre.trim(), telefono: v.telefono.trim(), nota: v.nota.trim() });
    } catch (e2) {
      setError(errText(e2, 'No se pudo guardar'));
      setBusy(false);
    }
  }

  return (
    <form className="card" onSubmit={submit} noValidate aria-label={title}>
      <h3>{title}</h3>
      <div className="grid2">
        <div className="field">
          <label htmlFor="ct-nombre">Nombre</label>
          <input id="ct-nombre" maxLength={120} value={v.nombre} onChange={(e) => setV({ ...v, nombre: e.target.value })} autoFocus />
        </div>
        <div className="field">
          <label htmlFor="ct-tel">Teléfono</label>
          <input id="ct-tel" type="tel" maxLength={40} value={v.telefono} onChange={(e) => setV({ ...v, telefono: e.target.value })} />
        </div>
      </div>
      <div className="field">
        <label htmlFor="ct-nota">Nota (opcional)</label>
        <input id="ct-nota" maxLength={200} placeholder="Ej: hija de doña Marta, apoderada 4°B" value={v.nota} onChange={(e) => setV({ ...v, nota: e.target.value })} />
      </div>
      {error && <div className="banner error" role="alert">{error}</div>}
      <div className="row" style={{ justifyContent: 'flex-end' }}>
        <button type="button" className="btn small" onClick={onCancel} disabled={busy}>Cancelar</button>
        <button type="submit" className="btn small primary" disabled={busy}>{busy ? 'Guardando…' : submitLabel}</button>
      </div>
    </form>
  );
}

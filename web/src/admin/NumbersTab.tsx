import { useMemo, useState } from 'react';
import type { AdminRaffle, AdminTicket, TicketState } from '../lib/admin';
import { adminApi } from '../lib/admin';
import { shortDate } from '../lib/format';
import { CHANNEL } from './labels';
import { useAdminLoad } from './session';

const STATES: { key: TicketState | 'todos'; label: string }[] = [
  { key: 'todos', label: 'Todos' },
  { key: 'disponible', label: 'Disponibles' },
  { key: 'reservado', label: 'Reservados' },
  { key: 'pagado', label: 'Vendidos' },
];
const STATE_LABEL: Record<TicketState, string> = { disponible: 'disponible', reservado: 'reservado', pagado: 'vendido' };

/** CSV para Excel (separador ;, BOM para que respete tildes) */
export function ticketsCsv(rows: AdminTicket[]): string {
  const esc = (v: unknown) => {
    const s = v === null || v === undefined ? '' : String(v);
    return /[";\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const head = ['Número', 'Talonario', 'Estado', 'Orden', 'Comprador', 'Contacto', 'Fecha', 'Canal', 'Vendedor asignado'];
  const lines = rows.map((t) =>
    [
      t.numero,
      t.talonario,
      STATE_LABEL[t.estado],
      t.ordenId,
      t.compradorNombre,
      t.compradorContacto,
      t.fecha ? new Date(t.fecha).toLocaleString('es-CL') : '',
      t.canal ? CHANNEL[t.canal] : '',
      t.vendedorNombre,
    ]
      .map(esc)
      .join(';'),
  );
  return '﻿' + [head.join(';'), ...lines].join('\r\n');
}

export function NumbersTab({ raffle }: { raffle: AdminRaffle }) {
  const { data: tickets, error, loading } = useAdminLoad(() => adminApi.tickets(raffle.id));
  const [state, setState] = useState<TicketState | 'todos'>('todos');
  const [selected, setSelected] = useState<number | null>(null);

  const booklets = useMemo(() => {
    const map = new Map<number, AdminTicket[]>();
    for (const t of tickets ?? []) {
      if (state !== 'todos' && t.estado !== state) continue;
      if (!map.has(t.talonario)) map.set(t.talonario, []);
      map.get(t.talonario)!.push(t);
    }
    return [...map.entries()];
  }, [tickets, state]);
  const counts = useMemo(() => {
    const c: Record<string, number> = { todos: tickets?.length ?? 0, disponible: 0, reservado: 0, pagado: 0 };
    for (const t of tickets ?? []) c[t.estado]++;
    return c;
  }, [tickets]);
  const detail = tickets?.find((t) => t.numero === selected) ?? null;

  function download() {
    if (!tickets) return;
    const url = URL.createObjectURL(new Blob([ticketsCsv(tickets)], { type: 'text/csv;charset=utf-8' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `${raffle.slug}-numeros.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  if (loading) return <p role="status">Cargando números…</p>;
  if (!tickets) return <div className="banner error" role="alert">{error?.message ?? 'No se pudieron cargar los números.'}</div>;

  return (
    <div className="stack gap16">
      <div className="row between">
        <div className="filters" role="group" aria-label="Filtrar números">
          {STATES.map((s) => (
            <button key={s.key} type="button" className={`btn small ${state === s.key ? 'active' : ''}`} aria-pressed={state === s.key} onClick={() => setState(s.key)}>
              {s.label} <span className="count">{counts[s.key]}</span>
            </button>
          ))}
        </div>
        <button type="button" className="btn small" onClick={download}>Descargar CSV</button>
      </div>

      {detail && (
        <section className="card detail" aria-live="polite" aria-labelledby="detail-title">
          <div className="row between">
            <h2 id="detail-title">Número {detail.numero}</h2>
            <button type="button" className="btn small" onClick={() => setSelected(null)}>Cerrar</button>
          </div>
          <p className="small">
            Talonario {detail.talonario} · {STATE_LABEL[detail.estado]}
            {detail.vendedorNombre && ` · en el talonario de ${detail.vendedorNombre}`}
          </p>
          {detail.ordenId ? (
            <p className="small">
              <b>{detail.compradorNombre}</b> · {detail.compradorContacto}
              <br />
              <span className="muted">Orden #{detail.ordenId} · {detail.canal ? CHANNEL[detail.canal] : ''} · {detail.fecha ? shortDate(detail.fecha) : ''}</span>
            </p>
          ) : (
            <p className="muted small">Sin comprador.</p>
          )}
        </section>
      )}

      <div className="legend" aria-hidden="true">
        <span><i /> Disponible</span>
        <span><i className="r" /> Reservado</span>
        <span><i className="p" /> Vendido</span>
      </div>

      {booklets.length === 0 && <p className="muted center">No hay números con ese estado.</p>}
      {booklets.map(([k, list]) => (
        <section key={k} className="card booklet" aria-label={`Talonario ${k}`}>
          <header>
            <h3>Talonario {k}</h3>
          </header>
          <div className="numbers inspect">
            {list.map((t) => (
              <button
                key={t.numero}
                type="button"
                className={`num ${t.estado === 'disponible' ? '' : t.estado} ${selected === t.numero ? 'focus' : ''}`}
                aria-label={`Número ${t.numero}, ${STATE_LABEL[t.estado]}${t.compradorNombre ? `, ${t.compradorNombre}` : ''}`}
                aria-pressed={selected === t.numero}
                onClick={() => setSelected(t.numero)}
              >
                {t.numero}
              </button>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

import { Link } from 'react-router-dom';
import { adminApi } from '../lib/admin';
import { longDate } from '../lib/format';
import { RAFFLE_STATE } from './labels';
import { InstallCard } from './InstallCard';
import { useAdminLoad } from './session';

export function RafflesPage() {
  const { data: raffles, error, loading, reload } = useAdminLoad(() => adminApi.raffles(), 60_000);

  return (
    <main className="page wide">
      <div className="row between">
        <h1>Mis rifas</h1>
        <Link className="btn primary" to="/admin/rifas/nueva">Nueva rifa</Link>
      </div>

      <InstallCard />

      {loading && <p role="status">Cargando…</p>}
      {!loading && !raffles && (
        <div className="banner error" role="alert">
          {error?.message ?? 'No se pudieron cargar las rifas.'}{' '}
          <button className="btn small" onClick={reload}>Reintentar</button>
        </div>
      )}
      {raffles && raffles.length === 0 && (
        <section className="card center">
          <h2>Aún no tienes rifas</h2>
          <p className="muted">Crea la primera: define los talonarios, el precio y la fecha del sorteo.</p>
        </section>
      )}
      {raffles && raffles.length > 0 && (
        <ul className="list">
          {raffles.map((r) => {
            const st = RAFFLE_STATE[r.estado];
            return (
              <li key={r.id}>
                <Link className="card item" to={`/admin/rifas/${r.id}`}>
                  <div className="row between">
                    <h2>{r.nombre}</h2>
                    <span className={`chip ${st.cls}`}>{st.label}</span>
                  </div>
                  <p className="muted small">
                    Sorteo: {longDate(r.fechaSorteo)} · {r.rol === 'organizador' ? 'Organizador' : 'Editor'}
                  </p>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </main>
  );
}

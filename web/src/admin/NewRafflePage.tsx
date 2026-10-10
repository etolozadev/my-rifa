import { Link, useNavigate } from 'react-router-dom';
import { adminApi } from '../lib/admin';
import { EMPTY_RAFFLE, RaffleForm } from './RaffleForm';

export function NewRafflePage() {
  const navigate = useNavigate();
  return (
    <main className="page wide">
      <Link to="/admin" className="small">← Mis rifas</Link>
      <h1>Nueva rifa</h1>
      <p className="muted">Se crea como borrador: nadie la ve hasta que la actives.</p>
      <RaffleForm
        initial={EMPTY_RAFFLE}
        submitLabel="Crear rifa"
        onSubmit={async (input) => {
          const r = await adminApi.createRaffle(input);
          navigate(`/admin/rifas/${r.id}`);
        }}
      />
    </main>
  );
}

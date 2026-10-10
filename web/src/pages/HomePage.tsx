import { Link } from 'react-router-dom';

export function HomePage() {
  return (
    <main className="center">
      <h1>Rifas</h1>
      <p className="muted">Abre el enlace de la rifa que te compartieron para elegir tus números.</p>
      <Link to="/admin" className="small muted">Soy organizador</Link>
    </main>
  );
}

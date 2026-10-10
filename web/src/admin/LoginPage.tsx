import { FormEvent, useState } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { ApiError } from '../lib/api';
import { adminApi, type User } from '../lib/admin';

export function LoginPage({ user, onLogin }: { user: User | null; onLogin: (u: User) => void }) {
  const location = useLocation();
  const from = (location.state as { from?: string } | null)?.from ?? '/admin';
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (user) return <Navigate to={from} replace />;

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!email.trim() || !password) {
      setError('Escribe tu correo y tu contraseña');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      onLogin(await adminApi.login(email.trim(), password));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'No se pudo iniciar sesión');
      setBusy(false);
    }
  }

  return (
    <main className="page narrow">
      <form className="card" onSubmit={submit} noValidate>
        <h1>Panel de rifas</h1>
        <p className="muted small">Ingresa con la cuenta del organizador o del equipo.</p>
        <div className="field">
          <label htmlFor="email">Correo</label>
          <input id="email" type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} autoFocus />
        </div>
        <div className="field">
          <label htmlFor="password">Contraseña</label>
          <input id="password" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
        </div>
        {error && <div className="banner error" role="alert">{error}</div>}
        <button type="submit" className="btn primary" disabled={busy}>{busy ? 'Ingresando…' : 'Ingresar'}</button>
      </form>
    </main>
  );
}

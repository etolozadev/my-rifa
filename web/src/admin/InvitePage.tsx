import { FormEvent, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ApiError, api } from '../lib/api';
import { describeError } from '../lib/admin';
import { useLoad } from '../lib/useLoad';
import { NotFoundPage } from '../pages/NotFoundPage';

const ROLE = {
  editor: 'Como editor podrás ver las órdenes, confirmar pagos y registrar ventas.',
  vendedor: 'Como vendedor tendrás tu propio enlace de venta y verás tus ventas.',
} as const;

/** Aceptar una invitación al equipo: con sesión se acepta directo; sin sesión se crea la cuenta. */
export function InvitePage() {
  const { token = '' } = useParams();
  const navigate = useNavigate();
  const { data: inv, error, loading } = useLoad(() => api.getInvitation(token), 600_000);
  const [nombre, setNombre] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ text: string; login?: boolean } | null>(null);

  if (loading) return <div className="center" role="status">Cargando invitación…</div>;
  if (error?.status === 404 || !inv) {
    return <NotFoundPage title="Invitación no encontrada" text="Revisa que el enlace esté completo o pide uno nuevo." />;
  }

  const here = `/invitacion/${token}`;

  async function accept(account?: { nombre: string; email: string; password: string }) {
    setBusy(true);
    setMsg(null);
    try {
      const r = await api.acceptInvitation(token, account);
      navigate(`/admin/rifas/${r.raffleId}`);
    } catch (err) {
      const e = err instanceof ApiError ? err : null;
      setMsg({ text: e ? describeError(e) : 'No se pudo aceptar la invitación.', login: e?.code === 'account_exists' });
      setBusy(false);
    }
  }

  function submit(e: FormEvent) {
    e.preventDefault();
    if (nombre.trim().length < 2) return setMsg({ text: 'Escribe tu nombre' });
    if (!/^\S+@\S+\.\S+$/.test(email.trim())) return setMsg({ text: 'Escribe un correo válido' });
    if (password.length < 10) return setMsg({ text: 'La contraseña debe tener al menos 10 caracteres' });
    accept({ nombre: nombre.trim(), email: email.trim(), password });
  }

  return (
    <main className="page narrow">
      <section className="card">
        <h1>Te invitaron a {inv.rifa.nombre}</h1>
        {inv.estado !== 'vigente' ? (
          <p className="banner">{inv.estado === 'usada' ? 'Esta invitación ya se usó.' : `Esta invitación está ${inv.estado}. Pide una nueva al organizador.`}</p>
        ) : (
          <>
            <p className="muted">
              {inv.invitadoPor ? `${inv.invitadoPor} te invitó a su equipo. ` : ''}
              {ROLE[inv.rol]}
            </p>
            {inv.conSesion ? (
              <button className="btn primary" disabled={busy} onClick={() => accept()}>{busy ? 'Uniéndote…' : 'Aceptar invitación'}</button>
            ) : (
              <form className="stack" onSubmit={submit} noValidate>
                <h2>Crea tu cuenta</h2>
                <div className="field">
                  <label htmlFor="i-nombre">Tu nombre</label>
                  <input id="i-nombre" autoComplete="name" value={nombre} onChange={(e) => setNombre(e.target.value)} />
                </div>
                <div className="field">
                  <label htmlFor="i-email">Correo</label>
                  <input id="i-email" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} />
                </div>
                <div className="field">
                  <label htmlFor="i-pass">Contraseña</label>
                  <input id="i-pass" type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} />
                  <span className="hint">Mínimo 10 caracteres.</span>
                </div>
                <button type="submit" className="btn primary" disabled={busy}>{busy ? 'Creando cuenta…' : 'Crear cuenta y unirme'}</button>
                <p className="small">
                  ¿Ya tienes cuenta? <Link to="/admin/login" state={{ from: here }}>Inicia sesión</Link> y vuelve a este enlace.
                </p>
              </form>
            )}
          </>
        )}
        {msg && (
          <div className="banner error" role="alert">
            {msg.text}{' '}
            {msg.login && <Link to="/admin/login" state={{ from: here }}>Iniciar sesión</Link>}
          </div>
        )}
      </section>
    </main>
  );
}

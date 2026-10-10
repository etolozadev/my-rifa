import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { SignOutIcon, TicketIcon } from '../components/icons';
import { adminApi, type User } from '../lib/admin';
import { ApiError } from '../lib/api';
import { NotFoundPage } from '../pages/NotFoundPage';
import { LoginPage } from './LoginPage';
import { NewRafflePage } from './NewRafflePage';
import { RaffleAdminPage } from './RaffleAdminPage';
import { RafflesPage } from './RafflesPage';
import { SessionContext, useSession } from './session';

/** Panel del equipo (/admin/*). Verifica la sesión una vez y protege todas las rutas salvo el login. */
export function AdminApp() {
  // undefined = verificando la sesión; null = sin sesión
  const [user, setUser] = useState<User | null | undefined>(undefined);
  // Sin conexión no se sabe si hay sesión: se avisa y se reintenta, en vez de mandar a ingresar de nuevo
  const [offline, setOffline] = useState(false);

  const check = useCallback(() => {
    setOffline(false);
    adminApi.me().then(setUser, (err) => {
      if (err instanceof ApiError && err.code === 'network') setOffline(true);
      else setUser(null);
    });
  }, []);
  useEffect(check, [check]);
  useEffect(() => {
    if (!offline) return;
    window.addEventListener('online', check);
    return () => window.removeEventListener('online', check);
  }, [offline, check]);

  const logout = useCallback(async () => {
    try {
      await adminApi.logout();
    } finally {
      setUser(null);
    }
  }, []);
  const expired = useCallback(() => setUser(null), []);
  const session = useMemo(() => (user ? { user, logout, expired } : null), [user, logout, expired]);

  if (offline) {
    return (
      <div className="center" role="alert">
        <h1>Sin conexión</h1>
        <p className="muted">No se pudo conectar con el servidor. Revisa tu internet; el panel se abre solo apenas vuelva.</p>
        <button className="btn primary" onClick={check}>Reintentar</button>
      </div>
    );
  }
  if (user === undefined) return <div className="center" role="status">Cargando…</div>;

  return (
    <Routes>
      <Route path="login" element={<LoginPage user={user} onLogin={setUser} />} />
      <Route
        path="*"
        element={
          session ? (
            <SessionContext.Provider value={session}>
              <Shell />
            </SessionContext.Provider>
          ) : (
            <ToLogin />
          )
        }
      />
    </Routes>
  );
}

function ToLogin() {
  const location = useLocation();
  return <Navigate to="/admin/login" replace state={{ from: location.pathname + location.search }} />;
}

function Shell() {
  const { user, logout } = useSession();
  return (
    <>
      <header className="topbar">
        <div>
          <Link to="/admin" className="brand">
            <TicketIcon size={24} weight="duotone" aria-hidden="true" />
            mis-rifas
          </Link>
          <div className="row">
            <span className="muted small who">{user.nombre}</span>
            <button type="button" className="btn small" onClick={logout}>
              <SignOutIcon size={16} aria-hidden="true" />
              Salir
            </button>
          </div>
        </div>
      </header>
      <Routes>
        <Route index element={<RafflesPage />} />
        <Route path="rifas/nueva" element={<NewRafflePage />} />
        <Route path="rifas/:id" element={<RaffleAdminPage />} />
        <Route path="rifas/:id/:tab" element={<RaffleAdminPage />} />
        <Route path="*" element={<NotFoundPage title="Página no encontrada" text="" />} />
      </Routes>
    </>
  );
}

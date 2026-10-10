import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { adminApi, type User } from '../lib/admin';
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

  useEffect(() => {
    adminApi.me().then(setUser, () => setUser(null));
  }, []);

  const logout = useCallback(async () => {
    try {
      await adminApi.logout();
    } finally {
      setUser(null);
    }
  }, []);
  const expired = useCallback(() => setUser(null), []);
  const session = useMemo(() => (user ? { user, logout, expired } : null), [user, logout, expired]);

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
          <Link to="/admin" className="brand">mis-rifas · Panel</Link>
          <div className="row">
            <span className="muted small">{user.nombre}</span>
            <button type="button" className="btn small" onClick={logout}>Salir</button>
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

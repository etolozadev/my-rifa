import { lazy, Suspense } from 'react';
import { Route, Routes } from 'react-router-dom';
import { HomePage } from './pages/HomePage';
import { NotFoundPage } from './pages/NotFoundPage';
import { OrderPage } from './pages/OrderPage';
import { PrepaidPage } from './pages/PrepaidPage';
import { RafflePage } from './pages/RafflePage';

// El panel se descarga aparte: los compradores (desde el celular) no lo necesitan
const AdminApp = lazy(() => import('./admin/AdminApp').then((m) => ({ default: m.AdminApp })));
const InvitePage = lazy(() => import('./admin/InvitePage').then((m) => ({ default: m.InvitePage })));

const loading = <div className="center" role="status">Cargando…</div>;

export function App() {
  return (
    <Routes>
      <Route path="/" element={<HomePage />} />
      <Route path="/r/:slug" element={<RafflePage />} />
      <Route path="/orden/:token" element={<OrderPage />} />
      <Route path="/e/:token" element={<PrepaidPage />} />
      <Route path="/invitacion/:token" element={<Suspense fallback={loading}><InvitePage /></Suspense>} />
      <Route path="/admin/*" element={<Suspense fallback={loading}><AdminApp /></Suspense>} />
      <Route path="*" element={<NotFoundPage title="Página no encontrada" text="" />} />
    </Routes>
  );
}

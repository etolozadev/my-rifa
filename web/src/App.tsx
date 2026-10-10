import { Route, Routes } from 'react-router-dom';
import { HomePage } from './pages/HomePage';
import { NotFoundPage } from './pages/NotFoundPage';
import { OrderPage } from './pages/OrderPage';
import { RafflePage } from './pages/RafflePage';

export function App() {
  return (
    <Routes>
      <Route path="/" element={<HomePage />} />
      <Route path="/r/:slug" element={<RafflePage />} />
      <Route path="/orden/:token" element={<OrderPage />} />
      <Route path="*" element={<NotFoundPage title="Página no encontrada" text="" />} />
    </Routes>
  );
}

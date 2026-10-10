import React from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { App } from './App';
import { initInstall } from './lib/install';
// Plus Jakarta Sans alojada con la app (sin pedir fuentes a terceros); solo baja los subconjuntos que se usan
import '@fontsource-variable/plus-jakarta-sans';
import './styles.css';

initInstall();
// App instalable y con copia sin conexión (solo en producción: en desarrollo el caché estorbaría la recarga en vivo)
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => void navigator.serviceWorker.register('/sw.js').catch(() => {}));
}

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </React.StrictMode>,
);

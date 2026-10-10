/// <reference types="vitest" />
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// En desarrollo, /api se reenvía a la API (evita CORS y las cookies quedan en el mismo origen)
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    // En Docker con la carpeta montada desde Windows/macOS no llegan eventos del sistema de archivos
    watch: process.env.CHOKIDAR_USEPOLLING === 'true' ? { usePolling: true, interval: 300 } : undefined,
    proxy: { '/api': { target: process.env.API_URL ?? 'http://localhost:3000', changeOrigin: true } },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./tests/setup.ts'],
  },
});

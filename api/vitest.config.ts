import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    fileParallelism: false,
    testTimeout: 30000,
    hookTimeout: 30000,
    env: {
      NODE_ENV: 'test',
      DATABASE_URL: process.env.TEST_DATABASE_URL ?? 'postgres://rifas:rifas@localhost:5432/rifas_test',
      JWT_SECRET: 'secreto-de-pruebas-suficientemente-largo',
      UPLOADS_DIR: './storage/test-comprobantes',
      WEB_ORIGIN: 'http://localhost:5173',
      ALLOW_REGISTRATION: 'false',
    },
  },
});

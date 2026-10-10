# mis-rifas

Plataforma personal para organizar rifas (a beneficio, viajes de estudio, metas): talonarios y números, reserva pública con
vencimiento a 7 días, pago por transferencia con comprobante y confirmación por el organizador.

- `api/`: API Node.js + Express + Sequelize + PostgreSQL (fase 1 completa). Ver `api/README.md`.
- `web/`: front público en React (ver la rifa, reservar, seguir la orden). Ver `web/README.md`.

Siguiente paso: panel de administración (login, crear rifa, números y órdenes, confirmar pagos y ver comprobantes).

Arranque rápido en desarrollo, en dos terminales:

```bash
cd api && cp .env.example .env && npm install && npm run db:init && npm run user:create -- "Tu Nombre" tu@correo.cl "clave-larga" && npm run dev
cd web && npm install && npm run dev
```

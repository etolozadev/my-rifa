# mis-rifas · API (fase 1)

API en Node.js + Express + TypeScript + Sequelize + PostgreSQL para organizar rifas: talonarios y números,
reserva pública con vencimiento a 7 días, comprobantes de pago y confirmación por el equipo.
Sigue la especificación "Especificación: Plataforma de Rifas (mis-rifas)".

## Puesta en marcha

```bash
cp .env.example .env            # y edita DATABASE_URL y JWT_SECRET (openssl rand -hex 32)
npm install
npm run db:init                 # aplica db/schema.sql (idempotente)
npm run user:create -- "Tu Nombre" tu@correo.cl "una-contraseña-larga"
npm run dev                     # http://localhost:3000
```

Las cuentas se crean por script porque es una plataforma personal (`ALLOW_REGISTRATION=false`).

## Pruebas

```bash
createdb rifas_test             # una vez; usa TEST_DATABASE_URL si tu base es otra
npm test                        # 32 tests de integración contra PostgreSQL real
npm run typecheck
```

Incluyen la carrera de 10 reservas simultáneas del mismo número (solo una gana), la atomicidad de la
reserva, vencimiento y reactivación, roles y permisos, y validación de comprobantes.

## Modelo y decisiones

- **Números con numeración global** por rifa: el talonario *k* contiene `(k-1)·M+1 … k·M`.
- **Sin doble venta**: `UNIQUE (raffle_id, numero)` más un `UPDATE … WHERE estado='disponible'` dentro de una
  transacción; si las filas afectadas no coinciden con lo pedido se revierte todo y se responde 409 con los
  números que ya no están libres.
- **Precio**: `precio_numero × cantidad`; el talonario completo cuesta lo mismo que sus números por separado.
- **Vencimiento**: una tarea cada hora (node-cron) y una verificación al consultar la grilla. La orden vencida
  conserva su lista de números: si llega un pago tarde, confirmar la orden retoma los números si siguen libres
  (si no, 409 con el detalle).
- **Roles por rifa** (`raffle_members`), validados en el servidor en cada ruta. Fase 1: organizador y editor.
- **Comprobantes**: el tipo se detecta por la firma del archivo (JPG, PNG, WebP, PDF), máximo 5 MB y 5 por orden,
  nombre regenerado, guardados en `UPLOADS_DIR` (fuera de carpetas públicas) y entregados solo al dueño de la
  orden (por token) o al equipo autenticado.
- **Privacidad**: la vista pública no incluye datos de compradores; el token de la orden no se expone al equipo.
- **Sesión**: cookie `httpOnly` (+ `Secure` en producción, `SameSite=Lax`) con JWT de 7 días; las peticiones que
  cambian datos exigen la cabecera `X-Requested-With: mis-rifas`; CORS solo permite `WEB_ORIGIN`.
- **Auditoría**: `audit_log` registra creación, edición, confirmaciones, cancelaciones y extensiones.

## Endpoints

Públicos: `GET /api/rifas/:slug` · `POST /api/rifas/:slug/ordenes` · `GET /api/ordenes/:token` ·
`POST /api/ordenes/:token/comprobantes` (campo `archivo`) · `GET /api/ordenes/:token/comprobantes/:id`

Auth: `POST /api/auth/login` · `POST /api/auth/logout` · `GET /api/auth/me`

Equipo (`/api/admin`, con sesión): `GET|POST /rifas` · `GET|PATCH /rifas/:id` ·
`POST|PATCH|DELETE /rifas/:id/premios[/:premioId]` · `GET|POST /rifas/:id/miembros` ·
`DELETE /rifas/:id/miembros/:userId` · `GET /rifas/:id/numeros` · `GET /rifas/:id/ordenes` ·
`POST /rifas/:id/ordenes-manuales` · `POST /ordenes/:id/confirmar|cancelar|extender` · `GET /comprobantes/:id`

Errores: `{ "error": { "code", "message", "details" } }`.

## Qué falta (según las fases de la especificación)

- **Fase 2**: rol vendedor con enlace propio (la tabla `sellers` ya existe), carga rápida por rangos e
  importación CSV, enlaces para compradores que ya pagaron (`share_links`), invitaciones por link.
- **Fase 3**: sorteo (`draws` ya existe, con los índices que impiden repetir premio o ganador) y avisos.
- Captcha en la reserva pública (hoy hay límite de frecuencia por IP) y el front en React.

## Despliegue (VPS)

Nginx como proxy inverso con HTTPS hacia `PORT`, `NODE_ENV=production`, proceso con pm2 o systemd,
copia diaria de PostgreSQL (`pg_dump`) y de la carpeta de comprobantes.

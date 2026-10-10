# mis-rifas · API (fases 1, 2 y 3)

API en Node.js + Express + TypeScript + Sequelize + PostgreSQL para organizar rifas: talonarios y números,
reserva pública con vencimiento a 7 días, comprobantes de pago y confirmación por el equipo.
Sigue la especificación "Especificación: Plataforma de Rifas (mis-rifas)".

## Puesta en marcha

Lo más simple es Docker desde la raíz del repositorio (`docker compose up --build`, ver el README principal).
Sin Docker:

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
createdb rifas_test             # una vez; usa TEST_DATABASE_URL si tu base es otra (en Docker ya existe)
npm test                        # 60 tests de integración contra PostgreSQL real (fases 1, 2 y 3)
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

Fase 2, públicos: `GET /api/rifas/:slug?v=<codigo>` y `vendedor` en `POST /api/rifas/:slug/ordenes` ·
`GET /api/enlaces/:token` · `POST /api/enlaces/:token/usar` · `GET /api/invitaciones/:token` ·
`POST /api/invitaciones/:token/aceptar` (con `X-Requested-With`; sin sesión lleva `nombre`, `email`, `password`).

Fase 2, equipo (`/api/admin`): `GET /rifas/:id/vendedores` · `POST /rifas/:id/vendedores/:sellerId/asignar|liberar`
(`numeros` y/o `talonarios`) · `POST /rifas/:id/ventas-lote` · `GET|POST /rifas/:id/enlaces` · `POST /enlaces/:id/revocar` ·
`GET|POST /rifas/:id/invitaciones` · `POST /invitaciones/:id/revocar` · `POST /rifas/:id/miembros` acepta `rol: editor|vendedor`.

Errores: `{ "error": { "code", "message", "details" } }`.

## Fase 2: decisiones

- **Vendedores** (`raffle_members.rol = vendedor` + fila en `sellers` con `codigo_enlace`). Su enlace es
  `/r/<slug>?v=<codigo>`: lo que se reserva con él queda en `orders.seller_id`. Un código inválido o de un vendedor
  quitado no bloquea la compra, solo queda sin atribución. El vendedor ve la grilla completa pero solo los compradores,
  órdenes, comprobantes y enlaces de sus ventas, y solo opera (confirma, cancela, extiende) esas.
- **Talonarios físicos**: el equipo asigna números libres a un vendedor (`tickets.seller_id`). Esos números no se ofrecen
  en la web pública (se ven como reservados) salvo con el enlace de ese vendedor, para evitar vender el mismo número en
  papel y en la web. La web y los vendedores respetan las asignaciones dentro del mismo `UPDATE` condicional que impide la
  doble venta; el organizador y los editores pueden registrar cualquier número.
- **Quitar a un vendedor** lo desactiva (`sellers.activo = false`): su enlace deja de funcionar y sus números asignados sin
  vender vuelven a la venta general, pero sus ventas conservan la atribución. Volver a sumarlo reactiva el mismo enlace.
- **Carga rápida** (`ventas-lote`, hasta 300 filas): cada fila es una venta independiente; el resultado indica por fila
  si se creó o qué números estaban ocupados. El front acepta texto pegado o CSV con `números; nombre; contacto[; pagada]`.
- **Enlaces de pago previo** (`share_links`): para quien ya pagó N números por fuera. Elige exactamente N y la orden nace
  pagada (`canal = manual`, `orders.share_link_id`). Un solo uso: el enlace se bloquea con `FOR UPDATE` mientras se usa;
  se pueden anular y vencen (7 días por defecto).
- **Invitaciones** (`invitations`): de un solo uso, vencen en 7 días, solo las crea el organizador. Permiten crear cuenta
  aunque `ALLOW_REGISTRATION=false` (la invitación es la autorización). Si el correo ya tiene cuenta, se pide iniciar sesión.
- El esquema de la fase 2 se agrega al final de `db/schema.sql` con `ADD COLUMN IF NOT EXISTS` y `CREATE TABLE IF NOT
  EXISTS`, así se aplica sin pasos manuales sobre una base de la fase 1.

## Fase 3: sorteo y avisos

Endpoints: `GET /api/admin/rifas/:id/sorteos` (organizador y editores, con datos del ganador) ·
`POST /api/admin/rifas/:id/sorteos` (organizador: `premioId`, `modo: aleatorio|manual`, `numero` y `detalle` si es manual,
`confirmarPendientes`) · `POST /api/admin/sorteos/:id/anular` (organizador, `motivo`) ·
`GET /api/rifas/:slug/sorteos/:id/participantes` (público). La vista pública de la rifa incluye `sorteos` (sin datos del
ganador) y la de la orden incluye `premios` ganados.

- **Cuándo**: solo con la venta cerrada. Si hay reservas pendientes vigentes la API responde 409 `pending_orders` (con
  cuántas tienen comprobante) y se sortea solo si se confirma con `confirmarPendientes`: no participan.
- **Participantes**: los números pagados que no ganaron otro premio, ordenados. Se guarda la lista en el sorteo.
- **Al azar y verificable**: semilla de 32 bytes aleatorios (`crypto.randomBytes`); posición ganadora =
  `SHA-256(semilla)` leído como entero, módulo la cantidad de participantes. Semilla, lista y posición son públicas y la
  página de la rifa lo recalcula en el navegador ("Verificar en mi navegador").
- **Externo** (Lotería, tómbola en vivo): se registra el número y de dónde salió; debe ser un número pagado que no haya ganado.
- **Un premio, un ganador; un número, un premio**: índices únicos parciales sobre sorteos vigentes, y el sorteo bloquea la
  rifa (`FOR UPDATE`) para que dos clics simultáneos no sorteen dos veces (hay un test con 5 sorteos a la vez).
- **Anular** (ganador inubicable, error al anotar): solo el organizador y con motivo. El sorteo anulado se conserva y se
  publica con su motivo; el premio se puede volver a sortear y el número anulado vuelve a participar.
- **Al terminar**: con todos los premios sorteados la rifa pasa a `sorteada`. Desde el primer sorteo no se registran ni
  confirman ventas, no se extienden reservas, no se reabre la venta, no se cancela una orden ganadora ni se borra un premio sorteado.
- **Avisos por correo** al organizador y editores (opcional, `SMTP_URL`): comprobante nuevo y resultado de cada sorteo,
  con el enlace al panel. Se envían sin bloquear la respuesta; si fallan quedan en el log. Los compradores dejan teléfono,
  así que sus avisos son mensajes de WhatsApp ya redactados en el panel (recordatorio de pago, pago confirmado, ganador).

## Pendiente

- Captcha en la reserva pública (hoy hay límite de frecuencia por IP).

## Despliegue

En Coolify con `docker-compose.prod.yml`: ver [`deploy/README.md`](../deploy/README.md). La imagen de producción arranca
con `docker-entrypoint.sh` (ajusta permisos del volumen de comprobantes y corre como `node`) y aplica el esquema al iniciar.

Scripts de cuentas (en producción, desde la Terminal del contenedor `api`):
`node dist/scripts/create-user.js "Nombre" correo "clave"` y `node dist/scripts/set-password.js correo "nueva-clave"`
(en desarrollo: `npm run user:create` / `npm run user:password`).

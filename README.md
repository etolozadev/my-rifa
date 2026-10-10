# mis-rifas

Plataforma personal para organizar rifas (a beneficio, viajes de estudio, metas): talonarios y números, reserva pública con
vencimiento a 7 días, pago por transferencia con comprobante y confirmación por el organizador.

- `api/`: API Node.js + Express + Sequelize + PostgreSQL. Ver `api/README.md`.
- `web/`: front en React: página pública (ver la rifa, reservar, seguir la orden, enlaces de vendedor y de pago previo,
  resultados del sorteo verificables) y panel del equipo en `/admin`. Ver `web/README.md`.

Las tres fases de la especificación están implementadas:

1. **Venta**: talonarios y números sin doble venta, reserva con vencimiento, comprobantes, confirmación de pagos y panel.
2. **Equipo y canales**: vendedores con enlace propio y talonarios asignados, carga rápida e importación CSV, enlaces de
   pago previo para quien ya pagó, e invitaciones por link.
3. **Sorteo y avisos**: sorteo al azar verificable (o resultado externo, como la Lotería), números al agua antes de cada premio, anulaciones públicas con
   motivo, avisos por correo al equipo y mensajes de WhatsApp ya redactados para los compradores.

Pendiente fuera de las fases: captcha en la reserva pública (hoy hay límite de frecuencia por IP).

## Desarrollo con Docker

Solo necesitas Docker (Docker Desktop en Windows/macOS).

```bash
docker compose up --build        # web http://localhost:5173 · API http://localhost:3000 · Postgres localhost:5432
docker compose exec api npm run user:create -- "Tu Nombre" tu@correo.cl "clave-larga"
```

Luego entra a http://localhost:5173/admin con ese correo para crear tu primera rifa.

- El código de `api/` y `web/` se monta en los contenedores: la API se reinicia al guardar (tsx) y el front recarga con HMR.
- El esquema se aplica solo al arrancar la API (`db:init` es idempotente). La base `rifas_test` se crea junto al volumen.
- Postgres usa `rifas` / `rifas` y queda publicado en `localhost:5432` (para pgAdmin, DBeaver o correr la API fuera de Docker).
- Los avisos por correo no salen a internet: los captura Mailpit y se ven en http://localhost:8025.

| Tarea | Comando |
| --- | --- |
| Tests de la API (contra `rifas_test`) | `docker compose exec api npm test` |
| Tests del front | `docker compose exec web npm test` |
| Consola SQL | `docker compose exec db psql -U rifas rifas_dev` |
| Logs | `docker compose logs -f api` |
| Detener | `docker compose down` (agrega `-v` para borrar la base) |
| Tras cambiar `package.json` | `docker compose up --build -V` (recrea los `node_modules` de los contenedores) |

Sin Docker sigue funcionando como antes, en dos terminales (necesitas PostgreSQL local):

```bash
cd api && cp .env.example .env && npm install && npm run db:init && npm run user:create -- "Tu Nombre" tu@correo.cl "clave-larga" && npm run dev
cd web && npm install && npm run dev
```

## Producción (Coolify)

Se despliega con **Coolify** usando `docker-compose.prod.yml` (build pack *Docker Compose*). La guía paso a paso,
con la importación de datos y los respaldos, está en [`deploy/README.md`](deploy/README.md).

- `web`: Nginx con el front compilado; reenvía `/api` a la API. Es el único servicio con dominio (HTTPS lo pone Coolify).
- `api`: API compilada que corre como usuario sin privilegios; aplica el esquema al arrancar. Comprobantes en el volumen `uploads`.
- `db`: PostgreSQL 16, sin dominio ni puertos. Volúmenes `db-data` y `backups`.

Coolify genera las contraseñas (`SERVICE_PASSWORD_POSTGRES`, `SERVICE_HEX_64_JWT`); en su panel se completan
`WEB_ORIGIN` y, para los avisos por correo, `SMTP_URL` y `MAIL_FROM`. Actualizar es hacer push a `main` y Redeploy.

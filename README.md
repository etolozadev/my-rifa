# mis-rifas

Plataforma personal para organizar rifas (a beneficio, viajes de estudio, metas): talonarios y números, reserva pública con
vencimiento a 7 días, pago por transferencia con comprobante y confirmación por el organizador.

- `api/`: API Node.js + Express + Sequelize + PostgreSQL (fase 1 completa). Ver `api/README.md`.
- `web/`: front en React: página pública (ver la rifa, reservar, seguir la orden, enlaces de vendedor y de pago previo) y panel del equipo en `/admin`
  (crear y activar rifas, confirmar pagos con sus comprobantes, ventas físicas, números, premios y editores). Ver `web/README.md`.

Fase 2 completa: vendedores con enlace propio y talonarios asignados, carga rápida e importación CSV, enlaces de pago
previo para quien ya pagó, e invitaciones por link. Siguiente paso (fase 3): sorteo y avisos.

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

## Producción con Docker

`docker-compose.prod.yml` levanta tres contenedores:

- `db`: PostgreSQL 16 sin puerto publicado, datos en el volumen `db-data`.
- `api`: API compilada (usuario sin privilegios); aplica el esquema al arrancar. Comprobantes en el volumen `uploads`.
- `web`: Nginx con el front compilado; reenvía `/api` a la API. Es el único que publica puerto (`127.0.0.1:8080`).

En el VPS:

```bash
git clone … mis-rifas && cd mis-rifas
cp .env.example .env               # completa POSTGRES_PASSWORD, JWT_SECRET (openssl rand -hex 32) y WEB_ORIGIN
docker compose -f docker-compose.prod.yml up -d --build
docker compose -f docker-compose.prod.yml exec api node dist/scripts/create-user.js "Tu Nombre" tu@correo.cl "clave-larga"
```

HTTPS es obligatorio (la cookie de sesión es `Secure`). Con el Nginx del VPS y certbot:

```nginx
server {
  server_name rifas.estebantoloza.cl;
  location / {
    proxy_pass http://127.0.0.1:8080;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $remote_addr;
    proxy_set_header X-Forwarded-Proto $scheme;
    client_max_body_size 6m;
  }
}
```

El Nginx del contenedor toma la IP real de `X-Forwarded-For` solo cuando la conexión viene de una red privada (el proxy del
VPS), así el límite de reservas por IP sigue funcionando y nadie puede falsearla desde fuera.

**Actualizar**: `git pull && docker compose -f docker-compose.prod.yml up -d --build`

**Respaldos** (diarios, por ejemplo con cron):

```bash
docker compose -f docker-compose.prod.yml exec -T db pg_dump -U rifas rifas | gzip > backup-$(date +%F).sql.gz
docker run --rm -v mis-rifas_uploads:/data -v "$PWD":/backup alpine tar czf /backup/comprobantes-$(date +%F).tgz -C /data .
```

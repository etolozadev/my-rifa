# Despliegue en Coolify

Guía para publicar mis-rifas en **https://rifas.estebantoloza.cl** con Coolify. Coolify construye las imágenes desde
GitHub, pone el dominio con HTTPS y guarda las contraseñas; el repositorio solo aporta `docker-compose.prod.yml`.

Probado en una simulación local de Coolify (proyecto con nombre tipo UUID, sin puertos publicados, variables `SERVICE_*`):
despliegue sano, importación de la rifa, reserva y subida de comprobante a través del Nginx del contenedor `web`, y
respaldo con el comando de la tarea programada, restaurado en una base aparte.

## 1. Antes de empezar

- **DNS**: en el panel de tu dominio, un registro `A` para `rifas` con la IP del servidor de Coolify. Si usas Cloudflare,
  déjalo en "DNS only" (nube gris): con el proxy de Cloudflare la app vería las IP de Cloudflare y el límite de reservas
  por IP dejaría de distinguir compradores.
- **Contraseña de aplicación de Gmail** (avisos al equipo): con la verificación en dos pasos activa, créala en
  https://myaccount.google.com/apppasswords con el nombre "mis-rifas". Son 16 letras; se usan sin espacios.

## 2. Crear la aplicación

En Coolify: tu proyecto → **+ New** → **Public Repository** (o tu GitHub App, si la conectaste: así cada push a `main`
despliega solo).

| Campo | Valor |
| --- | --- |
| Repository URL | `https://github.com/etolozadev/my-rifa` |
| Branch | `main` |
| Build Pack | **Docker Compose** |
| Base Directory | `/` |
| Docker Compose Location | `/docker-compose.prod.yml` |

Coolify carga el archivo y muestra tres servicios: `db`, `api` y `web`.

**Dominio**: solo en el servicio **web**, campo *Domains*: `https://rifas.estebantoloza.cl`. `db` y `api` quedan sin
dominio (son internos). Coolify pide el certificado al desplegar.

## 3. Variables (Configuration → Environment Variables)

| Variable | Valor |
| --- | --- |
| `WEB_ORIGIN` | `https://rifas.estebantoloza.cl` (obligatoria: Coolify no despliega sin ella) |
| `SMTP_URL` | `smtps://estebantoloza1998%40gmail.com:TUCLAVEDEAPLICACION@smtp.gmail.com:465` (el `@` del correo va como `%40`) |
| `MAIL_FROM` | `Rifas <estebantoloza1998@gmail.com>` |
| `SERVICE_PASSWORD_POSTGRES`, `SERVICE_HEX_64_JWT` | Las genera Coolify. **No las cambies después del primer despliegue**: la contraseña de la base queda fijada al crear su volumen, y cambiar el secreto cierra todas las sesiones. |

Sin `SMTP_URL` la app funciona igual; solo no envía correos.

Luego **Deploy**. La primera construcción tarda unos minutos. Cuando los tres servicios estén sanos, abre
https://rifas.estebantoloza.cl (verás el inicio) y sigue con la importación.

## 4. Importar tu rifa (una sola vez, por SSH)

Desde tu PC, en la carpeta del proyecto (la carpeta tiene datos de compradores: no la subas a otro lugar):

```bash
scp -r migracion-produccion deploy/import-data.sh usuario@IP-DEL-SERVIDOR:/tmp/
ssh usuario@IP-DEL-SERVIDOR
```

En el servidor, con el identificador de la app (el UUID que aparece en la URL de Coolify al abrir la aplicación; si
ejecutas el script sin argumentos, lista los candidatos):

```bash
sudo bash /tmp/import-data.sh <uuid> /tmp/migracion-produccion/cirugia-marion.sql /tmp/migracion-produccion/comprobantes.tgz
sudo rm -rf /tmp/migracion-produccion /tmp/import-data.sh
```

El script solo corre sobre una base vacía, importa todo en una transacción y comprueba los comprobantes. Después entra a
https://rifas.estebantoloza.cl/admin con `estebantoloza1998@gmail.com` y **la misma contraseña que usabas en desarrollo**.
El enlace público de la rifa se mantiene: https://rifas.estebantoloza.cl/r/cirugia-marion-c94e

## 5. Respaldo diario (Configuration → Scheduled Tasks → Add)

| Campo | Valor |
| --- | --- |
| Name | `respaldo` |
| Container | `db` |
| Frequency | `30 3 * * *` (todos los días a las 03:30) |
| Command | ver abajo |

```sh
sh -c 'd=$(date +%F-%H%M); pg_dump -U rifas -d rifas -Fc > /backups/db-$d.dump && tar -czf /backups/comprobantes-$d.tgz -C /uploads comprobantes && find /backups -type f -mtime +14 -delete && ls -l /backups'
```

Guarda la base y los comprobantes en el volumen `backups` y conserva 14 días; Coolify registra la salida de cada
ejecución. Puedes ejecutarla una vez a mano para comprobarla.

Si el servidor se pierde, se pierden también estos respaldos: cópialos a tu PC de vez en cuando. En el servidor,
`sudo docker volume ls | grep backups` muestra el volumen (Coolify le antepone el UUID) y sus archivos están en
`/var/lib/docker/volumes/<ese-volumen>/_data`.

## Día a día

| Tarea | Cómo |
| --- | --- |
| Actualizar | `git push` a `main` y luego **Redeploy** en Coolify (o automático con la GitHub App). Los cambios de la base se aplican solos al arrancar. |
| Ver errores | Coolify → la app → **Logs** del servicio `api` |
| Cambiar una contraseña | Coolify → **Terminal** → contenedor `api` → `node dist/scripts/set-password.js correo@ejemplo.cl "nueva-clave-larga"` |
| Crear otra cuenta | Terminal en `api` → `node dist/scripts/create-user.js "Nombre" correo "clave"` (o invítala desde el panel) |
| Activar o cambiar el correo | Edita `SMTP_URL` / `MAIL_FROM` y **Redeploy** |

### Restaurar un respaldo

Reemplaza los datos actuales: ejecuta antes la tarea de respaldo. En Coolify detén el servicio `api` y, en la
**Terminal** del contenedor `db`:

```sh
pg_restore -U rifas -d rifas --clean --if-exists --no-owner /backups/db-FECHA.dump
tar -xzf /backups/comprobantes-FECHA.tgz -C /tmp && ls /tmp/comprobantes
```

Los comprobantes se copian desde el contenedor `api` (allí el volumen no es de solo lectura). Por SSH:
`sudo docker exec -i -u node <contenedor-api> tar -xzf - -C /app/storage < comprobantes-FECHA.tgz`.
Luego vuelve a iniciar `api`.

## Cómo está armado

- `web` (Nginx) es el único servicio con dominio: sirve el front y reenvía `/api` a `api:3000` por la red interna de la
  app. Toma la IP real del comprador desde `X-Forwarded-For` solo si la conexión viene de una red privada (el proxy de
  Coolify), así nadie puede falsearla desde fuera.
- `api` arranca como root solo para ajustar los permisos del volumen de comprobantes y corre la app como `node`
  (`api/docker-entrypoint.sh`). Aplica el esquema de la base en cada arranque (es idempotente).
- `db` (PostgreSQL 16) no tiene dominio ni puertos; monta los comprobantes en solo lectura para respaldarlos.
- Volúmenes: `db-data` (base), `uploads` (comprobantes) y `backups` (respaldos).

# Despliegue en el servidor

Guía para publicar mis-rifas en **https://rifas.estebantoloza.cl**, en un VPS que ya tiene Nginx sirviendo otros sitios.
La app corre en Docker y solo escucha en `127.0.0.1`; el Nginx del servidor la publica con HTTPS. No hay que abrir puertos nuevos.

Todo se probó de punta a punta en una copia local: instalación, importación de la rifa, inicio de sesión, descarga de
comprobantes, respaldo y restauración del respaldo.

## Antes de empezar

1. **DNS**: en el panel de tu dominio, crea un registro `A` para `rifas` que apunte a la IP pública del servidor.
   Puede tardar unos minutos en propagarse; el certificado HTTPS no se emite hasta que apunte bien.
2. **Contraseña de aplicación de Gmail** (para los avisos al equipo): requiere la verificación en dos pasos activada.
   Entra a https://myaccount.google.com/apppasswords, crea una llamada "mis-rifas" y guarda las 16 letras.
   Si prefieres activarlo después, deja el Gmail en blanco cuando el instalador lo pregunte.
3. **Copia la migración al servidor** desde tu PC, en la carpeta del proyecto (contiene datos de compradores:
   no la subas a ningún otro lugar):

   ```bash
   scp -r migracion-produccion usuario@IP-DEL-SERVIDOR:/tmp/
   ```

## Instalación (en el servidor)

```bash
sudo git clone https://github.com/etolozadev/my-rifa.git /opt/mis-rifas
cd /opt/mis-rifas

# 1. Docker (lo ofrece instalar si falta), secretos generados, contenedores arriba y respaldo diario programado
sudo ./deploy/install.sh

# 2. Tu rifa "Cirugía Marion", tu cuenta (organizadora) y sus comprobantes. Solo funciona sobre una base vacía.
sudo ./deploy/import-data.sh /tmp/migracion-produccion/cirugia-marion.sql /tmp/migracion-produccion/comprobantes.tgz
sudo rm -rf /tmp/migracion-produccion

# 3. Sitio en Nginx (sin tocar los otros) y certificado HTTPS con certbot
sudo ./deploy/nginx-setup.sh
```

Luego entra a https://rifas.estebantoloza.cl/admin con `estebantoloza1998@gmail.com` y **la misma contraseña que usabas
en desarrollo**. El enlace público de la rifa se mantiene: https://rifas.estebantoloza.cl/r/cirugia-marion-c94e

Si no recuerdas la contraseña:

```bash
sudo docker compose -f docker-compose.prod.yml exec api node dist/scripts/set-password.js estebantoloza1998@gmail.com "nueva-clave-larga"
```

## Día a día

| Tarea | Comando (en `/opt/mis-rifas`) |
| --- | --- |
| Actualizar a la última versión de `main` (respalda antes) | `sudo ./deploy/update.sh` |
| Respaldo manual | `sudo ./deploy/backup.sh` |
| Ver lo que pasa en la API | `sudo docker compose -f docker-compose.prod.yml logs -f api` |
| Estado de los contenedores | `sudo docker compose -f docker-compose.prod.yml ps` |
| Cambiar una contraseña | `sudo docker compose -f docker-compose.prod.yml exec api node dist/scripts/set-password.js correo "clave"` |
| Crear otra cuenta | `sudo docker compose -f docker-compose.prod.yml exec api node dist/scripts/create-user.js "Nombre" correo "clave"` (o invítala desde el panel) |
| Activar o cambiar el correo | edita `SMTP_URL` y `MAIL_FROM` en `.env` y luego `sudo docker compose -f docker-compose.prod.yml up -d` |

## Respaldos

`install.sh` programa un respaldo diario a las 03:30 (`/etc/cron.d/mis-rifas`): la base (`db-FECHA.dump`) y los comprobantes
(`comprobantes-FECHA.tgz`) quedan en `/var/backups/mis-rifas` durante 14 días. El log está en `/var/log/mis-rifas-backup.log`.

Si el servidor se pierde, se pierden también sus respaldos: de vez en cuando cópialos a tu PC.

```bash
scp -r usuario@IP-DEL-SERVIDOR:/var/backups/mis-rifas ./respaldos-mis-rifas
```

Restaurar un respaldo (reemplaza los datos actuales: haz antes un respaldo nuevo):

```bash
cd /opt/mis-rifas
sudo docker compose -f docker-compose.prod.yml stop api
sudo docker compose -f docker-compose.prod.yml exec -T db pg_restore -U rifas -d rifas --clean --if-exists --no-owner < /var/backups/mis-rifas/db-FECHA.dump
sudo docker compose -f docker-compose.prod.yml start api
sudo docker compose -f docker-compose.prod.yml exec -T api tar -xzf - -C /app/storage < /var/backups/mis-rifas/comprobantes-FECHA.tgz
```

## Qué hace cada script

- `install.sh`: verifica Docker, crea `.env` (secretos aleatorios, dominio, Gmail, primer puerto libre desde 8080; permisos
  solo para root), construye y levanta los contenedores, comprueba que la app responde y programa el respaldo. Repetirlo es
  seguro: conserva el `.env` existente.
- `import-data.sh`: carga el `.sql` en una sola transacción (o entra todo o nada), copia los comprobantes dentro del
  contenedor y comprueba que cada comprobante registrado tenga su archivo. Se niega a correr si la base ya tiene datos.
- `nginx-setup.sh`: crea `/etc/nginx/sites-available/rifas.estebantoloza.cl` (o `conf.d` en otras distribuciones) desde
  `nginx/mis-rifas.conf`, valida con `nginx -t` antes de recargar y ejecuta `certbot --nginx`. No modifica un sitio que ya exista.
- `update.sh`: respaldo, `git pull --ff-only`, reconstrucción, verificación de salud y limpieza de imágenes viejas.
- `backup.sh`: `pg_dump` de la base y `tar` de los comprobantes, con rotación.

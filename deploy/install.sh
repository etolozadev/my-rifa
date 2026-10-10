#!/usr/bin/env bash
# Instala mis-rifas con Docker en el servidor. Se ejecuta desde la carpeta del repositorio:
#   sudo ./deploy/install.sh
# Es seguro repetirlo: si .env ya existe lo conserva y solo vuelve a levantar los contenedores.
#
# Variables opcionales (para no responder preguntas):
#   DOMAIN=rifas.estebantoloza.cl   GMAIL=tu@gmail.com   GMAIL_APP_PASSWORD=xxxxxxxxxxxxxxxx   (GMAIL= vacío: sin correos)
set -euo pipefail
cd "$(dirname "$0")/.."
. deploy/lib.sh

DOMAIN="${DOMAIN:-rifas.estebantoloza.cl}"

# 1. Docker y el plugin compose
if ! command -v docker >/dev/null 2>&1 || ! docker compose version >/dev/null 2>&1; then
  say "Este servidor no tiene Docker (o le falta el plugin compose)."
  read -r -p "¿Instalarlo ahora con el script oficial de Docker (get.docker.com)? [s/N] " yes
  [ "${yes:-n}" = s ] || fail "Instala Docker siguiendo https://docs.docker.com/engine/install/ y vuelve a ejecutar."
  curl -fsSL https://get.docker.com | sh
fi

# 2. Configuración (.env con secretos generados aquí; nunca sale del servidor)
if [ -f .env ]; then
  say ".env ya existe: se conserva tal cual."
else
  say "Creando la configuración (.env)"
  # Primer puerto libre desde 8080 (el servidor ya tiene otros sitios)
  port=8080
  if command -v ss >/dev/null 2>&1; then
    while ss -ltnH "( sport = :$port )" | grep -q .; do port=$((port + 1)); done
  fi

  if [ -z "${GMAIL+x}" ]; then
    echo "Avisos por correo al equipo (comprobante nuevo, resultado del sorteo)."
    echo "Necesitas una contraseña de aplicación de Gmail: https://myaccount.google.com/apppasswords"
    read -r -p "Tu Gmail (Enter para dejar los correos para después): " GMAIL
  fi
  smtp=""
  from="mis-rifas <no-responder@localhost>"
  if [ -n "$GMAIL" ]; then
    if [ -z "${GMAIL_APP_PASSWORD:-}" ]; then
      read -r -s -p "Contraseña de aplicación (16 letras): " GMAIL_APP_PASSWORD
      echo
    fi
    app="${GMAIL_APP_PASSWORD// /}"
    [ "${#app}" -eq 16 ] || fail "La contraseña de aplicación de Gmail tiene 16 letras (sin espacios)."
    smtp="smtps://${GMAIL//@/%40}:${app}@smtp.gmail.com:465"
    from="Rifas <${GMAIL}>"
  fi

  umask 077
  cat >.env <<EOF
# Generado por deploy/install.sh el $(date +%F). Contiene secretos: no lo copies ni lo subas a git.
POSTGRES_USER=rifas
POSTGRES_DB=rifas
POSTGRES_PASSWORD=$(openssl rand -hex 24)
JWT_SECRET=$(openssl rand -hex 32)
WEB_ORIGIN=https://${DOMAIN}
ALLOW_REGISTRATION=false
SMTP_URL=${smtp}
MAIL_FROM="${from}"
WEB_BIND=127.0.0.1
WEB_PORT=${port}
EOF
  echo "Listo: secretos generados y guardados en .env (solo lo puede leer root)."
fi

# 3. Construir y levantar (la API aplica el esquema de la base al arrancar)
say "Construyendo y levantando los contenedores (la primera vez tarda unos minutos)"
"${COMPOSE[@]}" up -d --build --wait
port="$(env_get WEB_PORT)"
curl -fsS "http://127.0.0.1:${port}/api/health" >/dev/null || fail "La app no responde en 127.0.0.1:${port}"
echo "La app responde en http://127.0.0.1:${port} (solo accesible desde este servidor)."

# 4. Respaldo diario de la base y los comprobantes (03:30, conserva 14 días)
if [ "$(uname -s)" = Linux ] && [ -d /etc/cron.d ] && [ ! -f /etc/cron.d/mis-rifas ]; then
  echo "30 3 * * * root $(pwd)/deploy/backup.sh >> /var/log/mis-rifas-backup.log 2>&1" >/etc/cron.d/mis-rifas
  echo "Respaldo diario programado: /var/backups/mis-rifas (log en /var/log/mis-rifas-backup.log)."
fi

say "Instalación lista. Siguientes pasos:"
echo "  1. (Solo la primera vez) importar tu rifa:  sudo ./deploy/import-data.sh /tmp/migracion-produccion/cirugia-marion.sql /tmp/migracion-produccion/comprobantes.tgz"
echo "  2. Publicarla en https://${DOMAIN}:       sudo ./deploy/nginx-setup.sh"

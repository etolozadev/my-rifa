#!/usr/bin/env bash
# Respaldo de la base de datos y de los comprobantes. install.sh lo programa a diario (03:30).
#   sudo ./deploy/backup.sh
# Conserva KEEP_DAYS días (14 por defecto) en BACKUP_DIR (/var/backups/mis-rifas por defecto).
# Recomendado: copiar esa carpeta fuera del servidor de vez en cuando (si el servidor se pierde, se pierden también).
set -euo pipefail
cd "$(dirname "$0")/.."
. deploy/lib.sh
require_env

dest="${BACKUP_DIR:-/var/backups/mis-rifas}"
keep="${KEEP_DAYS:-14}"
stamp="$(date +%F-%H%M)"
mkdir -p "$dest"
chmod 700 "$dest"

"${COMPOSE[@]}" exec -T db pg_dump -U "$(env_get POSTGRES_USER)" -d "$(env_get POSTGRES_DB)" -Fc >"$dest/db-$stamp.dump"
"${COMPOSE[@]}" exec -T api tar -czf - -C /app/storage comprobantes >"$dest/comprobantes-$stamp.tgz"
# Un respaldo vacío es peor que ninguno: se avisa
[ -s "$dest/db-$stamp.dump" ] || fail "El respaldo de la base quedó vacío: $dest/db-$stamp.dump"

find "$dest" -type f \( -name 'db-*.dump' -o -name 'comprobantes-*.tgz' \) -mtime +"$keep" -delete
echo "$(date '+%F %T') respaldo listo: $dest/db-$stamp.dump y comprobantes-$stamp.tgz"

#!/usr/bin/env bash
# Actualiza a la última versión de main: respalda, descarga, reconstruye y reinicia.
#   sudo ./deploy/update.sh
# La API aplica los cambios de esquema al arrancar (son idempotentes); la caída es de segundos.
set -euo pipefail
cd "$(dirname "$0")/.."
. deploy/lib.sh
require_env

say "Respaldo previo"
./deploy/backup.sh

say "Descargando la última versión"
before="$(git rev-parse --short HEAD)"
git pull --ff-only
after="$(git rev-parse --short HEAD)"
if [ "$before" = "$after" ]; then
  echo "Ya estaba en la última versión ($after)."
else
  git log --oneline "$before..$after"
fi

say "Reconstruyendo y reiniciando"
"${COMPOSE[@]}" up -d --build --wait
docker image prune -f >/dev/null
port="$(env_get WEB_PORT)"
curl -fsS "http://127.0.0.1:${port}/api/health" >/dev/null || fail "La app no responde después de actualizar: revisa '${COMPOSE[*]} logs api'"
say "Actualizado a $after"

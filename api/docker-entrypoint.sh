#!/bin/sh
# Arranque de la imagen de producción. Los volúmenes pueden llegar con dueño root (creados por otro contenedor,
# restaurados desde un respaldo o por la plataforma): se ajustan los permisos de la carpeta de comprobantes y
# la app corre siempre como el usuario sin privilegios "node".
set -e
if [ "$(id -u)" = 0 ]; then
  mkdir -p "${UPLOADS_DIR:-/app/storage/comprobantes}"
  chown -R node:node /app/storage
  exec su-exec node "$@"
fi
exec "$@"

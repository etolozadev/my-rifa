#!/usr/bin/env bash
# Carga en una instalación NUEVA de Coolify los datos migrados desde desarrollo (rifa, usuario, órdenes y comprobantes).
# Se ejecuta en el servidor (por SSH), con el identificador de la aplicación en Coolify (está en la URL de la app):
#   sudo bash import-data.sh <uuid-de-la-app> /tmp/migracion-produccion/cirugia-marion.sql /tmp/migracion-produccion/comprobantes.tgz
# Se niega a correr si la base ya tiene rifas o usuarios, para no mezclar ni pisar datos.
set -euo pipefail

fail() { printf '\033[31mError:\033[0m %s\n' "$*" >&2; exit 1; }
say() { printf '\n\033[1m%s\033[0m\n' "$*"; }

app="${1:-}"
sql="${2:-}"
tgz="${3:-}"

# Contenedores de un servicio de la app: por la etiqueta de proyecto de Compose o por el sufijo del nombre
container() {
  local id
  id="$(docker ps -q --filter "label=com.docker.compose.project=$app" --filter "label=com.docker.compose.service=$1" | head -n1)"
  [ -n "$id" ] || id="$(docker ps -q --filter "name=^/$1-$app" | head -n1)"
  printf '%s' "$id"
}

if [ -z "$app" ] || [ ! -f "$sql" ]; then
  echo "Uso: $0 <uuid-de-la-app> archivo.sql [comprobantes.tgz]"
  echo "Contenedores 'api' en este servidor (la columna 1 suele ser el uuid):"
  docker ps --filter "label=com.docker.compose.service=api" --format '  {{.Label "com.docker.compose.project"}}  {{.Names}}  {{.Status}}'
  exit 1
fi
[ -z "$tgz" ] || [ -f "$tgz" ] || fail "No encuentro $tgz"

db="$(container db)"
api="$(container api)"
[ -n "$db" ] && [ -n "$api" ] || fail "No encontré los contenedores db y api de la app $app. ¿Está desplegada y en ejecución?"

psql_app() { docker exec -i "$db" psql -U rifas -d rifas "$@"; }

existing="$(psql_app -tAc 'SELECT (SELECT count(*) FROM raffles) + (SELECT count(*) FROM users)')"
[ "$existing" = 0 ] || fail "La base ya tiene datos ($existing rifas+usuarios). La importación es solo para una instalación vacía."

say "Importando la base (en una sola transacción: o entra todo, o nada)"
psql_app -v ON_ERROR_STOP=1 -q --single-transaction <"$sql" >/dev/null

if [ -n "$tgz" ]; then
  say "Copiando los comprobantes"
  # Se descomprimen como el usuario de la app para que los archivos queden con su dueño
  docker exec -i -u node "$api" sh -c 'mkdir -p /app/storage/comprobantes && tar -xzf - -C /app/storage/comprobantes' <"$tgz"
fi

say "Importado:"
psql_app -c "SELECT r.nombre AS rifa, r.slug, r.estado,
               (SELECT count(*) FROM orders o WHERE o.raffle_id = r.id) AS ordenes,
               (SELECT string_agg(u.email || ' (' || m.rol || ')', ', ') FROM raffle_members m JOIN users u ON u.id = m.user_id WHERE m.raffle_id = r.id) AS equipo
             FROM raffles r ORDER BY r.id"
# Cada comprobante registrado en la base debe existir como archivo (la revisión corre dentro del contenedor)
# shellcheck disable=SC2016 # las variables se expanden dentro del contenedor, no aquí
psql_app -tAc 'SELECT archivo FROM payment_proofs' |
  docker exec -i "$api" sh -c 'n=0; while read -r f; do [ -z "$f" ] && continue; n=$((n+1)); [ -f "/app/storage/comprobantes/$f" ] || echo "Atención: falta el comprobante $f"; done; echo "Comprobantes revisados: $n"'
echo "Listo. Cuando verifiques la rifa en el navegador, borra los archivos de migración: rm -rf $(dirname "$sql")"

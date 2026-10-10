#!/usr/bin/env bash
# Carga en una instalación NUEVA los datos migrados desde desarrollo (rifa, usuario, órdenes y comprobantes).
#   sudo ./deploy/import-data.sh /tmp/migracion-produccion/cirugia-marion.sql /tmp/migracion-produccion/comprobantes.tgz
# Se niega a correr si la base ya tiene rifas o usuarios, para no mezclar ni pisar datos.
set -euo pipefail
cd "$(dirname "$0")/.."
. deploy/lib.sh
require_env

sql="${1:-}"
tgz="${2:-}"
[ -f "$sql" ] || fail "Uso: $0 archivo.sql [comprobantes.tgz]"
[ -z "$tgz" ] || [ -f "$tgz" ] || fail "No encuentro $tgz"

existing="$(psql_prod -tAc 'SELECT (SELECT count(*) FROM raffles) + (SELECT count(*) FROM users)')"
[ "$existing" = 0 ] || fail "La base ya tiene datos ($existing rifas+usuarios). La importación es solo para una instalación vacía."

say "Importando la base (en una sola transacción: o entra todo, o nada)"
psql_prod -v ON_ERROR_STOP=1 -q --single-transaction <"$sql" >/dev/null

if [ -n "$tgz" ]; then
  say "Copiando los comprobantes"
  # Se descomprimen dentro del contenedor de la API, con su usuario (los archivos quedan con los permisos correctos)
  "${COMPOSE[@]}" exec -T api sh -c 'mkdir -p /app/storage/comprobantes && tar -xzf - -C /app/storage/comprobantes' <"$tgz"
fi

say "Importado:"
psql_prod -c "SELECT r.nombre AS rifa, r.slug, r.estado,
                (SELECT count(*) FROM orders o WHERE o.raffle_id = r.id) AS ordenes,
                (SELECT string_agg(u.email || ' (' || m.rol || ')', ', ') FROM raffle_members m JOIN users u ON u.id = m.user_id WHERE m.raffle_id = r.id) AS equipo
              FROM raffles r ORDER BY r.id"
# Cada comprobante registrado en la base debe existir como archivo (la revisión corre dentro del contenedor)
# shellcheck disable=SC2016 # las variables se expanden dentro del contenedor, no aquí
psql_prod -tAc 'SELECT archivo FROM payment_proofs' |
  "${COMPOSE[@]}" exec -T api sh -c 'n=0; while read -r f; do [ -z "$f" ] && continue; n=$((n+1)); [ -f "/app/storage/comprobantes/$f" ] || echo "Atención: falta el comprobante $f"; done; echo "Comprobantes revisados: $n"'
echo "Listo. Borra los archivos de migración del servidor cuando verifiques la rifa: rm -rf $(dirname "$sql")"

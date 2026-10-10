# Funciones comunes de los scripts de despliegue (se carga con: . deploy/lib.sh)
# shellcheck shell=bash

COMPOSE=(docker compose -f docker-compose.prod.yml)

say() { printf '\n\033[1m%s\033[0m\n' "$*"; }
fail() { printf '\033[31mError:\033[0m %s\n' "$*" >&2; exit 1; }

# Lee una variable del .env sin ejecutarlo (los valores pueden tener espacios o < >)
env_get() { grep -E "^$1=" .env | tail -n1 | cut -d= -f2- | sed -e 's/^"//' -e 's/"$//'; }

require_env() { [ -f .env ] || fail "No existe .env: ejecuta primero sudo ./deploy/install.sh"; }

psql_prod() {
  "${COMPOSE[@]}" exec -T db psql -U "$(env_get POSTGRES_USER)" -d "$(env_get POSTGRES_DB)" "$@"
}

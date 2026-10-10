#!/usr/bin/env bash
# Publica mis-rifas en el Nginx que ya tiene el servidor (sin tocar los otros sitios) y pide el certificado HTTPS.
#   sudo ./deploy/nginx-setup.sh
set -euo pipefail
cd "$(dirname "$0")/.."
. deploy/lib.sh
require_env

DOMAIN="${DOMAIN:-$(env_get WEB_ORIGIN | sed -e 's#^https\?://##' -e 's#/.*##')}"
port="$(env_get WEB_PORT)"
command -v nginx >/dev/null 2>&1 || fail "No encontré nginx en este servidor."

# ¿El dominio ya apunta aquí? (sin consultar servicios externos: se compara con las IP de este servidor)
dns="$(getent ahostsv4 "$DOMAIN" | awk 'NR==1 {print $1}' || true)"
if [ -z "$dns" ]; then
  echo "Atención: $DOMAIN aún no resuelve. Crea un registro A apuntando a la IP pública de este servidor."
elif ! hostname -I | tr ' ' '\n' | grep -qx "$dns"; then
  echo "Nota: $DOMAIN apunta a $dns, que no es una IP de esta máquina (puede ser normal detrás de un NAT o proxy)."
fi

# Debian/Ubuntu usan sites-available/sites-enabled; otras distribuciones, conf.d
if [ -d /etc/nginx/sites-available ]; then
  conf="/etc/nginx/sites-available/$DOMAIN"
  link="/etc/nginx/sites-enabled/$DOMAIN"
else
  conf="/etc/nginx/conf.d/$DOMAIN.conf"
  link=""
fi

if [ -f "$conf" ]; then
  echo "$conf ya existe: no lo modifico."
else
  sed -e "s/__DOMAIN__/$DOMAIN/g" -e "s/__PORT__/$port/g" deploy/nginx/mis-rifas.conf >"$conf"
  [ -z "$link" ] || ln -sf "$conf" "$link"
  echo "Sitio creado: $conf (reenvía a 127.0.0.1:$port)"
fi

nginx -t || fail "La configuración de Nginx tiene errores: revisa $conf (no se recargó nada)."
systemctl reload nginx
echo "Nginx recargado: http://$DOMAIN ya debería responder."

if command -v certbot >/dev/null 2>&1; then
  say "Pidiendo el certificado HTTPS (Let's Encrypt)"
  certbot --nginx -d "$DOMAIN" --redirect
  say "Publicado en https://$DOMAIN"
else
  echo "Falta certbot. Instálalo y vuelve a ejecutar este script:"
  echo "  sudo apt install certbot python3-certbot-nginx"
fi

# mis-rifas · Web
# Etapas: deps → dev (docker-compose.yml) · build → prod (docker-compose.prod.yml)

FROM node:24-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

# Desarrollo: Vite con HMR; el código se monta como volumen
FROM deps AS dev
EXPOSE 5173
CMD ["npm", "run", "dev", "--", "--host", "0.0.0.0"]

# Compilación estática (typecheck + vite build → dist/)
FROM deps AS build
COPY . .
RUN npm run build

# Producción: Nginx sirve el front y reenvía /api al contenedor de la API
FROM nginx:1.27-alpine AS prod
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 80
HEALTHCHECK --interval=30s --timeout=5s --retries=3 CMD wget -qO- http://127.0.0.1/ >/dev/null || exit 1

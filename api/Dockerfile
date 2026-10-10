# mis-rifas · API
# Etapas: deps → dev (docker-compose.yml) · build → prod (docker-compose.prod.yml)

FROM node:24-alpine AS base
WORKDIR /app

# Dependencias completas (dev + prod), cacheadas mientras no cambie el lockfile
FROM base AS deps
COPY package.json package-lock.json ./
RUN npm ci

# Desarrollo: el código se monta como volumen y tsx recarga al guardar
FROM deps AS dev
ENV NODE_ENV=development
EXPOSE 3000
CMD ["sh", "-c", "npm run db:init && npm run dev"]

# Compilación a JavaScript (dist/src, dist/scripts y dist/db)
FROM deps AS build
COPY . .
RUN npm run build

# Solo dependencias de producción
FROM base AS prod-deps
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

# Producción: imagen mínima, usuario sin privilegios
FROM base AS prod
ENV NODE_ENV=production \
    PORT=3000 \
    UPLOADS_DIR=/app/storage/comprobantes
COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY package.json ./
RUN mkdir -p /app/storage/comprobantes && chown -R node:node /app/storage
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
# El esquema es idempotente (IF NOT EXISTS): se aplica en cada arranque
CMD ["sh", "-c", "node dist/scripts/db-init.js && exec node dist/src/server.js"]

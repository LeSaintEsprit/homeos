# HOMEOS — image de production (une seule image : serveur + application web).
# Registre des images de base (par défaut Docker Hub). En cas de limite de téléchargement (« 429 Too Many Requests ») :
#   docker build --build-arg REGISTRY=mirror.gcr.io/library/ -t homeos .
# Derrière un proxy qui inspecte le HTTPS, fournir son certificat (facultatif) :
#   docker build --secret id=ca,src=/chemin/ca.crt --build-arg HTTPS_PROXY=http://proxy:port -t homeos .
ARG REGISTRY=
# Image complète pour la construction : python3, make et g++ y sont déjà (module natif SQLite).
FROM ${REGISTRY}node:22-bookworm AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY packages/server/package.json packages/server/
COPY packages/web/package.json packages/web/
RUN --mount=type=secret,id=ca sh -c '[ -f /run/secrets/ca ] && export NODE_EXTRA_CA_CERTS=/run/secrets/ca; npm ci --no-audit --no-fund'
COPY tsconfig.base.json ./
COPY packages ./packages
RUN npm run build -w @homeos/web && npm run build -w @homeos/server
# Dépendances de production uniquement (modules natifs compilés pour l'image).
RUN --mount=type=secret,id=ca mkdir /prod && cp package.json package-lock.json /prod/ && mkdir -p /prod/packages/server /prod/packages/shared /prod/packages/web \
  && cp packages/server/package.json /prod/packages/server/ && cp packages/shared/package.json /prod/packages/shared/ && cp packages/web/package.json /prod/packages/web/ \
  && cd /prod && { [ -f /run/secrets/ca ] && export NODE_EXTRA_CA_CERTS=/run/secrets/ca; npm ci --omit=dev --no-audit --no-fund -w @homeos/server; }

FROM ${REGISTRY}node:22-bookworm-slim
# Le serveur et l'outil d'administration tournent sous le compte « node », jamais en root.
ENV NODE_ENV=production PORT=8080 HOMEOS_DATA_DIR=/data HOMEOS_WEB_DIR=/app/web HOMEOS_RUN_AS=node
WORKDIR /app
COPY --from=build /prod/node_modules ./node_modules
COPY --from=build /app/packages/server/dist ./server
COPY --from=build /app/packages/web/dist ./web
COPY docker-entrypoint.sh /usr/local/bin/homeos-entrypoint
RUN chmod 755 /usr/local/bin/homeos-entrypoint && mkdir -p /data && chown -R node:node /data
VOLUME ["/data"]
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s CMD node -e "fetch('http://localhost:'+(process.env.PORT||8080)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
ENTRYPOINT ["homeos-entrypoint"]
CMD ["node", "server/server.js"]

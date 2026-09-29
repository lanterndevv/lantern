# syntax=docker/dockerfile:1
FROM node:24-alpine AS build
WORKDIR /app
COPY . .
RUN npm ci && npm run build && npm prune --omit=dev \
 && rm -rf node_modules/pixi.js node_modules/three node_modules/@pixi   # la web ya está compilada en dist

FROM node:24-alpine
ENV NODE_ENV=production PORT=8787 HOST=0.0.0.0 LANTERN_DB=/data/lantern.db LANTERN_ASSETS=/data/assets WEB_DIST=/app/apps/web/dist
WORKDIR /app
COPY --from=build /app/package.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/packages ./packages
COPY --from=build /app/apps/server ./apps/server
COPY --from=build /app/apps/web/dist ./apps/web/dist
RUN mkdir /data && chown node:node /data
USER node
VOLUME /data
EXPOSE 8787
HEALTHCHECK --interval=30s --timeout=3s CMD wget -qO- http://127.0.0.1:8787/health || exit 1
CMD ["node", "apps/server/src/main.ts"]

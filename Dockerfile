# syntax=docker/dockerfile:1.7
#
# One image serves the whole product: `server/index.mjs` answers /api/brief and
# serves the built Vite bundle from the same origin, so there is no second
# service, no CORS surface and no static host to keep in sync.
#
#   docker build -t minisbsbuilder:latest .
#   docker run --env-file .env.staging -p 4174:4174 minisbsbuilder:latest
#
ARG NODE_VERSION=22.15.1

# ---------------------------------------------------------------- build client
FROM node:${NODE_VERSION}-bookworm-slim AS build
WORKDIR /app
# Playwright is a dev dependency used only by tests and authoring scripts. The
# build needs the package resolved, never a browser binary.
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
COPY package.json package-lock.json ./
RUN npm ci --include=dev
COPY . .
RUN npm run build

# ------------------------------------------------------- production node_modules
FROM node:${NODE_VERSION}-bookworm-slim AS prod-deps
WORKDIR /app
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

# ---------------------------------------------------------------------- runtime
FROM node:${NODE_VERSION}-bookworm-slim AS runtime
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=4174 \
    NODE_OPTIONS=--enable-source-maps
WORKDIR /app

# Only what the server actually reads at runtime: the bundle it serves, its own
# routes and prompts, the shared contracts, and production dependencies.
COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY server ./server
COPY shared ./shared
COPY scripts/check-env.mjs ./scripts/check-env.mjs
COPY package.json package-lock.json ./

USER node
EXPOSE 4174

# Liveness only — /healthz makes no upstream call, so an Ollama or Shutterstock
# outage never restarts a container that is serving pages correctly.
# Exec form: no shell, so nothing in the probe is re-interpreted by /bin/sh.
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:' + (process.env.PORT || 4174) + '/healthz').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"]

CMD ["node", "server/index.mjs"]

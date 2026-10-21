# syntax=docker/dockerfile:1
# A Next.js app of the workspace. Build from the repo root:
#   docker build -f apps/web/Dockerfile .                     (the reader/writer app)
#   docker build -f apps/web/Dockerfile --build-arg APP=admin .   (the staff console)
FROM node:24-bookworm-slim AS base
ENV CI=true COREPACK_ENABLE_DOWNLOAD_PROMPT=0
WORKDIR /app
# pnpm at the version pinned in package.json's packageManager
COPY package.json ./
RUN corepack enable && corepack install

FROM base AS source
COPY . .

FROM source AS build
ARG APP=web
RUN --mount=type=cache,id=morrow-pnpm,target=/pnpm-store \
    pnpm install --frozen-lockfile --store-dir /pnpm-store
# Read when the app is built, not when it starts: next.config.ts bakes the API rewrite into the routes manifest and
# NEXT_PUBLIC_* is inlined into browser code. Change any of these → rebuild.
ARG API_INTERNAL_URL=http://api:4000
ARG COLLAB_PUBLIC_URL
ARG SITE_URL
ARG ADMIN_PUBLIC_URL
ARG NEXT_PUBLIC_ICE_SERVERS=[]
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 \
    API_INTERNAL_URL=$API_INTERNAL_URL COLLAB_PUBLIC_URL=$COLLAB_PUBLIC_URL SITE_URL=$SITE_URL \
    ADMIN_PUBLIC_URL=$ADMIN_PUBLIC_URL NEXT_PUBLIC_ICE_SERVERS=$NEXT_PUBLIC_ICE_SERVERS
RUN pnpm --filter @morrow/tokens build && pnpm --filter "@morrow/$APP" build && rm -rf "apps/$APP/.next/cache"

# A fresh install of only this app's production dependencies (pruning in place would leave the dev ones on disk).
FROM source AS prod-deps
ARG APP=web
RUN --mount=type=cache,id=morrow-pnpm,target=/pnpm-store \
    pnpm install --frozen-lockfile --prod --filter "@morrow/$APP..." --store-dir /pnpm-store

FROM node:24-bookworm-slim
ARG APP=web
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000
COPY --from=prod-deps /app /app
# the code stays root-owned (read-only to the app); .next is writable for Next's runtime cache
COPY --from=build --chown=node:node /app/apps/$APP/.next /app/apps/$APP/.next
USER node
WORKDIR /app/apps/$APP
EXPOSE 3000
CMD ["node", "node_modules/next/dist/bin/next", "start"]

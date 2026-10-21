# syntax=docker/dockerfile:1
# The API, plus the one-shot migration job (target "migrate"). Build from the repo root:
#   docker build -f apps/api/Dockerfile .
#   docker build -f apps/api/Dockerfile --target migrate .
FROM node:24-bookworm-slim AS base
ENV CI=true COREPACK_ENABLE_DOWNLOAD_PROMPT=0
WORKDIR /app
# pnpm at the version pinned in package.json's packageManager
COPY package.json ./
RUN corepack enable && corepack install

# Only the API and the workspace packages it uses. Development dependencies stay: the API runs its TypeScript
# through tsx, which the workspace lists as a devDependency.
FROM base AS deps
COPY . .
RUN --mount=type=cache,id=morrow-pnpm,target=/pnpm-store \
    pnpm install --frozen-lockfile --filter "@morrow/api..." --store-dir /pnpm-store

FROM node:24-bookworm-slim AS runtime
ENV NODE_ENV=production
COPY --from=deps /app /app
USER node

FROM runtime AS migrate
WORKDIR /app/packages/db
CMD ["node", "--import", "tsx", "src/migrate.ts"]

FROM runtime
WORKDIR /app/apps/api
EXPOSE 4000
CMD ["node", "--import", "tsx", "src/main.ts"]

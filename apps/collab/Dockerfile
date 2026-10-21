# syntax=docker/dockerfile:1
# The live-editing service (Hocuspocus). Build from the repo root:
#   docker build -f apps/collab/Dockerfile .
FROM node:24.22.0-bookworm-slim AS base
ENV CI=true COREPACK_ENABLE_DOWNLOAD_PROMPT=0
WORKDIR /app
# pnpm at the version pinned in package.json's packageManager
COPY package.json ./
RUN corepack enable && corepack install

# Only collab and the workspace packages it uses. Development dependencies stay: collab runs its TypeScript
# through tsx, which the workspace lists as a devDependency.
FROM base AS deps
COPY . .
RUN --mount=type=cache,id=morrow-pnpm,target=/pnpm-store \
    pnpm install --frozen-lockfile --filter "@morrow/collab..." --store-dir /pnpm-store

FROM node:24.22.0-bookworm-slim
ENV NODE_ENV=production
COPY --from=deps /app /app
USER node
WORKDIR /app/apps/collab
EXPOSE 4001
CMD ["node", "--import", "tsx", "src/main.ts"]

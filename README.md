# Morrow

A collaborative writing platform: a shared space for words, worlds, and ideas still becoming.

> **Status:** early development (milestone M1: private writing). Not yet released, not yet licensed for reuse.

## What's here

| Path                 | What it is                                                      |
| -------------------- | --------------------------------------------------------------- |
| `apps/web`           | Next.js product app: sign-in, library, the writing editor       |
| `apps/api`           | Fastify business API (`/api/v1`), authentication                |
| `apps/collab`        | Hocuspocus real-time collaboration service (Yjs)                |
| `packages/editor`    | The manuscript document schema, shared by browser and server    |
| `packages/domain`    | Authorization policy (`can()`), ticket signing: pure TypeScript |
| `packages/db`        | Drizzle schema and migrations (PostgreSQL 18)                   |
| `packages/contracts` | Zod request/response schemas shared by client and server        |
| `packages/tokens`    | Design tokens → CSS variables, with contrast tests              |

How it fits together:

1. The browser talks to the API over same-origin REST.
2. The browser edits chapters through a WebSocket to collab, authorized by a 60-second ticket from the API.
3. Collab is the only writer of document content.
4. Document content is stored as Yjs state. Readable projections are derived from it.

## Getting started

Requirements: Node 24 (`.nvmrc`), pnpm (`corepack enable`), Docker.

```sh
pnpm install
cp .env.example .env            # then fill in the three secrets: openssl rand -base64 48
ln -s ../../.env apps/web/.env.local
pnpm db:up                       # Postgres 18 in Docker
DATABASE_URL=postgres://morrow:morrow@127.0.0.1:5432/morrow pnpm db:migrate
pnpm dev                         # web :3000, api :4000, collab :4001
```

Open http://localhost:3000.

## Testing

```sh
pnpm typecheck && pnpm lint
pnpm test                        # unit + integration (needs the Docker Postgres)
pnpm --filter @morrow/web exec playwright install chromium
pnpm --filter @morrow/web exec playwright test   # end-to-end, with `pnpm dev` running
```

Integration tests create their own throwaway databases (`morrow_api_test`, `morrow_collab_test`). Set `TEST_DATABASE_URL` to point them at a different server.

## Environment variables

`.env.example` documents every variable. It contains no real values, and real secrets never go into the repository.

## Voice rooms

Collaborators on the same chapter can talk while they write. When someone else is on the chapter, a headphones button appears in the editor bar. Join (you start muted), then press ⌘/Ctrl+Shift+M to unmute or mute.

- **Signalling** (offers, answers, ICE candidates) travels over the chapter's existing collab connection, as Hocuspocus stateless messages. Only people who can open the chapter can join. Collab stamps every relayed message with the sender's verified user id, and never passes a message outside the chapter's room. People where either has blocked the other never see or signal each other (`apps/collab/src/voice.ts`).
- **Audio** goes straight between browsers over WebRTC. It is never recorded and never passes through Morrow's servers.
- **Size limit:** each room is a full mesh, capped at 8 speakers (`MAX_SPEAKERS`). Bigger rooms need an SFU such as LiveKit.
- **ICE servers** come from `NEXT_PUBLIC_ICE_SERVERS`. With none, calls work on localhost and simple networks. Across the internet, most networks need a TURN server, for example coturn.
- **Microphone permission:** the site's `Permissions-Policy` allows the microphone on Morrow's own pages only.

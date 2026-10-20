# Architecture notes

A tour of how Morrow fits together, for people working on it. The rules that keep it safe are in [CONTRIBUTING.md](../CONTRIBUTING.md).

## Services

| Service       | Port | Responsibility                                                                                                                                                     |
| ------------- | ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `apps/web`    | 3000 | Product UI (Next.js App Router). It renders pages on the server, calls the API from the server and the browser, and proxies `/api/*` so everything is same-origin. |
| `apps/api`    | 4000 | Business logic and authentication (Better Auth). Every route declares the capability it needs. Also runs the outbox worker.                                        |
| `apps/collab` | 4001 | Real-time documents (Hocuspocus and Yjs). The only service that writes document content. It also runs the proposals engine and relays voice-room signalling.       |
| `apps/admin`  | 3002 | The staff console, on its own origin. Two-factor authentication is required.                                                                                       |
| PostgreSQL 18 | 5432 | All state. Drizzle schema and hand-reviewed SQL migrations in `packages/db`.                                                                                       |

## A document's life

1. **Creating a work** makes a `works` row, a default branch ("Main") and its first chapter. Each chapter points at a `documents` row.
2. **Opening a chapter:** the browser asks the API for a collab ticket. It's signed for 60 seconds and names the user, document and role, after checking `can()`. The browser then opens a WebSocket to collab with that ticket.
3. **On connect,** collab verifies the ticket and re-checks access against the database (roles can change mid-session; collab re-checks periodically and the API can revoke a session immediately).
4. **Edits** are Yjs updates. Collab's `DocumentStore` merges each update into the stored state (merge-on-write, never last-write-wins), keeps a debounced projection (JSON, plain text, word count) for reading and search, and takes automatic snapshots.
5. **Snapshots** hold both the Yjs state (for restores and forks with lineage) and the JSON (for diffs and reading).

## Publishing and reading

- **Publishing** pins one snapshot per chapter of the published branch into `publications`. Readers only ever see publications, never live drafts, so writers keep drafting after they publish.
- **The public API** (`/api/v1/public/*`) serves only works anyone may find (public, published, not deleted, not hidden) or reach by link (unlisted). Search and Discover use the findable set only.
- **Feed counts** (likes, reads, comments) are denormalised on `works` and updated in the same transaction as the event. A read counts once per reader per work per day; anonymous readers are a keyed daily hash that can't be linked from one day to the next.

## Proposals and branches

- **Edit proposals** fork the chapter into a private workspace document (`proposal_base` snapshot). The engine in collab classifies the workspace against the base and the live chapter:
  - **fast-forward:** the chapter hasn't changed since the proposal started
  - **clean:** both sides changed, in different places
  - **conflict:** both sides changed the same places
- **Applying** is idempotent per proposal. A conflict is resolved only by an explicit reviewer choice.
- **Next-chapter proposals** (story chains) carry text. Accepting one creates the chapter, seeds it through collab, and credits the author through an edit session.
- **Branches** fork every chapter with lineage. Compare runs chapter by chapter, and merge applies through the same engine.

## Notifications, email and badges

- **The outbox.** Every meaningful change writes an `activity_events` row in its own transaction. A worker claims events in order (`FOR UPDATE SKIP LOCKED`) and plans notifications for the people concerned, with a dedupe key per recipient. It marks each event processed in the same transaction.
- **Email** follows each person's per-category preferences and waits out their quiet hours. It's sent through Resend when configured; development logs messages.
- **Badges** are data (`achievements`) with rules in code. They're evaluated when relevant events arrive and lazily on read, and awards are idempotent through a primary key.

## Voice rooms

- **Signalling.** Join, leave, mute, offers, answers and ICE candidates travel as Hocuspocus stateless messages on the chapter's existing connection. Collab keeps one room per document, stamps every relayed message with the connection's verified user, never relays across documents, and skips pairs where either person has blocked the other.
- **Audio** goes straight between browsers over WebRTC, as a mesh capped at 8 speakers. Production needs TURN (`NEXT_PUBLIC_ICE_SERVERS`), and rooms larger than 8 need a media server (an SFU such as LiveKit).

## The library

- **Classics** are stored as ordinary published works owned by a "Morrow Library" account that has no way to sign in, with their provenance in `works.source`. They're imported by `apps/api/src/cli/import-classics.ts` from Project Gutenberg's mirror; the converter is `classics/gutenberg.ts`.
- **Open research** articles are converted from JATS XML (`classics/jats.ts`) and imported only when their own licence is CC BY or CC0.
- **Retelling** copies a public-domain work's published snapshots into a new private work. Collab allows that copy across works only for public-domain sources, and checks this itself.

## Front end

- **Shell.** One app shell: a sidebar on desktop, five tabs on phones, and focus surfaces (the editor and the reader) with minimal bars.
- **Components.** React Aria components for accessible primitives, and Tiptap 3 for the editor, with schema v3 nodes in `packages/editor`.
- **Styling.** Design tokens in `packages/tokens` compile to CSS variables, and Tailwind 4 reads them as theme colours. No raw colours are used outside the tokens, except in self-contained images such as covers and avatars.
- **Security headers.** A nonce-based CSP is set per request in `src/proxy.ts`, so every page renders per request.

## Testing

- **Unit and integration tests:** vitest. API tests inject requests into a real app against a throwaway PostgreSQL database per file. Collab tests run real Yjs documents.
- **End-to-end tests:** Playwright against a running stack, with axe on every screen visited.
- **Showcase:** `apps/web/showcase` (separate config). It captures real screenshots from the demo seed and composes the README mockups.

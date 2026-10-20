<p align="center">
  <img src="docs/images/hero.png" alt="Morrow: twelve people in one chapter, writing at once, on a laptop and a phone" width="100%">
</p>

<h1 align="center">Morrow</h1>

<p align="center">
  <b>Write together, in real time. Publish to readers who talk back.</b><br>
  A collaborative writing platform for stories, books, poetry, essays, articles and research.
</p>

<p align="center">
  <a href="#what-it-does">What it does</a> ·
  <a href="#for-teams-and-organisations">For teams</a> ·
  <a href="#architecture">Architecture</a> ·
  <a href="#getting-started">Getting started</a> ·
  <a href="#demo-data-and-screenshots">Demo</a> ·
  <a href="#testing">Testing</a> ·
  <a href="docs/ENTERPRISE.md">Enterprise overview</a> ·
  <a href="docs/ARCHITECTURE.md">Architecture notes</a>
</p>

> **Status:** pre-release, under active development. Not yet licensed for reuse; all rights reserved.

---

## What it does

Morrow covers the whole life of a piece of writing, from the first private draft to a published serial with an audience:

- **Write privately.** Every keystroke is saved, with versions and history.
- **Write together.** Invite people to the same chapter: they write at the same time, talk while they write, comment on passages and propose changes.
- **Publish.** Readers find your work, follow it, comment on single lines, vote on what happens next, and come back every week.

The images below are real screenshots of the product running with its demo data ([how they're made](#demo-data-and-screenshots)).

### Real-time collaboration

<img src="docs/images/collaboration.png" alt="The editor with live carets and names for many writers, comment threads, and roles" width="100%">

- **Live co-writing.** Built on a CRDT (Yjs), so everyone's edits merge without conflicts, even ones made offline. Each writer has a caret with their name, and presence shows who's in the chapter.
- **Voice rooms.** Collaborators on a chapter can talk while they write: browser to browser (WebRTC), never recorded, with signalling carried over the chapter's already-authorised connection.
- **Comments and reactions.** Start a thread on any passage, @mention people, resolve or reopen threads, and react to a paragraph ("beautiful line", "needs clarity").
- **Roles.** Owner, editor, collaborator, contributor and viewer, under three collaboration modes: everyone writes directly; editors write and others propose; or only the owner writes.
- **An editor that stays out of the way.** Formatting appears when you need it: a `/` menu, a selection toolbar and a block handle. Each kind of writing gets its own blocks and typography:
  - scene breaks for fiction
  - verse for poetry
  - callouts, tables and checklists for articles
  - footnotes and citations for papers

### Proposals, branches and review

<img src="docs/images/review.png" alt="Proposals waiting for review, and one open with its progress, notes and decision" width="100%">

- **Proposals.** Contributors edit a private copy of a chapter, or offer a whole next chapter (story chains). You compare word by word, discuss, request changes or accept, and every author is credited. Nothing changes until you accept.
- **Conflict-aware.** If the chapter changed in the same places since a proposal started, Morrow shows both versions side by side, and a clash is never resolved silently.
- **Branches ("what if").** Fork the work to try another ending, compare it chapter by chapter with the main version, and merge it back.
- **Versions.** Named snapshots, a browsable history, and restores that can themselves be undone.

### Reading and community

<img src="docs/images/reading.png" alt="Reading on a phone: comments beside paragraphs, a paragraph's thread, and a reader poll" width="100%">

- **Paragraph comments.** Readers comment beside a single line, and the count shows to everyone reading.
- **"What if" polls.** A writer asks readers a question at the end of a chapter. Counts stay hidden until you vote, so early votes don't steer later ones.
- **The feed.** Latest, For you, Popular and Following, with filters by kind of writing. Likes, follows, saves, shares, and share cards for links.
- **Serials.** "New chapter every Friday" with a countdown; followers hear the moment it's out.
- **Contribute.** Anyone can suggest an edit, write the next chapter, or ask to collaborate. The writer decides.
- **Open reading.** Reading never needs an account. Joining is asked for only when you want to take part.

<img src="docs/images/community.png" alt="The home feed and Discover" width="100%">

### Habits that bring people back

- **Streaks and goals.** A writing streak and a daily word goal, as a ring in the editor's bar. Only your own words count, even in a shared chapter.
- **Weekly prompts.** A new prompt every week, with "Write for this prompt" and a badge for answering.
- **Milestones.** "Your story just passed 1,000 reads", with a card to share.
- **Badges.** Worn on your avatar, wherever you appear.
- **Insights.** Reads, likes, comments, followers, saves and profile views over 7, 30 or 90 days, with your top works and recent activity.

<img src="docs/images/insights.png" alt="Insights with charts, and Activity with collaboration requests" width="100%">

### Built for phones

<img src="docs/images/mobile.png" alt="Writing on a phone with the keyboard toolbar, and the feed" width="100%">

- **Navigation.** Five tabs, with Write in the centre.
- **Writing.** A formatting toolbar above the keyboard, and a `+` that opens every block.
- **Gestures.** Panels are sheets you swipe down to close, and Home has pull to refresh.

### The library: classics and open research

<img src="docs/images/library.png" alt="The classics shelf" width="100%">

- **Classics.** Public-domain books from Project Gutenberg, credited to their authors.
  - Imported through Project Gutenberg's mirror, with its trademarked header and licence removed, as its terms require when redistributing.
  - "Write a retelling" copies one into a private work of your own.
- **Open research.** Articles from the PubMed Central open-access subset, licensed CC BY or CC0 only.
  - Each shows its authors, journal, licence and a note of what was changed, plus a Cite button.

### Coming soon: comics

Making comics as a team: a script editor first (pages, panels, dialogue), then art with roles for pencils, inks, colours and letters. There's a waitlist in the app at `/comics`.

---

## For teams and organisations

<img src="docs/images/enterprise.png" alt="Sharing a work with roles, and Morrow's security and data features" width="100%">

Morrow is built as if a publishing house, a newsroom or a research group will depend on it.

|                            |                                                                                                                                                                                                                                                                                   |
| -------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **One access policy**      | A single `can()` policy (`packages/domain`) decides every permission. The API enforces it on every route, and the collaboration service enforces it again on connect, so read-only stays read-only even on the WebSocket. Anything you may not see answers 404, so nothing leaks. |
| **Words are never lost**   | CRDT documents, merge-on-write persistence, snapshots, named versions, and restores that can be undone.                                                                                                                                                                           |
| **Audit trail**            | Changes to membership, visibility, publishing and proposals are recorded as activity events, in the same transaction as the change.                                                                                                                                               |
| **Security by default**    | Nonce-based Content Security Policy, same-site cookies and strict Origin checks, rate limits, two-factor authentication (required for staff), 60-second signed tickets for the collaboration socket, a tight Permissions-Policy. HTML is never stored as content.                 |
| **Moderation and safety**  | Reports, a staff console with a review queue, hide and restore, account restrictions, appeals decided by a second reviewer, blocking that applies everywhere (voice included), and spam checks.                                                                                   |
| **Privacy**                | Works are private by default, and making one public is an explicit, audited step. Full JSON data export. Real account deletion: shared works pass to the next person on them. Notification preferences with quiet hours.                                                          |
| **Accessibility**          | WCAG 2.2 AA, checked with axe on every screen the end-to-end tests visit. Keyboard-only flows are tested, and reduced motion is respected throughout.                                                                                                                             |
| **Plans and entitlements** | Plan limits (private works, people per work, branches) enforced on the server. Staff can comp plans, and billing can stay off until it's needed.                                                                                                                                  |

The full write-up, including what's on the roadmap (single sign-on, SCIM, a media server for large voice rooms, data residency), is in **[docs/ENTERPRISE.md](docs/ENTERPRISE.md)**.

---

## Architecture

```mermaid
flowchart LR
  subgraph Browser
    W[Next.js app<br/>React Aria · Tiptap]
  end
  W -- "REST, same origin /api/v1" --> API[API<br/>Fastify · Better Auth]
  W -- "WebSocket + 60-second ticket" --> C[Collab<br/>Hocuspocus · Yjs]
  W <-. "WebRTC audio (voice rooms)" .-> W
  API -- "signed internal calls" --> C
  API --> PG[(PostgreSQL 18)]
  C --> PG
  ADM[Admin console<br/>Next.js · 2FA] --> API
```

- **One writer of content.** Only the collaboration service writes document content; the API reaches documents through a signed internal gateway. Content is stored as Yjs state, and readable projections (JSON, plain text, word counts) are derived from it for reading, search and review.
- **Background work.** Notifications, emails and badges come from an activity outbox that a worker drains with `FOR UPDATE SKIP LOCKED`, so several API instances can share the work.

| Path                 | What it is                                                                                        |
| -------------------- | ------------------------------------------------------------------------------------------------- |
| `apps/web`           | The product app: Next.js 16, React 19, Tailwind 4, React Aria, Tiptap 3                           |
| `apps/admin`         | The staff console: moderation, plans, beta feedback (two-factor required)                         |
| `apps/api`           | The business API: Fastify 5, Better Auth, Zod contracts, the outbox worker, the library importers |
| `apps/collab`        | Real-time collaboration (Hocuspocus, Yjs), the proposals engine, voice-room signalling            |
| `packages/editor`    | The manuscript schema shared by browser and server: nodes, diff, Markdown export                  |
| `packages/domain`    | The authorization policy (`can()`), the proposal state machine, ticket signing (pure TypeScript)  |
| `packages/db`        | Drizzle schema and SQL migrations (PostgreSQL 18)                                                 |
| `packages/contracts` | Zod request and response schemas shared by client and server                                      |
| `packages/tokens`    | Design tokens as CSS variables, with automated contrast tests                                     |

More in **[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)**.

---

## Getting started

Requirements: Node 24 (`.nvmrc`), pnpm (`corepack enable`), Docker.

```sh
pnpm install
cp .env.example .env            # fill in the three secrets: openssl rand -base64 48
ln -s ../../.env apps/web/.env.local
pnpm db:up                       # PostgreSQL 18 in Docker
DATABASE_URL=postgres://morrow:morrow@127.0.0.1:5432/morrow pnpm db:migrate
pnpm dev                         # web :3000, api :4000, collab :4001
```

Open http://localhost:3000.

Optional:

- **Email.** Set `RESEND_API_KEY` and `EMAIL_FROM` to send real email (address confirmation, password reset, notifications). Without them, development logs every email.
- **Voice across the internet.** Set `NEXT_PUBLIC_ICE_SERVERS` to a TURN server (for example coturn). Without one, calls work on localhost and simple networks. Rooms are a full mesh capped at 8 speakers; larger rooms need a media server such as LiveKit.
- **The library.**
  - `pnpm --filter @morrow/api import-classics` imports the public-domain books.
  - `pnpm --filter @morrow/api import-articles` imports the CC BY and CC0 articles.
  - Both take `--sample` (offline) and `--replace`.

`.env.example` documents every variable. It contains no real values, and secrets never go into the repository.

## Demo data and screenshots

```sh
pnpm --filter @morrow/api seed-demo      # with the stack running
```

This gives you a lived-in Morrow, all of it invented (no real people or books):

- **The team.** 12 real accounts writing _The Salt Orchard_ together. Sign in as `ama@demo.morrow.test`, password `morrow demo password`.
- **The crowd.** 240 more writers and readers, and 24 published works with covers.
- **Engagement.** Likes, reads, comments (some on single paragraphs), follows, saves, badges and streaks.
- **Waiting for Ama.** A reader poll, pending proposals and collaboration requests, and a full Activity page.

The images in this README are real screenshots of that data, set in mockups:

```sh
cd apps/web
pnpm exec playwright test -c playwright.showcase.config.ts capture   # 12 browsers in one chapter, then the tour
pnpm exec playwright test -c playwright.showcase.config.ts compose   # the mockups, in docs/images
```

## Testing

```sh
pnpm typecheck && pnpm lint
pnpm test                        # unit and integration tests (needs the Docker Postgres)
pnpm --filter @morrow/web exec playwright install chromium
pnpm --filter @morrow/web exec playwright test   # end to end, with the stack running
```

- **Integration tests** use real PostgreSQL, not mocks. Each test file gets its own throwaway database; set `TEST_DATABASE_URL` to use a different server.
- **End-to-end tests** cover live co-writing, proposals and merges, voice rooms (with fake microphones), publishing, reading, moderation and the phone layout. Every screen they visit is checked with axe.

## Contributing

See **[CONTRIBUTING.md](CONTRIBUTING.md)**. In short:

- never lose a writer's words
- authorization lives in one place
- only collab writes document content
- no HTML as content
- no secrets in the repository

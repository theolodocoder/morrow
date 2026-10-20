# Morrow for teams and organisations

For publishing houses, newsrooms, agencies, universities and research groups: the people who write together for a living, and who need to trust where their words live.

This page separates **what exists today** from **what's on the roadmap**. Everything in the first half is in this repository and covered by its tests.

---

## Why teams choose Morrow

### 1. Real-time co-writing that never loses a word

- **No overwriting.** Documents are CRDTs (Yjs). Any number of people can write in the same chapter at once, offline edits merge when they reconnect, and nobody overwrites anyone.
- **Writes merge.** Only the collaboration service writes content, and it merges every write into what's stored (`DocumentStore`).
- **History.** Snapshots are taken automatically, people can name versions, and a restore can itself be undone.
- **Context while you write.**
  - Presence shows who's in the chapter.
  - Each person's caret carries their name.
  - Comment threads with @mentions sit on the exact passage.
  - Reactions sit on the exact paragraph.
  - Voice rooms let a team talk while they write.

### 2. Editorial control: proposals, review and branches

- **Three collaboration modes per work:**
  - editors and collaborators write directly
  - editors write and everyone else proposes
  - only the owner writes
- **Proposals:**
  - Changes are made in a private copy of the chapter; nothing reaches the manuscript until a reviewer accepts.
  - Each proposal moves through a state machine (draft, submitted, in review, changes requested, accepted or rejected) and keeps a history.
  - Reviewers see the changes word by word.
  - Overlapping changes are detected, and a clash is never resolved silently.
- **Branches** for alternative versions, compared chapter by chapter and merged back, with a conflict path that keeps every paragraph accounted for.
- **Credit.** Every accepted contribution credits its author. Attribution comes from server-side edit sessions, never from data a browser sends.

### 3. One access policy, enforced twice

- **One policy.** A single pure function, `can()` in `packages/domain`, decides every permission:
  - 5 roles: owner, editor, collaborator, contributor and viewer
  - 3 collaboration modes
  - participation settings for people outside the work
- **Enforced twice:**
  - The API checks it on every route.
  - The collaboration service checks it again when a socket connects, using a ticket signed for 60 seconds.
  - Read-only stays read-only, even on the WebSocket.
- **Forbidden looks like missing.** Anyone without access gets a 404, so nothing leaks about what exists.
- **The UI never decides access.** It shows what the server says you can do.

### 4. Security by default

- **Content Security Policy:** nonce-based, with `strict-dynamic`, so injected scripts can't run.
- **Requests:** same-site, HTTP-only cookies, plus a strict Origin check on every request that changes state.
- **Rate limits:** overall, per sign-in, per public preview, and per sensitive action (invitations, reports, contribution requests, exports, account deletion).
- **Two-factor authentication** (TOTP) for everyone, and required for staff in the admin console.
- **No HTML as content.** Documents are rendered from a strict schema; links are checked against an allowlist of safe schemes.
- **Permissions-Policy:** tight. The microphone is allowed on Morrow's own pages only, for voice rooms.
- **Secrets** never go into the repository. Internal calls between services are HMAC-signed.

### 5. Audit trail and moderation

- **Audit trail.** Changes to visibility, membership, roles, publishing, proposals and merges are written as activity events, in the same transaction as the change. The same outbox feeds notifications, so nothing is announced that didn't happen.
- **Moderation:**
  - people can report works, comments and proposals
  - staff work through a review queue in the admin console
  - staff can hide and restore works, and suspend or mute accounts
  - appeals are decided by a second reviewer, and every decision is recorded
- **Safety:** blocking applies everywhere (comments, invitations, contribution requests, voice). There are spam checks on comments and proposals.

### 6. Privacy and data rights

- **Private by default.** Making a work public is an explicit, audited step, and unlisted works are kept out of search engines.
- **Data export.** People can download everything that's theirs as JSON: profile, every chapter they own, comments, proposals, follows, likes and settings.
- **Real deletion.** Shared works pass to the next person on them (an editor first), so collaborators never lose their writing. Works only you have are deleted; your sign-in, sessions, profile and personal traces are erased.
- **Notifications** are set per category, with quiet hours in your own time zone.

### 7. Accessibility

- **WCAG 2.2 AA:** every screen the end-to-end suite visits is checked with axe.
- **Keyboard:** keyboard-only flows are tested end to end.
- **Contrast:** design tokens carry automated contrast tests.
- **Motion:** reduced motion is respected everywhere. Animations move rather than fade, so text never drops below contrast while it's animating.

### 8. Plans and entitlements

- **Enforced on the server:** limits on private works, people per work and branches per work.
- **Staff can comp plans,** and billing can stay off until it's needed, with webhook signatures verified when it's on.

---

## Built for scale

- **Collaboration never loses edits.** Collab persists to PostgreSQL with merge-on-write, so a restart, a redeploy or a second instance can't drop anyone's writing. Live fan-out between several collab instances (Redis) is on the roadmap; today a document's live session is served by one instance.
- **Background work is shared.** The outbox worker uses `FOR UPDATE SKIP LOCKED`, so several API instances share the work.
- **Lists are cursor-paginated** with limits. Creates accept an `Idempotency-Key`, so a retried request never creates two works.
- **Reads are cheap.** Feed counts are denormalised and updated in the same transaction as the change. Discover has a short per-instance cache.
- **Tested with real data.** Integration tests run against real PostgreSQL, and the demo seed loads hundreds of people and tens of thousands of reads, to test with realistic data.

---

## On the roadmap

These are **not built yet**. They're the next things an organisation would ask for:

| Area                     | Plan                                                                                                 |
| ------------------------ | ---------------------------------------------------------------------------------------------------- |
| Single sign-on           | SAML 2.0 and OIDC (Okta, Azure AD, Google Workspace), enforced per organisation                      |
| Provisioning             | SCIM 2.0, so joining and leaving the company adds and removes access automatically                   |
| Organisations            | Workspaces with admins, shared libraries, default roles and policies, organisation-wide audit export |
| Horizontal collab        | Redis-backed fan-out, so one document's live session can span several collab instances               |
| Large voice rooms        | A media server (LiveKit) beyond 8 speakers, plus managed TURN                                        |
| Data residency           | Region-pinned storage and backups                                                                    |
| Retention and legal hold | Per-organisation retention rules, and holds that override deletion                                   |
| Compliance               | SOC 2 Type II and an independent penetration test (not started)                                      |
| Uploads                  | Image covers, figures and comic art, with storage and automated image moderation                     |

Questions about any of these are welcome. Tell us which ones matter first.

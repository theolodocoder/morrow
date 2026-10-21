# Published Reading Experience Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn a published Morrow work into a finished, Hearth-style reading experience: generous typography, chapter openers, an Up next / pick-a-path chapter end, chapter discussion, a front page with credits and contents, and resume-to-the-paragraph.

**Architecture:** API first (credits stored at publish time, alternate versions in their own table, chapter discussion and reading positions), then the web reader rebuilt around the existing `ReaderFrame`, `RichText` and comment components. Alternate versions live in a new `alternate_publications` table so every existing query on `publications` keeps meaning "the main story" untouched.

**Tech Stack:** Fastify + Zod contracts (`@morrow/contracts`), Drizzle/Postgres (`@morrow/db`, migrations via `pnpm --filter @morrow/db generate`), Next 16 app router + React Aria (`apps/web`), tokens (`@morrow/tokens`), Vitest (API, real Postgres via `apps/api/test/setup.ts`), Playwright + axe (`apps/web/e2e`).

**Spec:** `docs/superpowers/specs/2026-10-20-published-reading-experience-design.md` (read it first; "Calls made in design" are binding).

## Global Constraints

- CLAUDE.md applies: tokens only, no raw colours outside `packages/tokens`; `can()` on the server, forbidden → 404; work-scoped tables carry `work_id`; lists cursor-paginated; tests for business logic and every permission rule against real Postgres; accessibility is part of done.
- **Do not commit or push** unless the owner has asked for commits on this branch (CLAUDE.md). Work on a branch off `main` (e.g. `feat/reading-experience`), not on `main`.
- Body text: Literata **18px** phones, **20px** ≥1024px (tablet 19px), line-height **1.6**, measure **65ch**.
- Motion 150–250 ms ease-out (`var(--motion-base)`), none under `prefers-reduced-motion`.
- Reading time = words / **230** wpm (the existing rule on the work page).
- Never auto-load the next chapter; no infinite scroll across chapters.
- Credits threshold: **≥ 20** summed `edit_sessions.update_count` on a chapter's document, sessions started before the publish; Yjs client ids never used for credit.
- Teaser: first paragraph's plain text, **≤ 200 characters**, cut at a word boundary with "…".
- Signed-out reading must keep working everywhere (no endpoint the reader needs may require auth, except the reading-position endpoints, whose failure is silent).

## Review Focus

1. **An alternate whose divergence chapter isn't in the live main publication** (main unpublished, chapter deleted, or alternate branched from a non-main branch): publishing it must be refused with a clear 409, never publish a dangling version. → Task 4 test `refuses an alternate that doesn't branch from the published main story`.
2. **Main republished / unpublished with alternates live:** republish keeps alternates; unpublish takes them down; archiving the branch takes its alternate down. → Task 4 tests.
3. **Empty or image-free chapters** (no paragraph text, 0 words): teaser `null`, time-left shows nothing rather than "0 min", Up next still works. → Task 3 test `teaser is null for a chapter with no text`, Task 8 test.
4. **Poetry and non-fiction forms:** no drop cap and no indent on poetry; essays/papers say "Part"/"Section" or nothing for single pieces. → Task 7 tests.
5. **Signed-out reader with stale localStorage** (positions for chapters that were renamed or removed): resume falls back to the chapter start, never throws. → Task 12 test.

---

### Task 1: Reader tones from tokens

**Files:**
- Modify: `packages/tokens/src/index.ts` (add `sepia: Theme`), `packages/tokens/scripts/build-css.ts`
- Modify: `apps/web/src/app/globals.css` (delete the raw-hex `.reader[data-tone]` block, ~:988–1030)
- Test: `packages/tokens/test/contrast.test.ts`

**Interfaces:**
- Produces: CSS selectors `.reader[data-tone='paper']` (always the `light` vars, even in OS dark mode), `.reader[data-tone='sepia']` (`sepia` vars), `.reader[data-tone='night']` (`dark` vars), emitted into `tokens.css`. Sepia primitives: `sepia50 #F4ECD8` (canvas), `sepia100 #EADFC6` (app/hover), `sepiaInk #3B2F22` (text-primary); other sepia roles derived to pass contrast.

- [ ] **Step 1:** Extend `contrast.test.ts`: for `sepia`, `text-primary`/`text-secondary` on `bg-canvas` ≥ 7:1 and ≥ 4.5:1, `text-accent` and `action-primary-fg` on `action-primary-bg` ≥ 4.5:1 (same helper the light/dark cases use).
- [ ] **Step 2:** Run `pnpm --filter @morrow/tokens test` → FAIL (`sepia` not exported).
- [ ] **Step 3:** Add `sepia: Theme` and the three tone blocks to `build-css.ts`; remove the raw-hex tone block from `globals.css`.
- [ ] **Step 4:** Run tokens tests → PASS; `pnpm --filter @morrow/web typecheck`; existing `e2e/mobile.spec.ts` reading-settings test still passes (`pnpm exec playwright test e2e/mobile.spec.ts` with the stack up).

### Task 2: Credits stored at publish time

**Files:**
- Modify: `packages/db/src/schema.ts` (`publications.credits jsonb not null default '[]'`), new migration via `pnpm --filter @morrow/db generate`
- Create: `apps/api/src/credits.ts`
- Modify: `apps/api/src/routes/publishing.ts` (publish computes credits; `GET /works/:publicPath` and chapter route return them), `packages/contracts/src/index.ts`
- Test: `apps/api/test/publishing.test.ts`

**Interfaces:**
- Produces: `type CreditRole = 'author' | 'cowriter' | 'contributor'`; `chapterCredits(db, { workId, ownerId, chapterId, documentId, before: Date }): Promise<{ userId: string; role: 'cowriter' | 'contributor' }[]>` in `credits.ts`.
- Contracts: `PublicCredit = { person: PublicPerson, role: CreditRole, chapters: number[] }` (1-based chapter numbers, empty for author); `PublicWork.credits: PublicCredit[]` (author first, then cowriters, then contributors, each by name); `PublicChapter.credit: PublicPerson[]` (the chapter's author + cowriters, owner first). Keep `PublicWork.contributors` (derived from credits) for existing callers.

- [ ] **Step 1: Failing tests** in `publishing.test.ts`:
  - `credits a co-writer per chapter only past 20 edits made before publishing`: member A has sessions summing 25 on chapter 2's document, member B 5 on chapter 1; publish → `credits` = `[{role:'author', person: owner}, {role:'cowriter', person:A, chapters:[2]}]`; B absent. Then insert a session for B with 30 updates **after** the publish and re-read: unchanged.
  - `credits accepted-proposal authors as contributors`: accepted proposal author → `{role:'contributor', chapters:[1]}`.
  - `chapter credit line names the chapter's writers`: chapter 2's `credit` = `[owner, A]`.
- [ ] **Step 2:** `pnpm --filter @morrow/api exec vitest run test/publishing.test.ts` → FAIL.
- [ ] **Step 3:** Implement `chapterCredits` (sum `update_count` per user where `started_at < before`, threshold 20, owner excluded; accepted proposals on the chapter → contributor unless already cowriter); publish stores `credits` per publication row; read routes assemble `credits`/`credit` with `peopleByIds`.
- [ ] **Step 4:** Tests PASS; full API suite `pnpm --filter @morrow/api test` PASS.

### Task 3: Up next teaser on the chapter

**Files:**
- Modify: `apps/api/src/routes/publishing.ts` (chapter route), `packages/contracts/src/index.ts`
- Create: `packages/editor/src/opening.ts` (export from `index.ts`)
- Test: `packages/editor/test/opening.test.ts`, `apps/api/test/publishing.test.ts`

**Interfaces:**
- Produces: `openingLine(doc: unknown, max = 200): string | null` — plain text of the first block with text, cut at a word boundary ≤ `max` with `…`; `null` when no text. Contract: `PublicChapter.next` gains `opening: string | null` (other summaries unchanged).

- [ ] **Step 1:** Unit tests: short paragraph returned whole; 300-char paragraph → ≤ 201 chars ending `…` at a space; doc with only a scene break / empty → `null`; skips leading empty paragraphs.
- [ ] **Step 2:** API test `the next chapter's opening line comes with the chapter` and `teaser is null for a chapter with no text`.
- [ ] **Step 3:** Run both → FAIL; implement (load the next publication's snapshot `content_json`); run → PASS.

### Task 4: Publishing alternate versions (owner-only)

**Files:**
- Modify: `packages/db/src/schema.ts` — new `alternate_publications` table (same columns as `publications` incl. `credits`, plus `afterPosition byteOrderedText` = position of the last shared main chapter), migration
- Create: `apps/api/src/routes/alternates.ts` (register beside `publishingRoutes` in `apps/api/src/app.ts`)
- Modify: `apps/api/src/routes/publishing.ts` (unpublish also supersedes alternates), `apps/api/src/routes/branches.ts` (archive supersedes the branch's alternate), `packages/contracts/src/index.ts`
- Test: `apps/api/test/alternates.test.ts` (new file, `setup('alternates')`)

**Interfaces:**
- Consumes: `chapterCredits` (Task 2).
- Produces: `POST /works/:workId/branches/:branchId/publish-alternate` → `AlternateStatus { branchId, name, published: boolean, chapterCount }`; `POST .../unpublish-alternate`; `GET /works/:workId/alternates` → `{ items: AlternateStatus[] }` (for the editor). All require `work.publish` (forbidden → 404 for non-members, per existing `requireWork`). `liveAlternates(db, workId): Promise<Map<branchId, rows[]>>` exported from `alternates.ts`.
- Rules (spec calls 1–3): branch must have `parentBranchId` = the published main branch (`publishedBranch`) and a `divergesAtChapterId` that is in main's **live** publication; publishes the branch's chapters whose `originChapterId` is the divergence chapter or later in main's order, plus chapters with no origin positioned after them; `afterPosition` = position of the main chapter before the divergence. Publishing requires the work to be published.

- [ ] **Step 1: Failing tests:** owner publishes alternate → only diverging chapters pinned; editor without `work.publish` (collaborator) → 404; branch author who is not owner → 404; `refuses an alternate that doesn't branch from the published main story` (409); `republishing main keeps alternates live`; `unpublishing the work takes alternates down`; `archiving the branch takes its alternate down`; republishing an alternate supersedes its previous rows only.
- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement. **Step 4:** Run file + full API suite → PASS (existing `publications` queries untouched).

### Task 5: Reading alternate versions publicly

**Files:**
- Modify: `apps/api/src/routes/publishing.ts` (public work + chapter routes), `apps/api/src/routes/social.ts` (`publishedChapterId` resolves alternate chapters too), `packages/contracts/src/index.ts`
- Test: `apps/api/test/alternates.test.ts`

**Interfaces:**
- Consumes: `liveAlternates` (Task 4), `openingLine` (Task 3).
- Produces: `PublicWork.versions: { name, slug, premise /* branch.description */, author: PublicPerson, afterChapter: number /* 1-based main chapter it follows */, chapters: PublicChapterSummary[], wordCount }[]`. `PublicChapter` gains `version: { name, slug } | null` (null on main) and `alternates: { name, slug, premise, author, firstChapter: PublicChapterSummary & { opening } , chapterCount }[]` — non-empty only on the main chapter at `afterChapter`. On an alternate chapter, `prev`/`next` walk main chapters up to `afterChapter` then the alternate's own; its `index` counts the shared chapters.

- [ ] **Step 1: Failing tests:** public work lists the version; main chapter 3 (the fork) carries `alternates[0]` with premise, author and opening; alternate's first chapter has `prev` = main chapter 3 and `version.slug`; reader comment on an alternate chapter's paragraph is accepted (resolves via `publishedChapterId`); after unpublishing the alternate its chapter slug → 404.
- [ ] **Step 2–4:** FAIL → implement → PASS (file + full API suite).

### Task 6: Chapter discussion API

**Files:**
- Modify: `apps/api/src/routes/social.ts` (GET/POST `/reading/:publicPath/comments`), `packages/contracts/src/index.ts`
- Test: `apps/api/test/social.test.ts`

**Interfaces:**
- Produces: `GET /reading/:publicPath/comments?chapter=<slug>` (no `block`) → all top-level comments on that chapter, paragraph ones included; each `ReaderCommentBase` gains `quote: string | null` (the block's plain text from the **published snapshot**, ≤ 280 chars, `null` for chapter-level comments or a block no longer in the text). Without `chapter`, the whole-work list is comments with `chapter_id IS NULL` (previously `block_id IS NULL`). `POST` accepts `chapterSlug` without `blockId` (a chapter comment). `chapter`+`block` behaviour unchanged.

- [ ] **Step 1: Failing tests:** `a chapter comment shows in its chapter, not on the work page`; `paragraph comments appear in the chapter discussion quoting their line`; `whole-work comments stay on the work page`; quote is `null` when the block id isn't in the snapshot.
- [ ] **Step 2–4:** FAIL → implement → PASS.

### Task 7: Reading typography, chapter opener, forms

**Files:**
- Modify: `apps/web/src/app/globals.css` (`.manuscript` sizes/leading/measure per Global Constraints; drop-cap rule `.reading-body[data-dropcap] > p:first-of-type::first-letter` with `@supports (initial-letter: 3)` and a float fallback; no drop cap / no indent for `[data-form='poetry']`)
- Create: `apps/web/src/components/reader/chapter-opener.tsx`, `packages/domain/src/reading.ts` (export from `packages/domain/src/index.ts`; pure helpers shared by web, tested in the domain package, since `apps/web` has no unit-test runner)
- Modify: `apps/web/src/app/works/[workSlug]/read/[chapterSlug]/page.tsx`
- Test: `packages/domain/test/reading.test.ts` (`pnpm --filter @morrow/domain test`), e2e in Task 14

**Interfaces:**
- Produces: `sectionLabel(form: (typeof WORK_CATEGORIES)[number], index: number, total: number): string | null` → fiction forms `"Chapter three"` (words up to twenty, then digits), article/essay/educational/general_document `"Part 2"`, research_paper `"Section 2"`, any form with `total === 1` → `null`. `minutesFor(words: number): number` (ceil(words/230), min 1; 0 words → 0). `<ChapterOpener label title credit={PublicPerson[]} />` set ~33vh from the top, credit line "Ama Owusu, with Tolu Ade" (+ "and N others" past 3) with stacked avatars.

- [ ] **Step 1:** Unit tests for `sectionLabel` (each form, single piece, chapter 21 → "Chapter 21") and `minutesFor` (0 → 0, 1 → 1, 460 → 2).
- [ ] **Step 2–4:** FAIL → implement → PASS; visually check the chapter page at 375px and 1280px in the browser pane (opener, drop cap, poetry chapter without drop cap).

### Task 8: Running head with time left; keyboard chapter keys; Aa additions

**Files:**
- Modify: `apps/web/src/components/reader/reader-frame.tsx`, `apps/web/src/components/reader/reading-progress.tsx`
- Test: `packages/domain/test/reading.test.ts`

**Interfaces:**
- Produces: `minutesLeft(words: number, progress: number /*0..1*/): number | null` in `packages/domain/src/reading.ts` (null when words is 0; rounds up; 0 at the end → null so nothing shows). Running head shows `"{n} min left in chapter"`. `Prefs` gains `leading: 'normal' | 'roomy'` (1.6 / 1.85) and `marginComments: boolean` (default `false`); exported `useReaderPrefs()` hook from `reader-frame.tsx` for Tasks 10/12. `→`/`←` navigate to `next`/`prev` chapter when focus isn't in an input/textarea/contenteditable.

- [ ] **Step 1:** Unit tests for `minutesLeft` (0 words → null; 2300 words at 0.5 → 5; at 1 → null).
- [ ] **Step 2–4:** FAIL → implement → PASS; in the browser: chrome hides on scroll down, returns on scroll up; `→` at the chapter end opens the next chapter; Aa shows the two new controls, keyboard-operable, persisted.

### Task 9: Chapter end — Up next, pick-a-path, the end

**Files:**
- Create: `apps/web/src/components/reader/chapter-end.tsx`
- Modify: the chapter page (replace the ⁂/actions/prev-next stack; keep `PollCard`, `SuggestButton`, `WorkActions` below the card)

**Interfaces:**
- Consumes: `PublicChapter.next.opening`, `.alternates`, `.version` (Tasks 3, 5); `PublicWork.completed`, `releaseDay` (existing `ReleaseCountdown`).
- Produces: `<ChapterEnd work chapter label />` rendering, in order: "End of {label lowercased}" (Instrument Serif italic), reactions row (existing like + chapter comment count linking `#discussion`), then exactly one of: **Up next** card (label, minutes via `minutesFor`, title, opening in italic if non-null, "Keep reading" link with `rel="next"`); **Pick a path** ("The story splits here. Which way?"; main card first and highlighted, then each alternate with author avatar + "{name}'s version · N chapters" and premise; footnote "You can come back and read the other way any time"); **The end** (complete work: "The end", credits summary, follow writer); **More soon** (ongoing, last chapter: follow + `ReleaseCountdown`). Copy exactly as quoted here.

- [ ] **Step 1–3:** Build; verify each of the four states in the browser against the mockup (seed: a 3-chapter work, an alternate after chapter 2, complete and ongoing variants); axe clean on the chapter page.

### Task 10: Chapter discussion UI; paragraph comments off by default

**Files:**
- Create: `apps/web/src/components/reader/chapter-discussion.tsx`
- Modify: `apps/web/src/components/reader/paragraph-comments.tsx` (render markers only when `useReaderPrefs().marginComments`), `apps/web/src/components/public/reader-comments.tsx` (extract the thread/composer pieces it already has for reuse rather than duplicating them)

**Interfaces:**
- Consumes: Task 6 API, `useReaderPrefs` (Task 8).
- Produces: `<ChapterDiscussion publicPath chapterSlug label />` with `id="discussion"`: heading "Talk about {label lowercased}", composer "Share a thought…" (signed-out → existing join prompt), list with quoted line (`quote`) above paragraph comments, "Writer" tag, load more; footer toggle "Show comments next to paragraphs while reading" bound to `marginComments`.

- [ ] **Step 1–3:** Build; verify: chapter comment posts and appears only in its chapter; a paragraph comment shows quoted; margin markers hidden until the toggle is on; keyboard + axe clean.

### Task 11: Front page of a work

**Files:**
- Modify: `apps/web/src/app/works/[workSlug]/page.tsx`
- Create: `apps/web/src/components/public/work-credits.tsx`, `apps/web/src/components/public/work-contents.tsx`

**Interfaces:**
- Consumes: `PublicWork.credits`, `.versions` (Tasks 2, 5), reading positions (Task 12, via a client component that reads them; signed-out → localStorage).
- Produces: hero (cover, title, one-line summary `"{Form} · N chapters · about {h} hours|{m} min · ongoing|complete"`, description), **Start reading** / **Continue · {chapter title} · {pct}%** button, note "Read without an account. Sign in to keep your place on every device." (signed-out only); **Written by** list with role text: Author / "Co-writer · chapters 3, 5" / "Contributor"; **Contents** rows (number, title, minutes; read rows `text-tertiary`, current row accent with "{pct}% read"; under a fork row: "↳ Also: “{name}”, {author}'s version from here" linking to the version's first chapter). Existing content notes, licence/open-access box, tags, date and whole-work comments move below Contents.

- [ ] **Step 1–3:** Build; verify against the mockup at 375px and desktop; classic/open-access works still show their original byline and licence box; axe clean.

### Task 12: Resume to the paragraph

**Files:**
- Modify: `packages/db/src/schema.ts` — `reading_positions (user_id text, work_id uuid, chapter_id uuid, block_id text, percent smallint, updated_at)`, PK `(user_id, work_id, chapter_id)`, migration
- Create: `apps/api/src/routes/reading-positions.ts` (register in `app.ts`), `apps/web/src/components/reader/use-reading-position.ts`
- Modify: `apps/web/src/components/reader/reading-progress.tsx` (replace slug-only storage), `packages/contracts/src/index.ts`
- Test: `apps/api/test/reading-positions.test.ts`, `packages/domain/test/reading.test.ts`

**Interfaces:**
- Produces API: `PUT /me/reading/:publicPath/positions` body `{ items: { chapterSlug, blockId: string | null, percent: 0..100 }[] }` (≤ 50 items; upsert keeps the **max** percent and the block at that max; unknown slugs ignored) → 204; `GET /me/reading/:publicPath/positions` → `{ items: { chapterSlug, blockId, percent }[], last: string | null /* most recently updated chapter */ }`. Signed out → 401 (client treats as "use device only").
- Produces web: `useReadingPosition(publicPath, chapterSlug)` — tracks the top-most visible `[data-block]` (IntersectionObserver) and scroll percent; writes localStorage `morrow:pos:{publicPath}` immediately and the server at most every 5 s and on `pagehide` (signed in); on mount scrolls to the saved block if it still exists, else stays at the top. After sign-in, the first load PUTs all local items (merge = furthest wins via the server rule). `mergePositions(local: Position[], server: Position[], liveSlugs: string[]): Position[]` pure helper in `packages/domain/src/reading.ts` (`Position = { chapterSlug: string; blockId: string | null; percent: number }`).

- [ ] **Step 1: Failing tests:** API — saves and returns; lower percent doesn't overwrite higher; another user can't read yours (each user sees only their own); unknown chapter slug ignored; signed out → 401. Web unit — `mergePositions` furthest wins; `stale localStorage entry for a removed chapter is dropped` (Review Focus 5).
- [ ] **Step 2–4:** FAIL → implement → PASS; in the browser: read halfway, reload → back at that paragraph; front page shows Continue with %.

### Task 13: Owner publishes alternates from the editor

**Files:**
- Modify: `apps/web/src/components/editor/publish-dialog.tsx`

**Interfaces:**
- Consumes: Task 4 endpoints.
- Produces: in the publish dialog (only when the work is published and the viewer has `work.publish`), a section **Alternate versions** listing branches from `GET /works/:workId/alternates` + branches eligible to publish, each with its premise and a **Publish version** / **Unpublish** button; ineligible branches show why ("Starts from a version readers can't see yet"). Uses the existing `api()` client and toast copy "Version published." / "Version unpublished."

- [ ] **Step 1–3:** Build; verify owner can publish/unpublish; a collaborator doesn't see the section; axe clean on the dialog.

### Task 14: End-to-end journey

**Files:**
- Create: `apps/web/e2e/reading-experience.spec.ts`

- [ ] **Step 1:** Spec `a reader starts, keeps reading, picks a path, joins the discussion, and resumes` — owner signs up, writes 3 chapters, a member co-writes chapter 2 (≥ 20 edits), a branch diverging at chapter 3 with a premise, publish + publish alternate; signed-out reader: front page shows credits with roles and the "↳ Also" line; Start reading → opener shows "Chapter one" and drop cap; end of chapter 1 shows Up next with chapter 2's opening; `→` goes to chapter 2; end of chapter 2 shows pick-a-path with the alternate's author; choosing it opens the alternate with `prev` back to main; reader signs in, posts a chapter comment, it appears in that chapter's discussion only; scroll halfway, reload → same paragraph in view; axe on front page, chapter page and chapter end returns no violations.
- [ ] **Step 2:** Run with the stack up: `pnpm --filter @morrow/web exec playwright test e2e/reading-experience.spec.ts` → PASS. Run the existing `phase1-publish-read`, `feed-social`, `mobile`, `participation` specs → PASS.

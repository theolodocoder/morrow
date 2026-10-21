# SDD ledger — plan: docs/superpowers/plans/2026-10-20-published-reading-experience.md

Spec: docs/superpowers/specs/2026-10-20-published-reading-experience-design.md
Branch: feat/reading-experience (from main 6d8c85c). Working tree carries the owner's uncommitted fixes from earlier today (y-tiptap patch, presence, notifications…): implementers commit ONLY their own paths (`git commit -- <paths>`), never `git add -A`/`.`.

Ruling: local commits on feat/reading-experience only, no push, no AI trailers — CLAUDE.md says "don't commit unless asked" but SDD review needs commit ranges; owner chose subagent-driven — cost if wrong: owner squashes/resets the branch.

## Pre-flight scan

| Pair / task | Produces → consumes | Finding |
|---|---|---|
| T2 → T4 | `chapterCredits` → alternates credits | ok (T2 first) |
| T3 → T5 | `openingLine` → alternates firstChapter.opening | ok |
| T4 → T5 | `liveAlternates` → public versions | ok |
| T5 ↔ T6 | both edit social.ts; T5 changes `publishedChapterId`, T6 uses it | ok (sequential) |
| T2/T3/T4/T5 | all edit publishing.ts + contracts | ok (sequential) |
| T2/T4/T12 | each adds a migration via `generate` | ok (sequential numbering) |
| T6 → T10 | `quote`, chapter list → ChapterDiscussion | ok |
| T7 → T8/T9/T12 | domain `reading.ts` grows: sectionLabel/minutesFor → minutesLeft → mergePositions | ok |
| T8 → T10 | `useReaderPrefs().marginComments` | ok |
| T11 ← T12 | T11 consumes reading positions produced by T12, but T12 is ordered after T11 | **conflict** |
| T4 | test "collaborator → 404" vs existing `requireWork` (members lacking a capability get 403, non-members 404) | **conflict** |
| T9/T10/T11/T13 | UI tasks specify browser verification + axe, no unit tests | noted |
| T1 | contrast test + CSS emission; self-consistent | ok |
| T2 | stored credits + "session after publish doesn't change credits" test consistent | ok |
| T3, T5, T6, T7, T8, T12, T14 | tests match specified code/files | ok |

Ruling: run Task 12 before Task 11 — T11 consumes T12's positions API and hook — cost if wrong: none (order only).
Ruling: T4 permission tests assert the existing `requireWork` behaviour (member without `work.publish` → 403, non-member → 404) rather than "404" — consistency with every existing route beats the plan's wording; CLAUDE.md's "forbidden → 404" is already implemented this way repo-wide — cost if wrong: one status code to flip.
Ruling: UI tasks (9, 10, 11, 13) are verified in the browser pane + axe and covered by Task 14's e2e journey; no unit-test harness is added to apps/web — cost if wrong: a UI regression is caught at T14 rather than per task.

## Progress
Task 1: dispatched (base 6d8c85c, implementer ad17c39998010af77, sonnet)
Task 1: implemented 3ecd638 (DONE_WITH_CONCERNS: @theme→@theme inline; mobile.spec editor-section timeout not chased); review dispatched a4e4ca116f0cf2bab
Task 1: ⚠️ resolved — mobile.spec fails at the editor's phone toolbar because the Next dev-overlay portal intercepts the click (server runs `next dev` since this morning; suite was written for `next start`), not Task 1. Ruling: waive the mobile.spec gate for T1; run T14's e2e (incl. mobile/reading settings) against a production build (`next build && next start`) — cost if wrong: a tone regression in the Aa popover surfaces at T14.
Task 1: minor (deferred): no test pins build-css tone blocks (paper-stays-light); overscroll shows OS-theme bg outside .reader; sepia bg-hover == bg-app.
Task 1: complete (commits 6d8c85c..3ecd638, review clean)
Task 2: dispatched (base 3ecd638, implementer a76bf4552159b9672, opus)
Task 2: implemented b5acb05 (concerns: existing publications get credits=[] until republish; one test raised to 21 edits; mixed roles collapse to cowriter; contributors order changed)
Task 2: review → Needs fixes (Important: no backfill, already-published works lose credits)
Task 2: minor (deferred): in-flight edit sessions (row written on disconnect) not credited at publish; N+1 queries per chapter at publish; untested owner-exclusion/mixed-role/late-proposal cases; cowriter+contributor collapses dropping contributor chapters; redundant Set in credits.ts:64-67.
Task 2: fix round 1/5 (2 addressed, 0 open — backfill migration 0025 + 19/20 boundary test; commits b5acb05..572ece3)
Task 2: complete (commits 3ecd638..572ece3, review clean)
Task 3: dispatched (base 572ece3, implementer a55a457e13c381398, sonnet)
Task 3: implemented 3bfc98b
Task 3: minor (deferred): openingLine slices UTF-16 units (can split a surrogate pair in no-space fallback; no CJK/emoji/exact-max tests); "first block with text" (a heading/list can become the teaser); non-null assertion + duplicate snapshot select in chapter route; null-teaser test inserts projection by hand.
Task 3: complete (commits 572ece3..3bfc98b, review clean)
Task 4: dispatched (base 3bfc98b, implementer a8254236bfb70dd13, opus)
Task 4: implemented abb4b34 (concerns: chapter-1 divergence refused 409; owner may pick divergesAtChapterId in body; checks against live main rows; carry to T5: skip alternates whose afterPosition isn't a live main position; concurrent publish race same as main)
Task 4: minor (deferred): publish↔unpublish/archive race (no in-tx re-check of publishedAt/archivedAt; no unique live constraint); "shared" judged by live chapter positions vs frozen main publication positions; test gaps (origin-less chapter before shared, deleted divergence copy, bogus body divergesAtChapterId, archived branch, hidden work); unpublish-alternate with nothing live still logs activity; _journal.json trailing newline.
Task 4: Ruling: (from minor 3, load-bearing) Task 5's public reader shows an alternate only if its branch's parentBranchId is the branch of main's live publication AND its afterPosition equals a live main publication position; otherwise it is silently omitted — keeps Call 3 (alternates stay live) without readers seeing dangling forks — cost if wrong: an orphaned alternate is invisible until the owner republishes it.
Task 4: complete (commits 3bfc98b..abb4b34, review clean)
Task 5: dispatched (base abb4b34, implementer ab5274b860c70b7f1, opus)
Task 5: implemented b20e3ab (concerns: publishing.ts↔alternates.ts import cycle; slug-suffix collision → main wins; version counts own chapters only; alternate cowriters not in work credits)
Task 5: minor (deferred): publishing.ts↔alternates.ts import cycle (safe now, fragile); afterPosition positional match could re-attach after reorder; 6-char slug-suffix collisions resolve to first; versions[].wordCount is own-chapters only; test types hand-written; polls on alternate chapters unsupported (polls.ts own lookup).
Task 5: complete (commits abb4b34..b20e3ab, review clean)
Task 6: dispatched (base b20e3ab, implementer ac581202fd2d542ba, sonnet)
Task 6: implemented 61ff37d (replies quote:null; unknown chapter w/o block → 404; 2 extra small queries)
Task 6: minor (deferred): no test that quote comes from published snapshot vs draft / alternate chapter / 280 truncation / nested block / chapter-list pagination; duplicate live-row lookups per request; block-without-chapter → 404 and POST blockId-without-chapterSlug silently becomes whole-work comment.
Task 6: Ruling: (minor 4, load-bearing for UI) Task 10 also (a) points reader-comment notifications/dashboard links for chapter comments at the chapter's discussion (`/works/<path>/read/<chapterSlug>#discussion`) instead of the work page, and (b) the work page shows the count of its own (whole-work) thread rather than the work-wide `total` — cost if wrong: small link/count mismatch.
Task 6: complete (commits b20e3ab..61ff37d, review clean)
Mockups for UI tasks copied to mockups/ (Hearth = mockup 1 card A; chapter end + pick-a-path = 2; front page + discussion = 3).
Env: branch API now on :4010 (node --watch, WEB_ORIGIN=localhost:3000); web :3000 points at it via launch.json morrow-web; dev DB migrated to 0026. Old API :4000 (other session) untouched.
Task 7: dispatched (base 61ff37d, implementer addb08f38582ee44a, opus)
Task 7: implementer cut off by network error mid-task (uncommitted partial work); resumed same agent
Task 7: implemented 0dbffca (concerns: WORK_CATEGORIES moved to domain, re-exported by contracts; poetry labelled 'Chapter one'; editor shares .manuscript so it also gets 18/19/20 + 65ch; old readingMinutes helpers still floor at 1; seeded dev-DB credits for screenshots)
Task 7: minor (deferred): editor header/empty-state and proposal views still max-w-[68ch] vs .ProseMirror 65ch; drop cap keys on p:first-of-type (heading-first articles; short first paragraph overhang); domain exports an unused WorkCategory type; reader size 's' is 16px (reader choice).
Task 7: Ruling: poetry (and 'other') keep the "Chapter N" label — spec names only fiction/Part/Section; one-line change if the owner prefers e.g. "Poem one" — cost if wrong: a label tweak + its test.
Task 7: Ruling: reading-time duplication (format.ts readingMinutes / work-page minutes vs domain minutesFor) is resolved by switching reader/work-page callers to minutesFor in Tasks 8/9/11 as they touch them — cost if wrong: minute counts differ by one between pages.
Task 7: complete (commits 61ff37d..0dbffca, review clean)
Task 8: dispatched (base 0dbffca, implementer ae7fef77a84645554, sonnet)
Task 8: implemented e20f9f8 (concerns: TDD not RED-first for minutesLeft; only 1-min case seen live)
Task 8: review → Needs fixes (Important: resize un-hides head during mobile downward scroll; tap/focus-to-reveal missing)
Task 8: ⚠️ resolved — gated preview: the public chapter API returns the full chapter to everyone (no P-044 truncation in the handler), so wordCount matches the rendered body.
Task 8: minor (deferred): arrow keys don't guard widgets owning arrows (radio/tab/slider/listbox) or isComposing; prefs flash on chapter change (pre-existing); load() doesn't validate stored prefs; context value not memoized; switch knob transition easing/reduced-motion + raw rgb shadow; no tests for inField/key handler; minutesLeft tests not written first.
Task 8: fix round 1/5 (2 addressed + 1 partially, 1 open — focus already inside head is hidden on scroll-down; commits e20f9f8..93ae1e9)
Task 8: fix round 2/5 (1 addressed, 1 new Important — mouse click focus pins head; commits 93ae1e9..d48fe6c)
Task 8: fix round 3/5 (1 addressed, 0 open — focus-visible guard; commits d48fe6c..7002238)
Task 8: minor (deferred): matches(':focus-visible') throws on engines without support (pre-Safari 15.4) inside the scroll handler — wrap in try/catch; Escape-closed Aa keeps head pinned (intended); INTERACTIVE list omits some ARIA roles.
Task 8: complete (commits 0dbffca..7002238, review clean)
Task 9: dispatched (base 7002238, implementer a341ec439631c445a, opus)
Task 9: implemented dfedee4 (DONE_WITH_CONCERNS)
Task 9: Ruling: WorkActions serves as the reactions row (like/comments/save/share) instead of a second like control below the card — two like buttons with separate state would be worse; spec's reactions row intent is met — cost if wrong: ~5-line move.
Task 9: Ruling: chapter comment count is added in Task 10 (chapter-scoped total in the discussion API, shown on the "Comments" link) — no per-chapter count exists yet — cost if wrong: link shows no number.
Task 9: Ruling: the trailing ⁂ ornament is removed (replaced by "End of chapter N"); in-text scene breaks keep their ornament — cost if wrong: re-add one line.
Task 9: review → Needs fixes (Important: alternate version's last chapter shows main's More soon/The end and no way back)
Task 9: Ruling: version-end state (spec gap) — on an alternate's last chapter render: heading End of “{version name}”, line "{author}'s version", a link "Read the main story from chapter {n}" to the main chapter right after the fork (when it exists), and "Back to contents" — keeps the reader oriented and never promises main-story releases on a finished branch — cost if wrong: copy tweak.
Task 9: minor (deferred): alternate-card avatar alt/duplication unverified; work-level likes under a chapter heading (accepted); #discussion anchor dead until Task 10.
Task 9: fix round 1/5 (2 addressed, 0 open — VersionEnd + path-length total; commits dfedee4..a8f01e0)
Task 9: ⚠️ resolved — sectionLabel never renders "of N"; total only drives the single-piece null rule, which a version can't hit.
Task 9: minor (deferred): non-null assertions in chapter-end.tsx:27,171; "Read the main story" pill 40px vs Keep reading 48px.
Note: the Task 9 re-reviewer attempted a stray hand_off_to_session call (denied by the permission classifier, no effect).
Task 9: complete (commits 7002238..a8f01e0, review clean)
Task 10: dispatched (base a8f01e0, implementer a51bf06a971c32483, opus; carries T6/T9 rulings: chapter count, own-thread total, notification links; owner's uncommitted hunks in notifications.ts/test must stay unstaged)
Task 10: implemented f1274b3, 98cfe44 (concerns: habits.spec edited, not run; reactions count refreshes on reload only; title prop added; signed-out sees existing join box)
Task 10: ⚠️ noted — notification/dashboard chapter-link lookup uses `publications` only, so comments on alternate-version chapters fall back to the work-page link (no wrong link, just less specific). Deferred minor.
Task 10: minor (deferred): thread total counts blocked users' comments while list hides them; no live refresh between discussion / paragraph sheet / reactions count; possible unhandled rejection in reader-comments load(); notification URL tests live in social.test.ts; habits e2e edit not run.
Task 10: Ruling: (minor 2) Task 11's rebuilt work page shows the whole-work thread count on its comments link (same number as the thread heading it jumps to) — cost if wrong: one number.
Task 10: complete (commits a8f01e0..98cfe44, review clean)
Task 12: dispatched (base 98cfe44, implementer a2a1e3f1d431c4ec1, opus; runs before Task 11 per ruling)
Task 12: implemented e65d754, 0460714; migration 0027 applied to dev DB. Exports for T11: loadReadingPositions(publicPath, liveSlugs) from @/components/reader/use-reading-position; useReadingPosition; Position/mergePositions in @morrow/domain; ReadingPositions in contracts. Concerns: signed-out 401 per load; restore may land 1 paragraph early; finished chapter opens at top; account export/delete include positions; PUT allowed for suspended accounts.
Task 12: review → Needs fixes (Important: sign-in merge >50 items fails forever silently; failed merge clears pending before success)
Task 12: Ruling: "Continue · {pct}%" display belongs to Task 11 (it rebuilds ContinueReading); loadReadingPositions already provides percent — cost if wrong: none.
Task 12: minor (deferred): restore waits on the auth GET with no timeout (also for signed-out); redundant PUT on every signed-in chapter open; signed-out 401 devtools noise; test gaps (suspended PUT, export/delete, concurrency, web hook); lazy per-work merge.
Task 12: fix round 1/5 (4 addressed, 0 open — aheadOf cap/stale drop, clear-after-2xx, coalesce tie, visibilitychange; commits 0460714..336f7c2)
Task 12: minor (deferred): permanent non-2xx (400/expired 401) retried every 5 s while page open; no automated test of hook retry/clear logic; strictly-further null-block save keeps older paragraph; liveSlugs serialized into every chapter page.
Task 12: complete (commits 98cfe44..336f7c2, review clean)
Task 11: dispatched (base 336f7c2, implementer a2df66af3d0eda0f0, opus; carries Continue·pct, own-thread comment count on WorkActions, minutesFor)
Task 11: implemented 2ed88a6 (calls: read ≥95% (READ_PERCENT); Continue advances past a finished chapter; category label in summary; classic/OA keep original byline; extras: ReaderComments initial prop, loadReadingPositions.signedIn, domain continueFrom)
Task 11: minor (deferred): "Continue · X · 0%" / "0% read" / finished-last shows 100% in accent; signedIn treats 429/5xx like 401 (shows sign-in note during outages); version progress not reflected on fork lines; roleOf/summaryOf untested, 0-word chapter "0 min"; credits key collides on duplicate display names; empty-work Contents heading; re-reading a finished chapter sends Continue onward.
Task 11: complete (commits 336f7c2..2ed88a6, review clean)
Task 13: dispatched (base 2ed88a6, implementer ab7d3b3fab09f3f9d, sonnet)
Task 13: implemented acf625a (concerns: picker lists draft chapters (server 409s); 'can't see yet' via branch-name match; collaborator check indirect)
Task 13: review → Needs fixes (Important: picker lists draft not published chapters; mainId lost when branchName null after in-dialog republish)
Task 13: minor (deferred unless folded): no in-flight label; section-level error; "Published" shown for unseen alternates; publish-dialog.tsx ~357 lines (AlternateVersions extractable); no automated test.
Task 13: fix round 1/5 (4 addressed, 0 open — published-chapter picker, resolved main branch, load-failure + disabled hint; commits acf625a..d08ec6c)
Task 13: minor (deferred): scroll wrapper may clip focus rings top/bottom (add py-1 -my-1); stale `pick` after republish; ambiguous mainBranchName gives misleading "needs a second chapter" hint; one failed request hides the whole list.
Task 13: complete (commits 2ed88a6..acf625a..d08ec6c, review clean)
Env (e2e, ruling from T1): production build served on :3020 (next start, .next shared dir with dev's .next/dev), API :4020 (WEB_ORIGIN 3020, collab internal 4021), collab :4021 (ALLOWED_ORIGINS 3020) — all on the dev DB; user's dev stack :3000/:4010/:4001 untouched.
Task 9: regression found pre-T14 — mobile.spec "reading settings" fails: `.reader` resolves to 2 elements because ChapterEnd's night card reuses the `.reader[data-tone='night']` class trick. Reopened Task 9 (fix round 2) on the original implementer.
Task 9: fix round 2/5 (1 addressed, 0 open — [data-tone-scope='night'] token scope, no second .reader; commit 934abc2). mobile.spec passes on prod build :3020.
Task 9: minor (deferred): saved tone applied after first paint (root cause of mid-fade axe hit; server-side tone would fix); transition removal is a stopgap; confirm Tailwind transitions honour --motion-* under reduced motion; build-css comment names only Up next.
Task 14: dispatched (base 934abc2, implementer abcc7463dc5e6320e, opus; e2e on prod :3020)
Task 14: implemented 24e9d54 (journey 1/1, 3/3 repeat; existing phase1/feed-social/mobile/participation/m2/editor-blocks all pass on :3020; concerns: resume via fresh tab; divergence picker path not exercised; credit timing; results are for working tree incl. owner's uncommitted edits)
Task 14: review → Needs fixes (Important: discussion-scope check can pass before comments load and skips the version chapter; stale "Saved" waits before closing member context)
Task 14: minor (deferred): credit timing depends on collab writing the session on close; unescaped RegExp of slugs; prev link href not asserted; contexts closed only on success; resume poll default timeout; axe light theme only.
Task 9 (found in T14): minor (deferred, flag to final review): the chapter page has no visible previous-chapter link since ChapterEnd replaced the prev/next nav — previous is reachable only via ← or the Contents sheet (touch/mouse users).
Task 14: fix round 1/5 (2 addressed, 0 open — two-way 5-place discussion scope; onServer waits; commits 24e9d54..394cf43)
Task 14: minor (deferred): unscoped getByText for comments; onServer opens extra collab sessions; close-time edit-session recording not awaited before publish.
Task 14: complete (commits 934abc2..394cf43, review clean)
Final review: dispatched (range 6d8c85c..394cf43, reviewer a674d3629412c3954, fable)
Final review: With fixes — Important: (1) running head/Contents wrong on version chapters, (2) Suggest 404 on version chapters, (3) no visible previous-chapter control, (4) reduced motion not honoured on head + switch knob, (5) tone flash per chapter (pre-existing).
Final: Ruling: fix wave covers Important 1–4 + cheap minors (hash-entry percent-100 guard; pick-a-path when alternates>0 even if next null; credits key; 401 → signedIn=false stops retry loop; .catch on reader-comments load); Important 5 (tone flash) is parked as the first follow-up — pre-existing, needs an inline pre-hydration script/layout change outside this feature's files — cost if wrong: night readers keep seeing a brief paper flash per chapter.
Final: Ruling: CLAUDE.md "Forbidden → 404" amendment is the owner's call (not edited by me).
Final fix wave: dispatched (base 394cf43, fixer ac0539a33a844d8ab, opus)
Final fix wave: implemented 596bd0d, 1d2e0be (9 findings; e2e 3/3 on :3020)
Final fix wave: re-review clean (9/9 addressed; minor: hash-arrival device-ahead position syncs to account later; non-401 auth failures still retry)

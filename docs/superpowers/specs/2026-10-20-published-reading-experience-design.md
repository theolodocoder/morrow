# Published reading experience — design

Date: 2026-10-20 · Status: for owner approval · Mockups: Hearth direction (front page, chapter opener, chapter end, pick-a-path, discussion)

## Intent

When a work is published it should read like a finished book, not a document exported from an editor. Readers should feel two things at once: **pulled into the next chapter**, and that the thing in their hands is **beautiful like a book**. The owner's reference points are **Kindle and Medium**: clean typography and easy reading.

The MVP feature: "When the work is ready, it becomes a polished reading experience with typography, chapter navigation, contributor credits, branch links, and a discussion area."

## Goals

1. Reading type that is generous and easy on every screen, with all interface out of the way while reading.
2. A chapter ending that makes continuing effortless (next chapter's title, first line, reading time, one tap or →), and where a story has alternate versions, lets the reader **pick a path**.
3. A front page for each work: cover, credits with roles, contents with the reader's progress, one Start/Continue button.
4. Credits that say who did what, on the front page and on each chapter.
5. Discussion that lives at the end of each chapter; paragraph comments available but off by default.
6. Resume exactly where you stopped.

## Non-goals (this round)

- Paged (page-turn) reading mode. Scroll within a chapter only.
- Highlights / quote sharing, popular-passage underlines.
- New reaction types beyond what the end-of-chapter row needs (see Discussion).
- Changing how writers write, branch or publish chapters in the editor, beyond what publishing an alternate version requires.
- Comics, audio, images in text (there is no image block today).

## Anti-goals (fail even if it works)

- **Cluttered pages.** Anything on screen while reading that isn't the text or the thin progress line.
- **Tiny, hard-to-read text.** Body type below the sizes below; low-contrast grey prose.
- **Manipulation.** No auto-loading the next chapter, no endless scroll across chapters, no streak guilt, no fake urgency. The pull comes from honest momentum (teaser line, time left), and every chapter ends with a clear stopping point.
- **Spoilers.** A reader must never see discussion from chapters they haven't reached.
- **Looking like a different app.** It must stay Morrow: same fonts, tokens and voice.

## Constraints (from the codebase and CLAUDE.md)

- Tokens only: no raw colours outside `packages/tokens`. The current sepia/night overrides in `apps/web/src/app/globals.css` (~:988–1030) break this and must move into tokens.
- Accessibility is part of done: labels, keyboard access, visible focus, AA contrast, `prefers-reduced-motion` honoured. Reader settings must satisfy WCAG 1.4.8 / 1.4.12 (user-chosen size, colours, line spacing; no justification forced; survives text-spacing overrides; 200% zoom without sideways scroll).
- Readers only ever see publications (pinned snapshots), never live drafts (`docs/ARCHITECTURE.md`).
- Authorization through `can()` on the server; forbidden → 404. Lists cursor-paginated; creates accept `Idempotency-Key`; work-scoped tables carry `work_id`; tests for business logic and every permission rule against real Postgres.
- Reading without an account must keep working.

## What exists today (build on it, don't rebuild)

- Work page `apps/web/src/app/works/[workSlug]/page.tsx`; chapter reader `apps/web/src/app/works/[workSlug]/read/[chapterSlug]/page.tsx`; components in `apps/web/src/components/reader/` and `components/public/`.
- Fonts: Instrument Serif (display), Literata (reading), DM Sans (UI). `.manuscript` body 17/18/19px; 68ch measure; book-style indents for fiction; form-specific CSS via `.reading-body[data-form]`.
- `ReaderFrame`: running head that hides on scroll-down; "Aa" settings (size s/m/l/xl, tone paper/sepia/night, serif/sans) in localStorage; Contents bottom sheet; 2px `ReadingProgress`; resume = last chapter slug in localStorage only.
- Paragraph comments (`paragraph-comments.tsx`), whole-work comments (`reader-comments.tsx`), end-of-chapter poll, `WorkActions` (like, comment count, bookmark, share; follow under ⋯).
- API: `PublicWork` and `PublicChapter` contracts (`packages/contracts`); contributors computed from edit sessions + accepted proposals (`apps/api/src/routes/publishing.ts:273-307`), flat, no roles; comments API supports `chapter` and `block` filters.
- Branches: `branches` table has `name`, `description`, `createdBy`, `visibility`, `divergesAtChapterId`, `parentBranchId`. Publishing today supersedes **all** live publications of a work, so exactly one branch is public at a time.

## The design (decided with the owner)

### Look: "Hearth"

Warm daylight paper, Morrow's fonts used with more confidence. Light paper is the default tone.

- **Body text:** Literata, 18px on phones, 20px on desktop (from 17–19 today), line-height ~1.6, measure ~65ch. Fiction keeps first-line indents with no gap between paragraphs and no indent after a heading or scene break; essays, articles, papers keep spaced block paragraphs; poetry keeps line breaks exactly.
- **Chapter opener:** set low (about a third down the first screen). Small-caps chapter label in the accent ("Chapter three"), large Instrument Serif title, a credit line with stacked avatars ("Ama Owusu, with Tolu Ade"), and a drop cap on the first paragraph (CSS `initial-letter` behind `@supports`, with a float fallback). No drop cap on poetry.
- **Scene breaks:** centred ornament in the accent colour (existing ⁂).
- **Forms:** fiction says "Chapter"; essays/articles/papers/guides say "Part" or "Section" (builder picks per category; see open calls); single-piece works show no label.

### While reading

- Everything hides except a **hairline progress line** at the top and a quiet **"N min left in chapter"** in the running head when it's shown. Scroll up or tap brings the running head back (back, title, Contents, Aa).
- **Aa settings** keep size, tone (paper, sepia, night) and typeface, plus **line spacing** and **paragraph comments on/off**. Tones rebuilt from tokens; "paper" stays paper even when the OS is in dark mode (the reader's choice wins; the default follows nothing but the reader's setting).
- Keyboard: → / ← go to next / previous chapter at the chapter end and from anywhere when no input has focus.

### Chapter end

In order, below the last paragraph:

1. "End of chapter three" (Instrument Serif italic) and a small reactions row: like (existing like), a "Beautiful line"-style reaction if/when it exists for readers (otherwise like + comment count only), comment count.
2. **Up next card** (dark ink card): "Up next · Chapter four · 12 min", the next chapter's title, its **first line** as a teaser, and **Keep reading**. Last chapter of a complete work: "The end" plus the credits/colophon and an invitation to discuss and follow the writer. Last chapter of an ongoing work: "More soon" with follow / release-day info (existing `ReleaseCountdown`).
3. **Pick-a-path** replaces the Up next card when one or more published alternate versions branch off after this chapter: "The story splits here. Which way?" The main story is the highlighted, obvious choice; each alternate version is a lighter card with its writer's avatar and name, a one-line premise (branch `description`), and its length. A quiet line: "You can come back and read the other way any time."
4. The existing poll card (if the writer asked a question), then the **discussion** (below).

No auto-advance; nothing loads the next chapter until the reader asks.

### Discussion

- **Lives at the end of each chapter**, under Keep reading: "Talk about chapter three", a composer, then comments. Comments made on a specific paragraph appear here too, quoting the line. The writer's replies carry the existing "Writer" tag.
- **Spoiler scope:** a chapter's discussion appears only at the end of that chapter (see call 4).
- **Paragraph comments while reading** are **off by default**; turning them on (Aa or the toggle at the bottom of the discussion) shows the existing margin/pill markers.
- The work page keeps whole-work comments for now.

### Front page of a work

Cover, title, a one-line summary ("A novel · 12 chapters · about 3 hours · ongoing"), description, and one big **Start reading** (→ **Continue** with chapter and % once started). Note: "Read without an account. Sign in to keep your place on every device."

- **Written by:** each person with avatar, name and role: Author; "Co-writer · chapters 3, 5"; Editor; contributors from accepted proposals. Owner first, then by role.
- **Contents:** number, title, minutes; read chapters dimmed, current chapter in the accent with "% read"; where a published alternate version branches off, a line under that chapter: "↳ Also: “If She Had Stayed”, Priya Sharma's version from here".
- Existing content notes, licence/open-access box, tags and published date stay, below the fold and quieter.

### Credits per chapter

The chapter opener's credit line names the chapter's writers ("Ama Owusu, with Tolu Ade"). A full colophon (who wrote, edited, contributed) appears on the front page and after the final chapter.

### Resume

Remember the reader's position **to the paragraph** (block id), not just the chapter. Signed in: saved on the server and shown as Continue on the front page and in the reading list. Signed out: saved on the device (existing localStorage, extended). Opening a chapter you were partway through returns you to that paragraph.

## API and data changes this implies

- **Publishing alternate versions:** allow a work to have its main publication **plus** published alternate branches. Publishing a branch as an alternate version must not supersede the main publication; republishing main must not take down alternates. Each alternate shows chapters from where it diverges (`divergesAtChapterId`) and shares the earlier chapters with main. Only holders of `work.publish` publish alternates (owner decision below); see calls 1–3 for how alternates map onto chapters.
- **PublicWork:** add `versions[]` (name, slug, description/premise, author `PublicPerson`, diverges-after chapter slug, chapter count, word count); add `credits[]` with role and chapter scope instead of / alongside the flat `contributors`.
- **PublicChapter:** add the next chapter's opening line (first ~200 characters of its first paragraph) and its word count, so the Up next card needs no second request; add this chapter's credit line; add `alternates[]` that branch off after it.
- **Reading position:** new authenticated endpoints to read/write per-chapter positions `{chapter, blockId, percent}` for a work (table carries `work_id`; idempotent upsert; see call 6).
- **Chapter discussion:** comments list filtered to one chapter; the whole-work list excludes chapter comments (call 7). Credits stored at publish time (call 5).

## Left to the builder

- Exact component breakdown and whether chapter-end lives in one component or several.
- Animation details within the motion rules (150–250 ms ease-out, none under reduced motion); one deliberate moment: the progress line filling and the ornament at the chapter end.
- How the Contents sheet shows versions (the front-page treatment above is the reference).
- Tests: per CLAUDE.md, business logic and every permission rule (publishing alternates, spoiler scope, reading position) against real Postgres; e2e for Start → Keep reading → pick a path → discussion; axe on every new screen.

## Owner decisions

- **Publishing alternate versions is the owner's decision** (anyone with the existing `work.publish` capability: owner, and editors who hold it). Branch writers cannot publish their own versions; there is no approval flow. The owner can publish and unpublish each alternate independently of the main story.

## Calls made in design (not discussed with the owner; check these)

1. **Alternates publish from where they diverge.** An alternate version publishes only its chapters from its divergence point onward; the chapters before it are always main's current publication (so an alternate shown to readers keeps following main's fixes to the shared opening). If the branch author edited those early chapters, those edits are not shown. `divergesAtChapterId` means **the first chapter that differs**; pick-a-path appears at the end of the chapter before it. If a branch has no divergence point recorded, the owner picks it when publishing. No alternates of alternates in this round.
2. **"Selected" branch (FR-018) keeps its meaning:** it decides which branch readers get as the main story. Alternates are in addition to it. One selected per work, as today.
3. **Alternates are frozen at what was published.** Publishing new main chapters doesn't change an alternate's own chapters; the owner republishes the alternate to update it. Taking main down takes all alternates down with it. Archiving a branch unpublishes its alternate.
4. **Spoilers are handled by placement, not a server gate.** Each chapter's discussion appears only at the end of that chapter, so a reader meets it after reading the chapter; nothing else on the page (front page, notifications, previews) shows chapter discussion. No "reached" tracking is required to see a discussion, which keeps reading without an account fully working. (This replaces the stricter "only readers who've reached it" wording from the conversation.)
5. **Credits are derived automatically at publish time** and stored with the publication, so they describe what was published, not later drafting. Labels: the owner is **Author**; members who wrote in a published chapter are **Co-writer · chapters N, M** (a minimum of 20 recorded edits to that chapter before it was published, from the trusted server-side edit sessions, so a typo fix doesn't count; word-level authorship isn't recorded, and Yjs client ids are never trusted for credit); authors of accepted proposals are **Contributor**. There is no separate "Editor" label in this round (the mockup's "Editor" becomes Co-writer or Contributor by these rules). The chapter credit line uses the same rule.
6. **Reading position is per chapter:** one row per (reader, work, chapter) holding the furthest paragraph reached and percent read. That feeds Continue, "% read" and the dimmed read chapters. On sign-in, the device's saved positions merge into the account; the furthest point wins.
7. **Chapter discussion is stored as comments with a chapter** (with or without a paragraph). The work page's thread is comments with no chapter, and its query must exclude chapter comments. Paragraph comments shown in the chapter discussion quote the line from the published text. All comments count toward the work's comment count. Existing whole-work comments stay where they are, still open for replies.
8. **The reactions row uses the existing work-level like** (♥ count is the work's), plus the chapter's comment count. No per-chapter likes in this round.

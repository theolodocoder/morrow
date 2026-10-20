# Contributing

Thanks for helping. A few things matter more here than usual, because people trust Morrow with unfinished writing.

## Ground rules

- **Never lose a writer's words.** Changes to persistence, sync or the editor schema need tests that prove nothing is lost.
- **Authorization lives in one place.** Use `can()` from `@morrow/domain`. Every API route declares the capability it needs. Collab re-checks on connect. The UI only hides what the API says is unavailable. Hiding something is never access control.
- **Forbidden looks like missing.** Return 404 to anyone who cannot read a resource.
- **Only collab writes document content.** The API reaches documents through `CollabGateway`.
- **No HTML as content.** Render through the editor schema. Never use `dangerouslySetInnerHTML` with user content.
- **Editor schema changes** bump `SCHEMA_VERSION`, should be additive, and ship together across web and collab.
- **Never log** manuscript text, Yjs updates, tokens or tickets.
- **No secrets in the repo.** Ever.

## Workflow

1. Branch from `main`.
2. Keep changes focused.
3. `pnpm typecheck && pnpm lint && pnpm test` must pass. Add the end-to-end run for user-facing changes.
4. Open a pull request explaining what changed and why. Call out anything touching auth, persistence, migrations or the editor schema.

Migrations are generated with `pnpm --filter @morrow/db generate`, reviewed as SQL, and never edited after merge.

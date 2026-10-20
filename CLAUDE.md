# Engineering rules for AI coding agents (and humans)

- Strict TypeScript. Small, clear modules. Comments explain _why_, never repeat _what_.
- No new infrastructure, service or abstraction without a concrete need. No microservices by default.
- Authorization: `can()` in `@morrow/domain` only. Enforce it on the server and in collab, never only in the UI. Forbidden → 404.
- Document content: only `apps/collab` writes it, merge-on-write via `DocumentStore`. Yjs state is the source of truth. HTML is never stored or trusted.
- Never save the whole manuscript via REST. Never bind an editor to an unsynced Y.Doc.
- Editor schema: additive changes plus a `SCHEMA_VERSION` bump. Keep Yjs, y-tiptap and Hocuspocus versions pinned.
- Every work-scoped table carries `work_id`. Lists are cursor-paginated with limits. Creates accept `Idempotency-Key`.
- Tests are required for business logic and every permission rule. Integration tests use real Postgres, not mocks.
- Accessibility is part of "done": labels, keyboard access, visible focus, AA contrast via tokens. No raw colours outside `packages/tokens`.
- Never log manuscript content, Yjs updates, awareness, tokens or tickets. Never commit secrets.
- Don't commit, push, add remotes or publish unless explicitly asked. No AI-attribution trailers on commits. Keep authorship accurate.

/**
 * Proposals (PRD FR-014/015, architecture §9). The API owns the lifecycle, permissions and audit trail; collab owns
 * the documents (P-013): forking the workspace, classifying, applying and refreshing.
 */
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod'
import { z } from 'zod'
import { and, desc, eq, inArray, isNull, ne, or, sql } from 'drizzle-orm'
import {
  AcceptProposalInput,
  CreateProposalInput,
  PROBLEM,
  PROPOSAL_STATUSES,
  ProposalCommentInput,
  ProposalDetail,
  ProposalNoteInput,
  ProposalSummary,
  SuggestionInput,
  RefreshProposalResult,
  UpdateProposalInput,
} from '@morrow/contracts'
import {
  can,
  canActOnProposal,
  canSeeProposal,
  isOpen,
  nextStatus,
  proposalActions,
  seesDrafts,
  type ProposalAction,
  type ProposalStatus,
} from '@morrow/domain'
import {
  branches,
  chapters,
  documentProjections,
  documentSnapshots,
  documents,
  loadWorkAccess,
  proposalEvents,
  proposals,
  publications,
  toAccessContext,
  user,
  editSessions,
  works,
  type Database,
  type Transaction,
} from '@morrow/db'
import { paragraphsFromText, stateFromJSON } from '@morrow/editor/server'
import { createHash } from 'node:crypto'
import { createChapterIn } from './chapters.ts'
import { SCHEMA_VERSION, diffDocuments, type BlockChange, type PMNode } from '@morrow/editor'
import type { CollabGateway } from '../collab-gateway.ts'
import { requireWork } from '../access.ts'
import { recordActivity } from '../activity.ts'
import { blockedBetween, spamCheck } from '../safety.ts'
import { readableWork } from './publishing.ts'
import { idempotent } from '../idempotency.ts'
import { HttpProblem, conflict, forbidden, notFound } from '../problems.ts'

type ProposalRow = typeof proposals.$inferSelect
const Params = z.object({ proposalId: z.uuid() })
const iso = (d: Date | null) => d?.toISOString() ?? null

async function names(db: Database, ids: (string | null)[]) {
  const wanted = [...new Set(ids.filter((x): x is string => !!x))]
  if (!wanted.length) return new Map<string, string>()
  const rows = await db.select({ id: user.id, name: user.name }).from(user).where(inArray(user.id, wanted))
  return new Map(rows.map((r) => [r.id, r.name]))
}

async function toSummaries(db: Database, rows: ProposalRow[]): Promise<ProposalSummary[]> {
  const people = await names(
    db,
    rows.flatMap((r) => [r.authorId, r.reviewerId]),
  )
  const chapterIds = [...new Set(rows.map((r) => r.chapterId).filter((x): x is string => !!x))]
  const titles = chapterIds.length
    ? new Map(
        (
          await db
            .select({ id: chapters.id, title: chapters.title })
            .from(chapters)
            .where(inArray(chapters.id, chapterIds))
        ).map((c) => [c.id, c.title]),
      )
    : new Map<string, string>()
  const person = (id: string | null) => (id ? { id, name: people.get(id) ?? 'Someone' } : null)
  return rows.map((r) => ({
    id: r.id,
    workId: r.workId,
    kind: r.kind,
    status: r.status,
    title: r.title,
    explanation: r.explanation,
    author: person(r.authorId)!,
    reviewer: person(r.reviewerId),
    chapter: r.chapterId ? { id: r.chapterId, title: titles.get(r.chapterId) ?? 'Deleted chapter' } : null,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
    submittedAt: iso(r.submittedAt),
    decidedAt: iso(r.decidedAt),
  }))
}

/** Load a proposal the caller may see (404 otherwise, so existence never leaks), with the context to authorize actions. */
async function loadProposal(db: Database, proposalId: string, userId: string) {
  const [p] = await db.select().from(proposals).where(eq(proposals.id, proposalId))
  if (!p) throw notFound()
  const row = await loadWorkAccess(db, p.workId, userId)
  if (!row) throw notFound()
  const ctx = toAccessContext(row)
  const actor = { userId }
  if (!canSeeProposal(actor, ctx, p)) throw notFound()
  const require = (action: ProposalAction) => {
    if (!canActOnProposal(actor, ctx, p, action)) {
      // Valid for someone, just not now or not for you: say so plainly.
      if (nextStatus(p.status, action) === null)
        throw conflict(`This proposal is ${p.status.replace('_', ' ')}.`)
      throw forbidden()
    }
  }
  return { p, ctx, actor, require }
}

/** Move a proposal from its current status, recording the change. Fails if someone else changed it first. */
async function transition(
  tx: Transaction,
  p: ProposalRow,
  action: ProposalAction,
  actorId: string,
  note = '',
  extra: Partial<typeof proposals.$inferInsert> = {},
) {
  const to = nextStatus(p.status, action)!
  const decided = to === 'accepted' || to === 'rejected' || to === 'changes_requested'
  const [updated] = await tx
    .update(proposals)
    .set({
      status: to,
      updatedAt: sql`now()`,
      ...(to === 'submitted' ? { submittedAt: sql`now()` } : {}),
      ...(decided || to === 'under_review' ? { reviewerId: actorId } : {}),
      ...(to === 'accepted' || to === 'rejected' ? { decidedAt: sql`now()` } : {}),
      ...extra,
    })
    .where(and(eq(proposals.id, p.id), eq(proposals.status, p.status)))
    .returning()
  if (!updated)
    throw conflict('This proposal changed while you were looking at it. Reload to see its current state.')
  await tx.insert(proposalEvents).values({
    proposalId: p.id,
    workId: p.workId,
    actorId,
    type: 'status',
    body: note,
    fromStatus: p.status,
    toStatus: to,
  })
  await recordActivity(tx, {
    workId: p.workId,
    actorId,
    type: `proposal.${to}`,
    subjectType: 'proposal',
    subjectId: p.id,
    data: { from: p.status, kind: p.kind, chapterId: p.chapterId, authorId: p.authorId },
  })
  return updated
}

/** Called when a chapter is deleted: its open proposals can no longer apply. */
export async function supersedeProposalsFor(tx: Transaction, chapterId: string, actorId: string) {
  const open = await tx
    .update(proposals)
    .set({ status: 'superseded', updatedAt: sql`now()` })
    .where(
      and(
        eq(proposals.chapterId, chapterId),
        inArray(proposals.status, ['draft', 'submitted', 'under_review', 'changes_requested']),
      ),
    )
    .returning({ id: proposals.id, workId: proposals.workId })
  if (open.length)
    await tx.insert(proposalEvents).values(
      open.map((o) => ({
        proposalId: o.id,
        workId: o.workId,
        actorId,
        type: 'status' as const,
        body: 'The chapter was deleted.',
        toStatus: 'superseded' as const,
      })),
    )
}

const engineInput = (p: ProposalRow, targetDocumentId: string, userId: string) => ({
  proposalId: p.id,
  workId: p.workId,
  targetDocumentId,
  workspaceDocumentId: p.workspaceDocumentId!,
  baseSnapshotId: p.baseSnapshotId!,
  userId,
})

export const proposalRoutes: FastifyPluginAsyncZod<{ db: Database; collab: CollabGateway }> = async (
  app,
  { db, collab },
) => {
  async function targetDocument(p: ProposalRow) {
    const [c] = await db
      .select({ documentId: chapters.documentId, deletedAt: chapters.deletedAt })
      .from(chapters)
      .where(eq(chapters.id, p.chapterId!))
    if (!c || c.deletedAt) throw conflict('The chapter this proposal changes was deleted.')
    return c.documentId
  }

  /** Summaries for someone who can read only what's published: chapter titles as published, not as drafted. */
  async function outsiderSummaries(rows: ProposalRow[]) {
    const out = await toSummaries(db, rows)
    for (const [i, r] of rows.entries()) {
      if (!r.baseSnapshotId || !out[i]!.chapter) continue
      const [pub] = await db
        .select({ title: publications.title })
        .from(publications)
        .where(eq(publications.snapshotId, r.baseSnapshotId))
        .limit(1)
      out[i]!.chapter = { id: out[i]!.chapter!.id, title: pub?.title ?? 'A published chapter' }
    }
    return out
  }

  async function detail(p: ProposalRow, userId: string): Promise<ProposalDetail> {
    const row = (await loadWorkAccess(db, p.workId, userId))!
    const actor = { userId }
    const ctx = toAccessContext(row)
    // Outside contributors (public participation) see only what's published: no live comparison, no draft titles.
    const drafts = seesDrafts(actor, ctx)
    const [summary] = drafts ? await toSummaries(db, [p]) : await outsiderSummaries([p])
    const ev = await db
      .select()
      .from(proposalEvents)
      .where(eq(proposalEvents.proposalId, p.id))
      .orderBy(proposalEvents.createdAt)
    const people = await names(
      db,
      ev.map((e) => e.actorId),
    )
    let review: ProposalDetail['review'] = null
    if (p.kind === 'edit' && p.workspaceDocumentId && p.baseSnapshotId) {
      const [base] = await db
        .select({ content: documentSnapshots.contentJson })
        .from(documentSnapshots)
        .where(eq(documentSnapshots.id, p.baseSnapshotId))
      let classification: NonNullable<ProposalDetail['review']>['classification'] = null
      let proposalJson: unknown
      let chapterJson: unknown
      const [c] = await db
        .select({ documentId: chapters.documentId, deletedAt: chapters.deletedAt })
        .from(chapters)
        .where(eq(chapters.id, p.chapterId!))
      if (drafts && isOpen(p.status) && c && !c.deletedAt) {
        try {
          const live = await collab.classifyProposal(engineInput(p, c.documentId, userId))
          ;({ classification } = live)
          proposalJson = live.proposal
          chapterJson = live.chapter
        } catch (err) {
          // The review still renders from stored projections; accepting re-checks against the live chapter anyway.
          app.log.warn({ err }, 'live proposal comparison unavailable')
        }
      }
      if (proposalJson === undefined) {
        const [proj] = await db
          .select({ content: documentProjections.contentJson })
          .from(documentProjections)
          .where(eq(documentProjections.documentId, p.workspaceDocumentId))
        proposalJson = proj?.content ?? base?.content
      }
      const changes: BlockChange[] = diffDocuments(
        (base?.content ?? { type: 'doc' }) as PMNode,
        proposalJson as PMNode,
      )
      const contested =
        classification?.kind === 'conflict' ? new Set(classification.blockIds) : new Set<string>()
      const chapterVersions = Object.fromEntries(
        ((chapterJson as PMNode | undefined)?.content ?? [])
          .filter((n) => contested.has(String(n.attrs?.id)))
          .map((n) => [String(n.attrs!.id), n]),
      )
      review = { classification, changes, chapterVersions }
    }
    return {
      ...summary!,
      viewerSeesDrafts: drafts,
      body: p.body,
      workspaceDocumentId: p.workspaceDocumentId,
      actions: proposalActions(actor, ctx, p),
      events: ev.map((e) => ({
        id: e.id,
        type: e.type,
        body: e.body,
        fromStatus: e.fromStatus,
        toStatus: e.toStatus,
        actor: { id: e.actorId, name: people.get(e.actorId) ?? 'Someone' },
        createdAt: e.createdAt.toISOString(),
      })),
      review,
    }
  }

  app.post(
    '/works/:workId/proposals',
    {
      schema: {
        params: z.object({ workId: z.uuid() }),
        body: CreateProposalInput,
        response: { 201: ProposalDetail },
      },
    },
    async (req, reply) => {
      const userId = req.user!.id
      const { work } = await requireWork(db, req.params.workId, userId, 'proposal.create')
      const input = req.body
      let chapter: typeof chapters.$inferSelect | undefined
      if (input.chapterId) {
        ;[chapter] = await db
          .select()
          .from(chapters)
          .where(
            and(eq(chapters.id, input.chapterId), eq(chapters.workId, work.id), isNull(chapters.deletedAt)),
          )
        if (!chapter) throw notFound()
      }
      if (input.body) await spamCheck(db, userId, input.body, 'proposal')
      const created = await idempotent(db, req, reply, 201, async () => {
        let workspaceDocumentId: string | null = null
        let baseSnapshotId: string | null = null
        if (input.kind === 'edit') {
          // The workspace is a lineage-preserving fork of the chapter as it is now: the proposal's base (architecture §9).
          const [doc] = await db
            .insert(documents)
            .values({ workId: work.id, kind: 'proposal', schemaVersion: SCHEMA_VERSION })
            .returning()
          try {
            const fork = await collab.forkDocument({
              sourceDocumentId: chapter!.documentId,
              targetDocumentId: doc!.id,
              workId: work.id,
              createdBy: userId,
              reason: 'proposal_base',
            })
            if (!fork.forkSnapshotId) throw new Error('fork returned no base snapshot')
            workspaceDocumentId = doc!.id
            baseSnapshotId = fork.forkSnapshotId
          } catch (err) {
            req.log.error({ err }, 'proposal fork failed')
            throw new HttpProblem(
              503,
              PROBLEM.internal,
              'Couldn’t start the proposal. Try again in a moment.',
            )
          }
        }
        const p = await db.transaction(async (tx) => {
          const [row] = await tx
            .insert(proposals)
            .values({
              workId: work.id,
              kind: input.kind,
              authorId: userId,
              title: input.title,
              explanation: input.explanation,
              body: input.body,
              chapterId: chapter?.id ?? null,
              workspaceDocumentId,
              baseSnapshotId,
            })
            .returning()
          await recordActivity(tx, {
            workId: work.id,
            actorId: userId,
            type: 'proposal.created',
            subjectType: 'proposal',
            subjectId: row!.id,
            data: { kind: input.kind, chapterId: chapter?.id ?? null },
          })
          return row!
        })
        return detail(p, userId)
      })
      return reply.status(201).send(created)
    },
  )

  app.get(
    '/works/:workId/proposals',
    {
      schema: {
        params: z.object({ workId: z.uuid() }),
        querystring: z.object({ status: z.enum(['open', 'closed', 'all']).default('open') }),
        response: { 200: z.object({ items: z.array(ProposalSummary) }) },
      },
    },
    async (req) => {
      const userId = req.user!.id
      const { work } = await requireWork(db, req.params.workId, userId, 'work.read')
      const row = (await loadWorkAccess(db, work.id, userId))!
      const reviewer = can({ userId }, 'proposal.review', toAccessContext(row))
      const open: ProposalStatus[] = ['draft', 'submitted', 'under_review', 'changes_requested']
      const statuses =
        req.query.status === 'open'
          ? open
          : req.query.status === 'closed'
            ? PROPOSAL_STATUSES.filter((s) => !open.includes(s))
            : [...PROPOSAL_STATUSES]
      // Reviewers see everyone's submitted proposals; everyone sees their own, drafts included.
      const visible = reviewer
        ? or(eq(proposals.authorId, userId), ne(proposals.status, 'draft'))
        : eq(proposals.authorId, userId)
      const rows = await db
        .select()
        .from(proposals)
        .where(and(eq(proposals.workId, work.id), inArray(proposals.status, statuses), visible))
        .orderBy(desc(proposals.updatedAt))
        .limit(200)
      return { items: await toSummaries(db, rows) }
    },
  )

  app.get(
    '/proposals/:proposalId',
    { schema: { params: Params, response: { 200: ProposalDetail } } },
    async (req) => {
      const { p } = await loadProposal(db, req.params.proposalId, req.user!.id)
      return detail(p, req.user!.id)
    },
  )

  app.patch(
    '/proposals/:proposalId',
    { schema: { params: Params, body: UpdateProposalInput, response: { 200: ProposalDetail } } },
    async (req) => {
      const { p, require } = await loadProposal(db, req.params.proposalId, req.user!.id)
      require('edit')
      if (req.body.body) await spamCheck(db, req.user!.id, req.body.body, 'proposal')
      const [updated] = await db
        .update(proposals)
        .set({ ...req.body, updatedAt: sql`now()` })
        .where(and(eq(proposals.id, p.id), eq(proposals.status, p.status)))
        .returning()
      if (!updated) throw conflict('This proposal changed meanwhile. Reload and try again.')
      return detail(updated, req.user!.id)
    },
  )

  // Simple transitions. Submitting freezes an edit's workspace (a snapshot of exactly what was submitted).
  const simple: [string, ProposalAction][] = [
    ['submit', 'submit'],
    ['start-review', 'start_review'],
    ['request-changes', 'request_changes'],
    ['reject', 'reject'],
    ['withdraw', 'withdraw'],
  ]
  for (const [path, action] of simple) {
    app.post(
      `/proposals/:proposalId/${path}`,
      { schema: { params: Params, body: ProposalNoteInput, response: { 200: ProposalDetail } } },
      async (req) => {
        const userId = req.user!.id
        const { p, require } = await loadProposal(db, req.params.proposalId, userId)
        require(action)
        let extra: Partial<typeof proposals.$inferInsert> = {}
        if (action === 'submit' && p.kind === 'edit') {
          const snap = await collab.createSnapshot({
            documentId: p.workspaceDocumentId!,
            workId: p.workId,
            label: 'Submitted',
            createdBy: userId,
          })
          extra = { submittedSnapshotId: snap.id }
        }
        if (action === 'submit' && p.kind !== 'edit' && !p.body.trim())
          throw conflict('Write something before submitting.')
        const updated = await db.transaction((tx) => transition(tx, p, action, userId, req.body.note, extra))
        // The author's live workspace connection must follow the new rights (frozen on submit, editable again on
        // "changes requested"). Best effort; collab's periodic re-check is the backstop.
        if (p.kind === 'edit' && p.workspaceDocumentId)
          await collab
            .revokeAccess({ workId: p.workId, userId: p.authorId, documentId: p.workspaceDocumentId })
            .catch((err) => req.log.warn({ err }, 'workspace revoke failed'))
        return detail(updated, userId)
      },
    )
  }

  async function addChapterFromProposal(p: typeof proposals.$inferSelect, reviewerId: string) {
    const [w] = await db.select().from(works).where(eq(works.id, p.workId))
    const [branch] = await db.select().from(branches).where(eq(branches.id, w!.defaultBranchId!))
    const chapter = await createChapterIn(db, branch!, reviewerId, { title: p.title })
    const seeded = stateFromJSON(paragraphsFromText(p.body, chapter.documentId))
    const [snap] = await db
      .insert(documentSnapshots)
      .values({
        documentId: chapter.documentId,
        workId: p.workId,
        state: Buffer.from(seeded.state),
        contentJson: seeded.contentJson,
        contentHash: createHash('sha256').update(JSON.stringify(seeded.contentJson)).digest('hex'),
        wordCount: seeded.wordCount,
        reason: 'proposal_applied',
        label: 'From a proposal',
        createdBy: p.authorId,
      })
      .returning({ id: documentSnapshots.id })
    await collab.forkSnapshot({
      snapshotId: snap!.id,
      targetDocumentId: chapter.documentId,
      workId: p.workId,
    })
    // Credit (attribution is from trusted server-side sessions): the chapter is the proposal author's writing.
    const now = new Date()
    await db.insert(editSessions).values({
      documentId: chapter.documentId,
      workId: p.workId,
      userId: p.authorId,
      startedAt: now,
      endedAt: now,
      updateCount: 1,
    })
    return chapter.id
  }

  app.post(
    '/proposals/:proposalId/accept',
    { schema: { params: Params, body: AcceptProposalInput, response: { 200: ProposalDetail } } },
    async (req, reply) => {
      const userId = req.user!.id
      const { p, require } = await loadProposal(db, req.params.proposalId, userId)
      // A retry with the same Idempotency-Key replays the first answer, even though the proposal is now accepted.
      return idempotent(db, req, reply, 200, async () => {
        require('accept')
        const accepted = await db.transaction(async (tx) => {
          // Lock: two reviewers accepting at once must not both apply.
          const [locked] = await tx.select().from(proposals).where(eq(proposals.id, p.id)).for('update')
          if (!locked || nextStatus(locked.status, 'accept') === null)
            throw conflict('This proposal is no longer awaiting review.')
          let extra: Partial<typeof proposals.$inferInsert> = {}
          if (locked.kind === 'chapter') {
            // Story chains (P-061): the proposal becomes the work's next chapter, credited to its author.
            const chapterId = await addChapterFromProposal(locked, userId)
            extra = { chapterId }
          } else if (locked.kind === 'edit') {
            const target = await targetDocument(locked)
            const result = await collab.applyProposal({
              ...engineInput(locked, target, userId),
              ...(req.body.resolve ? { resolve: req.body.resolve } : {}),
            })
            if (!result.ok)
              throw new HttpProblem(
                409,
                PROBLEM.proposalConflict,
                'The chapter changed in the same places.',
                'Ask the author to update the proposal with the latest text, or request changes.',
              )
            extra = { appliedSnapshotId: result.appliedSnapshotId }
          }
          return transition(tx, locked, 'accept', userId, req.body.note, extra)
        })
        return detail(accepted, userId)
      })
    },
  )

  app.post(
    '/proposals/:proposalId/refresh',
    { schema: { params: Params, response: { 200: RefreshProposalResult } } },
    async (req) => {
      const userId = req.user!.id
      const { p, require } = await loadProposal(db, req.params.proposalId, userId)
      require('refresh')
      if (p.kind !== 'edit') throw conflict('Only edits can be updated from the chapter.')
      const target = await targetDocument(p)
      const result = await collab.refreshProposal(engineInput(p, target, userId))
      await db.transaction(async (tx) => {
        await tx
          .update(proposals)
          .set({ baseSnapshotId: result.baseSnapshotId, updatedAt: sql`now()` })
          .where(eq(proposals.id, p.id))
        await tx.insert(proposalEvents).values({
          proposalId: p.id,
          workId: p.workId,
          actorId: userId,
          type: 'status',
          body: result.reference.length
            ? `Updated from the chapter; ${result.reference.length} contested paragraph(s) kept as proposed.`
            : 'Updated from the chapter.',
          fromStatus: p.status,
          toStatus: p.status,
        })
      })
      return { reference: result.reference }
    },
  )

  /**
   * Suggest an edit to a published chapter (public participation, M6). The suggestion starts from the published
   * version the person read (P-014), never the live draft, and goes through the same review as any proposal.
   */
  app.post(
    '/suggestions',
    {
      schema: { body: SuggestionInput, response: { 201: ProposalDetail } },
      config: { rateLimit: { max: 10, timeWindow: '1 hour' } },
    },
    async (req, reply) => {
      const userId = req.user!.id
      const w = await readableWork(db, req.body.publicPath)
      if (!w) throw notFound()
      const row = (await loadWorkAccess(db, w.id, userId))!
      if (w.ownerId === userId) throw conflict('It’s your work: edit it directly.')
      if (!can({ userId }, 'proposal.create', toAccessContext(row))) throw forbidden()
      if (await blockedBetween(db, userId, w.ownerId)) throw forbidden()
      if (req.body.kind === 'chapter') {
        // Story chains (P-061): offer the next chapter as text; it's reviewed like any proposal.
        await spamCheck(db, userId, `${req.body.explanation}\n${req.body.body}`, 'proposal')
        const created = await db.transaction(async (tx) => {
          const [row] = await tx
            .insert(proposals)
            .values({
              workId: w.id,
              kind: 'chapter',
              authorId: userId,
              title: req.body.title,
              explanation: req.body.explanation,
              body: req.body.body,
            })
            .returning()
          await recordActivity(tx, {
            workId: w.id,
            actorId: userId,
            type: 'proposal.created',
            subjectType: 'proposal',
            subjectId: row!.id,
            data: { kind: 'chapter', outside: true },
          })
          return row!
        })
        return reply.status(201).send(await detail(created, userId))
      }
      const suffix = req.body.chapterSlug!.slice(-6)
      const pubs = await db
        .select()
        .from(publications)
        .where(and(eq(publications.workId, w.id), isNull(publications.supersededAt)))
      const pub = pubs.find((x) => x.chapterId.endsWith(suffix))
      if (!pub) throw notFound()
      if (req.body.explanation) await spamCheck(db, userId, req.body.explanation, 'proposal')
      const [doc] = await db
        .insert(documents)
        .values({ workId: w.id, kind: 'proposal', schemaVersion: SCHEMA_VERSION })
        .returning()
      try {
        await collab.forkSnapshot({ snapshotId: pub.snapshotId, targetDocumentId: doc!.id, workId: w.id })
      } catch (err) {
        req.log.error({ err }, 'suggestion fork failed')
        throw new HttpProblem(503, PROBLEM.internal, 'Couldn’t start your suggestion. Try again in a moment.')
      }
      const p = await db.transaction(async (tx) => {
        const [created] = await tx
          .insert(proposals)
          .values({
            workId: w.id,
            kind: 'edit',
            authorId: userId,
            title: req.body.title,
            explanation: req.body.explanation,
            chapterId: pub.chapterId,
            workspaceDocumentId: doc!.id,
            baseSnapshotId: pub.snapshotId,
          })
          .returning()
        await recordActivity(tx, {
          workId: w.id,
          actorId: userId,
          type: 'proposal.created',
          subjectType: 'proposal',
          subjectId: created!.id,
          data: { kind: 'edit', chapterId: pub.chapterId, outside: true },
        })
        return created!
      })
      return reply.status(201).send(await detail(p, userId))
    },
  )

  /** Everything I've proposed, across works: how outside contributors find their suggestions again. */
  app.get(
    '/me/proposals',
    { schema: { response: { 200: z.object({ items: z.array(ProposalSummary) }) } } },
    async (req) => {
      const userId = req.user!.id
      const rows = await db
        .select()
        .from(proposals)
        .where(eq(proposals.authorId, userId))
        .orderBy(desc(proposals.updatedAt))
        .limit(100)
      const out: ProposalSummary[] = []
      for (const r of rows) {
        const access = await loadWorkAccess(db, r.workId, userId)
        if (!access) continue
        const ctx = toAccessContext(access)
        if (!canSeeProposal({ userId }, ctx, r)) continue
        out.push(...(seesDrafts({ userId }, ctx) ? await toSummaries(db, [r]) : await outsiderSummaries([r])))
      }
      return { items: out }
    },
  )

  app.post(
    '/proposals/:proposalId/comments',
    { schema: { params: Params, body: ProposalCommentInput, response: { 200: ProposalDetail } } },
    async (req) => {
      const userId = req.user!.id
      const { p, require } = await loadProposal(db, req.params.proposalId, userId)
      require('comment')
      await db
        .insert(proposalEvents)
        .values({ proposalId: p.id, workId: p.workId, actorId: userId, type: 'comment', body: req.body.body })
      return detail(p, userId)
    },
  )
}

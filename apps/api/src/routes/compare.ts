/**
 * Comparing revisions (FR-019) and branches (FR-018), and merging a branch into its parent with conflict detection.
 * A merge reuses the proposal engine chapter by chapter (architecture §10): every changed chapter is classified first;
 * if any overlaps with changes made meanwhile in the parent, nothing is merged and the clashing paragraphs are named.
 */
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod'
import { z } from 'zod'
import { and, asc, eq, inArray, isNull, sql } from 'drizzle-orm'
import { BranchCompare, MergeResult, RevisionCompare } from '@morrow/contracts'
import {
  branchMerges,
  chapters,
  documentProjections,
  documentSnapshots,
  documents,
  type Database,
} from '@morrow/db'
import { SCHEMA_VERSION, diffDocuments, diffSummary, type PMNode } from '@morrow/editor'
import type { CollabGateway } from '../collab-gateway.ts'
import { requireBranch, requireDocument } from '../access.ts'
import { recordActivity } from '../activity.ts'
import { idempotent } from '../idempotency.ts'
import { conflict, notFound } from '../problems.ts'
import { positionAfter } from './chapters.ts'

type ChapterRow = typeof chapters.$inferSelect
const EMPTY: PMNode = { type: 'doc', content: [] }
const isUnchanged = (s: { changed: number; added: number; removed: number }) =>
  s.changed + s.added + s.removed === 0

async function projections(db: Database, documentIds: string[]) {
  if (!documentIds.length) return new Map<string, PMNode>()
  const rows = await db
    .select({ id: documentProjections.documentId, json: documentProjections.contentJson })
    .from(documentProjections)
    .where(inArray(documentProjections.documentId, documentIds))
  return new Map(rows.map((r) => [r.id, r.json as PMNode]))
}

/**
 * Chapters in different branches are "the same chapter" when they share a lineage root: following `originChapterId`
 * back to a chapter that wasn't forked from anything. Forks preserve block ids, so their texts diff meaningfully.
 */
async function lineageRoots(db: Database, workId: string) {
  const all = await db
    .select({ id: chapters.id, origin: chapters.originChapterId })
    .from(chapters)
    .where(eq(chapters.workId, workId))
  const origin = new Map(all.map((c) => [c.id, c.origin]))
  return (id: string) => {
    let cur = id
    for (let i = 0; i < 64; i++) {
      const next = origin.get(cur)
      if (!next || !origin.has(next)) return cur
      cur = next
    }
    return cur
  }
}

const liveChapters = (db: Database, branchId: string) =>
  db
    .select()
    .from(chapters)
    .where(and(eq(chapters.branchId, branchId), isNull(chapters.deletedAt)))
    .orderBy(asc(chapters.position))

/** Pair this branch's chapters with the other's, in this branch's reading order; the other's leftovers last. */
async function pairChapters(db: Database, workId: string, here: ChapterRow[], there: ChapterRow[]) {
  const root = await lineageRoots(db, workId)
  const thereByRoot = new Map<string, ChapterRow>()
  for (const c of there) if (!thereByRoot.has(root(c.id))) thereByRoot.set(root(c.id), c)
  const used = new Set<string>()
  const pairs: { here: ChapterRow | null; there: ChapterRow | null }[] = []
  for (const c of here) {
    const match = thereByRoot.get(root(c.id))
    if (match && !used.has(match.id)) {
      used.add(match.id)
      pairs.push({ here: c, there: match })
    } else pairs.push({ here: c, there: null })
  }
  for (const c of there) if (!used.has(c.id)) pairs.push({ here: null, there: c })
  return pairs
}

export const compareRoutes: FastifyPluginAsyncZod<{ db: Database; collab: CollabGateway }> = async (
  app,
  { db, collab },
) => {
  /**
   * Texts as they are right now, from collab's live copies: stored projections trail the last keystroke by the store
   * debounce, which would make "compare with now" stale and could make a merge skip a chapter edited a moment ago.
   * Falls back to the stored projection only if collab can't be reached.
   */
  async function liveTexts(documentIds: string[], workId: string, userId: string) {
    const stored = await projections(db, documentIds)
    const out = new Map<string, PMNode>()
    await Promise.all(
      documentIds.map(async (id) => {
        try {
          out.set(id, (await collab.liveContent({ documentId: id, workId, userId })).content as PMNode)
        } catch (err) {
          app.log.warn({ err, documentId: id }, 'live content unavailable; using stored text')
          out.set(id, stored.get(id) ?? EMPTY)
        }
      }),
    )
    return out
  }

  // ---- Revisions (FR-019) ----
  app.get(
    '/documents/:documentId/compare',
    {
      schema: {
        params: z.object({ documentId: z.uuid() }),
        querystring: z.object({
          from: z.uuid(),
          to: z.union([z.uuid(), z.literal('current')]).default('current'),
        }),
        response: { 200: RevisionCompare },
      },
    },
    async (req) => {
      const { documentId } = req.params
      const access = await requireDocument(db, documentId, req.user!.id, 'work.read')
      const ids = [req.query.from, ...(req.query.to === 'current' ? [] : [req.query.to])]
      const snaps = await db
        .select()
        .from(documentSnapshots)
        .where(and(inArray(documentSnapshots.id, ids), eq(documentSnapshots.documentId, documentId)))
      const from = snaps.find((s) => s.id === req.query.from)
      const to = req.query.to === 'current' ? null : snaps.find((s) => s.id === req.query.to)
      if (!from || (req.query.to !== 'current' && !to)) throw notFound()
      const current = to
        ? null
        : ((await liveTexts([documentId], access.work.id, req.user!.id)).get(documentId) ?? EMPTY)
      const changes = diffDocuments(from.contentJson as PMNode, to ? (to.contentJson as PMNode) : current!)
      const label = (s: typeof from) => s.label ?? (s.reason === 'auto' ? 'Autosave' : 'Saved version')
      return {
        from: { label: label(from), createdAt: from.createdAt.toISOString() },
        to: to
          ? { label: label(to), createdAt: to.createdAt.toISOString() }
          : { label: 'Now', createdAt: null },
        changes,
        summary: diffSummary(changes),
      }
    },
  )

  // ---- Branches (FR-018) ----
  app.get(
    '/branches/:branchId/compare',
    {
      schema: {
        params: z.object({ branchId: z.uuid() }),
        querystring: z.object({ with: z.uuid().optional() }),
        response: { 200: BranchCompare },
      },
    },
    async (req) => {
      const userId = req.user!.id
      const here = await requireBranch(db, req.params.branchId, userId, 'work.read')
      const otherId = req.query.with ?? here.branch.parentBranchId
      if (!otherId) throw conflict('Main has no parent to compare with. Choose a branch.')
      const there = await requireBranch(db, otherId, userId, 'work.read')
      if (there.branch.workId !== here.branch.workId) throw notFound()
      const [a, b] = await Promise.all([liveChapters(db, here.branch.id), liveChapters(db, there.branch.id)])
      const pairs = await pairChapters(db, here.branch.workId, a, b)
      const texts = await liveTexts(
        [...a, ...b].map((c) => c.documentId),
        here.branch.workId,
        userId,
      )
      return {
        branch: { id: here.branch.id, name: here.branch.name },
        other: { id: there.branch.id, name: there.branch.name },
        canMerge: here.branch.parentBranchId === there.branch.id && there.canWrite,
        chapters: pairs.map(({ here: h, there: t }) => {
          const before = t ? (texts.get(t.documentId) ?? EMPTY) : EMPTY
          const after = h ? (texts.get(h.documentId) ?? EMPTY) : EMPTY
          const changes = diffDocuments(before, after)
          const summary = diffSummary(changes)
          const status: 'same' | 'changed' | 'only_here' | 'only_there' = !t
            ? 'only_here'
            : !h
              ? 'only_there'
              : isUnchanged(summary) && h.title === t.title
                ? 'same'
                : 'changed'
          return {
            title: (h ?? t)!.title,
            status,
            chapterId: h?.id ?? null,
            otherChapterId: t?.id ?? null,
            otherTitle: t?.title ?? null,
            changes: status === 'same' ? [] : changes,
            summary,
          }
        }),
      }
    },
  )

  /**
   * Merge a branch into its parent (FR-018). Two phases: classify every changed chapter against the parent's live
   * text, and stop if anything overlaps (nothing changes); otherwise apply each chapter's own changes. Each apply is
   * idempotent, so a retry after a partial failure completes the merge without applying anything twice.
   */
  app.post(
    '/branches/:branchId/merge',
    {
      schema: { params: z.object({ branchId: z.uuid() }), response: { 200: MergeResult } },
      config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
    },
    async (req, reply) => {
      const userId = req.user!.id
      const source = await requireBranch(db, req.params.branchId, userId, 'work.read')
      if (!source.branch.parentBranchId)
        throw conflict('Main can’t be merged; merge a branch into Main instead.')
      // Merging changes the parent: it needs the same right as writing there directly.
      const target = await requireBranch(db, source.branch.parentBranchId, userId, 'branch.write')
      return idempotent(db, req, reply, 200, () =>
        db.transaction(async (lock) => {
          // This transaction only holds the "one merge of this branch at a time" lock. Every write below commits on
          // its own, because collab (a separate service) must see new documents; that's safe because each step is
          // idempotent (applied markers; added chapters pair up by lineage on a retry).
          await lock.execute(sql`select pg_advisory_xact_lock(hashtext(${'merge:' + source.branch.id}))`)
          const [a, b] = await Promise.all([
            liveChapters(db, source.branch.id),
            liveChapters(db, target.branch.id),
          ])
          const pairs = await pairChapters(db, source.branch.workId, a, b)
          const texts = await liveTexts(
            [...a, ...b].map((c) => c.documentId),
            source.branch.workId,
            userId,
          )
          const outcomes: {
            title: string
            outcome: z.infer<typeof MergeResult>['chapters'][number]['outcome']
            blockIds?: string[]
          }[] = []
          type Outcome = (typeof outcomes)[number]
          const toApply: { s: ChapterRow; t: ChapterRow; baseSnapshotId: string; o: Outcome }[] = []
          const toAdd: { s: ChapterRow; after: ChapterRow | null }[] = []

          // Phase 1: classify. Nothing changes yet.
          let previousTarget: ChapterRow | null = null
          for (const { here: s, there: t } of pairs) {
            if (s && t) {
              previousTarget = t
              const base = s.mergeBaseSnapshotId ?? s.forkSnapshotId
              if (!base) {
                outcomes.push({ title: s.title, outcome: 'conflict', blockIds: [] })
                continue
              }
              const unchanged = isUnchanged(
                diffSummary(
                  diffDocuments(texts.get(t.documentId) ?? EMPTY, texts.get(s.documentId) ?? EMPTY),
                ),
              )
              const { classification } = await collab.classifyProposal({
                proposalId: 'merge-check',
                workId: s.workId,
                targetDocumentId: t.documentId,
                workspaceDocumentId: s.documentId,
                baseSnapshotId: base,
                userId,
              })
              if (classification.kind === 'conflict')
                outcomes.push({ title: s.title, outcome: 'conflict', blockIds: classification.blockIds })
              else if (unchanged) outcomes.push({ title: s.title, outcome: 'unchanged' })
              else {
                const o: Outcome = { title: s.title, outcome: 'merged' }
                outcomes.push(o)
                toApply.push({ s, t, baseSnapshotId: base, o })
              }
            } else if (s) {
              outcomes.push({ title: s.title, outcome: 'added' })
              toAdd.push({ s, after: previousTarget })
            } else if (t) {
              previousTarget = t
              // Deleted in the branch, or added to the parent since: merging never deletes chapters.
              outcomes.push({ title: t.title, outcome: 'kept' })
            }
          }
          const record = (status: 'merged' | 'conflict' | 'partial') =>
            db.transaction(async (tx) => {
              const [m] = await tx
                .insert(branchMerges)
                .values({
                  workId: source.branch.workId,
                  sourceBranchId: source.branch.id,
                  targetBranchId: target.branch.id,
                  mergedBy: userId,
                  status,
                  report: { chapters: outcomes },
                })
                .returning()
              await recordActivity(tx, {
                workId: source.branch.workId,
                actorId: userId,
                type: status === 'merged' ? 'branch.merged' : `branch.merge_${status}`,
                subjectType: 'branch',
                subjectId: source.branch.id,
                data: { into: target.branch.id, mergeId: m!.id },
              })
              return { mergeId: m!.id, status, chapters: outcomes }
            })
          if (outcomes.some((o) => o.outcome === 'conflict')) {
            for (const o of outcomes)
              if (o.outcome === 'merged' || o.outcome === 'added') o.outcome = 'not_attempted'
            return record('conflict')
          }

          // Phase 2: apply. The parent may still change in the meantime; each apply re-checks and refuses overlaps.
          for (const { s, t, baseSnapshotId, o } of toApply) {
            const result = await collab.applyProposal({
              proposalId: `merge:${s.id}:${baseSnapshotId}`,
              workId: s.workId,
              targetDocumentId: t.documentId,
              workspaceDocumentId: s.documentId,
              baseSnapshotId,
              userId,
            })
            if (!result.ok) {
              o.outcome = 'conflict'
              if (result.classification.kind === 'conflict') o.blockIds = result.classification.blockIds
              for (const rest of outcomes) if (rest.outcome === 'added') rest.outcome = 'not_attempted'
              return record('partial')
            }
            // The branch chapter as merged is the next merge's starting point.
            if (result.workspaceSnapshotId)
              await db
                .update(chapters)
                .set({ mergeBaseSnapshotId: result.workspaceSnapshotId })
                .where(eq(chapters.id, s.id))
          }
          // Consecutive new chapters chain: each goes after the one just added, so their order is kept.
          let chainFrom: { after: ChapterRow | null; added: string } | null = null
          for (const { s, after } of toAdd) {
            // A chapter written in the branch joins the parent as a lineage-preserving copy, after its predecessor.
            const [doc] = await db
              .insert(documents)
              .values({ workId: s.workId, kind: 'chapter', schemaVersion: SCHEMA_VERSION })
              .returning()
            const afterId =
              chainFrom && chainFrom.after?.id === after?.id ? chainFrom.added : after ? after.id : null
            // Positions see chapters added a moment ago: each write has already committed.
            const position = await positionAfter(db, target.branch.id, afterId)
            const [added] = await db
              .insert(chapters)
              .values({
                workId: s.workId,
                branchId: target.branch.id,
                documentId: doc!.id,
                title: s.title,
                description: s.description,
                position,
                originChapterId: s.id,
              })
              .returning()
            chainFrom = { after, added: added!.id }
            const fork = await collab.forkDocument({
              sourceDocumentId: s.documentId,
              targetDocumentId: doc!.id,
              workId: s.workId,
              createdBy: userId,
            })
            if (fork.forkSnapshotId)
              await db
                .update(chapters)
                .set({ mergeBaseSnapshotId: fork.forkSnapshotId })
                .where(eq(chapters.id, s.id))
          }
          return record('merged')
        }),
      )
    },
  )

  /**
   * Reconcile (FR-018): bring the parent's newer changes into this branch. Where both changed the same paragraph,
   * the branch keeps its own version (to review by hand) and the number of contested paragraphs is reported;
   * afterwards the branch is re-based on the parent state it took in, so the next merge applies cleanly.
   */
  app.post(
    '/branches/:branchId/update-from-parent',
    {
      schema: {
        params: z.object({ branchId: z.uuid() }),
        response: {
          200: z.object({ chapters: z.array(z.object({ title: z.string(), contested: z.number().int() })) }),
        },
      },
      config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
    },
    async (req) => {
      const userId = req.user!.id
      const source = await requireBranch(db, req.params.branchId, userId, 'branch.write')
      if (!source.branch.parentBranchId) throw conflict('Main has no parent to update from.')
      const target = await requireBranch(db, source.branch.parentBranchId, userId, 'work.read')
      const [a, b] = await Promise.all([
        liveChapters(db, source.branch.id),
        liveChapters(db, target.branch.id),
      ])
      const out: { title: string; contested: number }[] = []
      for (const { here: s, there: t } of await pairChapters(db, source.branch.workId, a, b)) {
        const base = s?.mergeBaseSnapshotId ?? s?.forkSnapshotId
        if (!s || !t || !base) continue
        const r = await collab.refreshProposal({
          proposalId: `update:${s.id}`,
          workId: s.workId,
          targetDocumentId: t.documentId,
          workspaceDocumentId: s.documentId,
          baseSnapshotId: base,
          userId,
        })
        await db.update(chapters).set({ mergeBaseSnapshotId: r.baseSnapshotId }).where(eq(chapters.id, s.id))
        out.push({ title: s.title, contested: r.reference.length })
      }
      return { chapters: out }
    },
  )

  app.get(
    '/branches/:branchId/merges',
    {
      schema: {
        params: z.object({ branchId: z.uuid() }),
        response: {
          200: z.object({
            items: z.array(
              z.object({ id: z.uuid(), status: z.string(), createdAt: z.string(), report: z.unknown() }),
            ),
          }),
        },
      },
    },
    async (req) => {
      const { branch } = await requireBranch(db, req.params.branchId, req.user!.id, 'work.read')
      const rows = await db
        .select()
        .from(branchMerges)
        .where(eq(branchMerges.sourceBranchId, branch.id))
        .orderBy(sql`${branchMerges.createdAt} desc`)
        .limit(20)
      return {
        items: rows.map((r) => ({
          id: r.id,
          status: r.status,
          createdAt: r.createdAt.toISOString(),
          report: r.report,
        })),
      }
    },
  )
}

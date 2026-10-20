import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod'
import { z } from 'zod'
import { and, asc, eq, isNull, sql } from 'drizzle-orm'
import { alias } from 'drizzle-orm/pg-core'
import {
  Branch,
  Chapter,
  CreateBranchInput,
  CreateChapterInput,
  RestoreInput,
  UpdateBranchInput,
  PROBLEM,
} from '@morrow/contracts'
import { branches, chapters, documentProjections, documents, user, type Database } from '@morrow/db'
import { capabilitiesFor } from '@morrow/domain'
import { toAccessContext } from '@morrow/db'
import { SCHEMA_VERSION, workToMarkdown, type PMNode } from '@morrow/editor'
import type { CollabGateway } from '../collab-gateway.ts'
import { requireBranch, requireDocument, requireWork } from '../access.ts'
import { recordActivity } from '../activity.ts'
import { assertCanAddBranch, assertCanExport } from '../entitlements.ts'
import { idempotent } from '../idempotency.ts'
import { conflict, forbidden, HttpProblem, notFound } from '../problems.ts'
import { slugify } from '../slug.ts'
import { createChapterIn, toChapter } from './chapters.ts'

const BranchParams = z.object({ branchId: z.uuid() })
const parent = alias(branches, 'parent')
const divergeAt = alias(chapters, 'diverge_at')

/** Branch rows with display lineage, creator name and chapter count, for one work. */
async function branchRows(db: Database, workId: string, branchId?: string) {
  return db
    .select({
      b: branches,
      parentName: parent.name,
      creatorName: user.name,
      divergesAtTitle: divergeAt.title,
      chapterCount: sql<number>`(select count(*)::int from ${chapters} c where c.branch_id = ${branches.id} and c.deleted_at is null)`,
    })
    .from(branches)
    .leftJoin(parent, eq(parent.id, branches.parentBranchId))
    .leftJoin(divergeAt, eq(divergeAt.id, branches.divergesAtChapterId))
    .innerJoin(user, eq(user.id, branches.createdBy))
    .where(
      and(
        eq(branches.workId, workId),
        isNull(branches.archivedAt),
        sql`(${branches.forkedAt} is not null or ${branches.isDefault})`,
        branchId ? eq(branches.id, branchId) : undefined,
      ),
    )
    .orderBy(sql`${branches.isDefault} desc`, asc(branches.createdAt))
}

type Row = Awaited<ReturnType<typeof branchRows>>[number]
function toBranch(r: Row, capabilities: Branch['capabilities']): Branch {
  return {
    id: r.b.id,
    workId: r.b.workId,
    name: r.b.name,
    slug: r.b.slug,
    description: r.b.description,
    status: r.b.status,
    isDefault: r.b.isDefault,
    parentBranchId: r.b.parentBranchId,
    parentBranchName: r.parentName,
    createdBy: r.b.createdBy,
    createdByName: r.creatorName,
    divergesAtChapterTitle: r.divergesAtTitle,
    chapterCount: r.chapterCount,
    createdAt: r.b.createdAt.toISOString(),
    capabilities,
  }
}

export const branchRoutes: FastifyPluginAsyncZod<{ db: Database; collab: CollabGateway }> = async (
  app,
  { db, collab },
) => {
  app.get(
    '/works/:workId/branches',
    {
      schema: {
        params: z.object({ workId: z.uuid() }),
        response: { 200: z.object({ items: z.array(Branch) }) },
      },
    },
    async (req) => {
      const userId = req.user!.id
      const access = await requireWork(db, req.params.workId, userId, 'work.read')
      const rows = await branchRows(db, access.work.id)
      return {
        items: rows.map((r) =>
          toBranch(
            r,
            capabilitiesFor(
              { userId },
              toAccessContext({ ...access, branch: { createdBy: r.b.createdBy, isDefault: r.b.isDefault } }),
            ),
          ),
        ),
      }
    },
  )

  /**
   * Create a branch (architecture §10): metadata in one transaction, then collab forks every chapter's live state
   * (preserving Yjs lineage). The branch only becomes visible once every chapter is forked; if forking fails part
   * way, the half-made branch is archived rather than shown.
   */
  app.post(
    '/works/:workId/branches',
    {
      schema: { params: z.object({ workId: z.uuid() }), body: CreateBranchInput, response: { 201: Branch } },
      config: { rateLimit: { max: 20, timeWindow: '1 hour' } },
    },
    async (req, reply) => {
      const userId = req.user!.id
      const access = await requireWork(db, req.params.workId, userId, 'branch.create')
      const source = await requireBranch(db, req.body.fromBranchId, userId, 'work.read')
      if (source.branch.workId !== access.work.id) throw notFound()
      await assertCanAddBranch(db, access.work.id, access.work.ownerId)

      const created = await idempotent(db, req, reply, 201, async () => {
        const sourceChapters = await db
          .select()
          .from(chapters)
          .where(and(eq(chapters.branchId, source.branch.id), isNull(chapters.deletedAt)))
          .orderBy(asc(chapters.position))
        if (
          req.body.divergesAtChapterId &&
          !sourceChapters.some((c) => c.id === req.body.divergesAtChapterId)
        )
          throw conflict('That chapter isn’t in the branch you’re starting from.')

        const { branch, pairs } = await db.transaction(async (tx) => {
          const [b] = await tx
            .insert(branches)
            .values({
              workId: access.work.id,
              parentBranchId: source.branch.id,
              name: req.body.name,
              slug: slugify(req.body.name),
              description: req.body.description,
              createdBy: userId,
              divergesAtChapterId: req.body.divergesAtChapterId ?? null,
              visibility: 'private', // never automatically public (FR-018)
            })
            .returning()
          const pairs: { origin: typeof chapters.$inferSelect; chapterId: string; documentId: string }[] = []
          for (const origin of sourceChapters) {
            const [d] = await tx
              .insert(documents)
              .values({ workId: access.work.id, kind: 'chapter', schemaVersion: SCHEMA_VERSION })
              .returning()
            const [c] = await tx
              .insert(chapters)
              .values({
                workId: access.work.id,
                branchId: b!.id,
                documentId: d!.id,
                title: origin.title,
                position: origin.position,
                originChapterId: origin.id,
              })
              .returning()
            pairs.push({ origin, chapterId: c!.id, documentId: d!.id })
          }
          return { branch: b!, pairs }
        })

        try {
          for (const p of pairs) {
            const { forkSnapshotId } = await collab.forkDocument({
              sourceDocumentId: p.origin.documentId,
              targetDocumentId: p.documentId,
              workId: access.work.id,
              createdBy: userId,
            })
            if (forkSnapshotId)
              await db.update(chapters).set({ forkSnapshotId }).where(eq(chapters.id, p.chapterId))
          }
        } catch (err) {
          req.log.error({ err, branchId: branch.id }, 'branch fork failed; archiving the partial branch')
          await db
            .update(branches)
            .set({ archivedAt: sql`now()` })
            .where(eq(branches.id, branch.id))
          throw new HttpProblem(
            502,
            PROBLEM.internal,
            'Couldn’t create the branch. Nothing was changed — please try again.',
          )
        }

        await db.transaction(async (tx) => {
          await tx
            .update(branches)
            .set({ forkedAt: sql`now()` })
            .where(eq(branches.id, branch.id))
          await recordActivity(tx, {
            workId: access.work.id,
            actorId: userId,
            type: 'branch.created',
            subjectType: 'branch',
            subjectId: branch.id,
            data: { from: source.branch.id, chapters: pairs.length },
          })
        })
        const [row] = await branchRows(db, access.work.id, branch.id)
        return toBranch(
          row!,
          capabilitiesFor(
            { userId },
            toAccessContext({ ...access, branch: { createdBy: userId, isDefault: false } }),
          ),
        )
      })
      return reply.status(201).send(created)
    },
  )

  app.patch(
    '/branches/:branchId',
    { schema: { params: BranchParams, body: UpdateBranchInput, response: { 200: Branch } } },
    async (req) => {
      const userId = req.user!.id
      const access = await requireBranch(db, req.params.branchId, userId, 'branch.write')
      // Choosing the "selected" version for publication is an owner decision (it shapes what readers see).
      if (req.body.status === 'selected' && !access.capabilities.includes('work.publish')) throw forbidden()
      if (access.branch.isDefault && req.body.status === 'abandoned')
        throw conflict('The main branch can’t be abandoned.')
      await db.transaction(async (tx) => {
        if (req.body.status === 'selected')
          await tx
            .update(branches)
            .set({ status: 'active' })
            .where(and(eq(branches.workId, access.work.id), eq(branches.status, 'selected')))
        await tx
          .update(branches)
          .set({ ...req.body, ...(req.body.name ? { slug: slugify(req.body.name) } : {}) })
          .where(eq(branches.id, access.branch.id))
        await recordActivity(tx, {
          workId: access.work.id,
          actorId: userId,
          type: 'branch.updated',
          subjectType: 'branch',
          subjectId: access.branch.id,
          data: { fields: Object.keys(req.body), status: req.body.status },
        })
      })
      const [row] = await branchRows(db, access.work.id, access.branch.id)
      return toBranch(row!, access.capabilities)
    },
  )

  app.delete('/branches/:branchId', { schema: { params: BranchParams } }, async (req, reply) => {
    const userId = req.user!.id
    const access = await requireBranch(db, req.params.branchId, userId, 'work.read')
    if (access.branch.isDefault) throw conflict('The main branch can’t be archived.')
    // Archiving someone's direction is for its creator or the owner, not any editor.
    if (access.branch.createdBy !== userId && access.work.ownerId !== userId) throw forbidden()
    await db.transaction(async (tx) => {
      await tx
        .update(branches)
        .set({ archivedAt: sql`now()` })
        .where(eq(branches.id, access.branch.id))
      await recordActivity(tx, {
        workId: access.work.id,
        actorId: userId,
        type: 'branch.archived',
        subjectType: 'branch',
        subjectId: access.branch.id,
      })
    })
    return reply.status(204).send()
  })

  app.get(
    '/branches/:branchId/chapters',
    { schema: { params: BranchParams, response: { 200: z.object({ items: z.array(Chapter) }) } } },
    async (req) => {
      const { branch } = await requireBranch(db, req.params.branchId, req.user!.id, 'work.read')
      const rows = await db
        .select({ c: chapters, words: sql<number>`coalesce(${documentProjections.wordCount}, 0)` })
        .from(chapters)
        .leftJoin(documentProjections, eq(documentProjections.documentId, chapters.documentId))
        .where(
          and(
            eq(chapters.workId, branch.workId),
            eq(chapters.branchId, branch.id),
            isNull(chapters.deletedAt),
          ),
        )
        .orderBy(asc(chapters.position))
      return { items: rows.map((r) => toChapter(r.c, r.words)) }
    },
  )

  app.post(
    '/branches/:branchId/chapters',
    { schema: { params: BranchParams, body: CreateChapterInput, response: { 201: Chapter } } },
    async (req, reply) => {
      const userId = req.user!.id
      const { branch } = await requireBranch(db, req.params.branchId, userId, 'branch.write')
      const chapter = await idempotent(db, req, reply, 201, () =>
        createChapterIn(db, branch, userId, req.body),
      )
      return reply.status(201).send(chapter)
    },
  )

  app.get(
    '/chapters/:chapterId',
    { schema: { params: z.object({ chapterId: z.uuid() }), response: { 200: Chapter } } },
    async (req) => {
      const [c] = await db
        .select()
        .from(chapters)
        .where(and(eq(chapters.id, req.params.chapterId), isNull(chapters.deletedAt)))
      if (!c) throw notFound()
      await requireBranch(db, c.branchId, req.user!.id, 'work.read')
      const [p] = await db
        .select({ n: documentProjections.wordCount })
        .from(documentProjections)
        .where(eq(documentProjections.documentId, c.documentId))
      return toChapter(c, p?.n ?? 0)
    },
  )

  // Restore an earlier version as a new change (FR-019): history is never erased.
  app.post(
    '/documents/:documentId/restore',
    {
      schema: {
        params: z.object({ documentId: z.uuid() }),
        body: RestoreInput,
        response: { 200: z.object({ preRestoreSnapshotId: z.uuid().nullable() }) },
      },
    },
    async (req) => {
      const userId = req.user!.id
      const access = await requireDocument(db, req.params.documentId, userId, 'document.write')
      const result = await collab.restoreDocument({
        documentId: req.params.documentId,
        snapshotId: req.body.snapshotId,
        workId: access.work.id,
        createdBy: userId,
      })
      await db.transaction((tx) =>
        recordActivity(tx, {
          workId: access.work.id,
          actorId: userId,
          type: 'document.restored',
          subjectType: 'document',
          subjectId: req.params.documentId,
          data: { snapshotId: req.body.snapshotId },
        }),
      )
      return result
    },
  )

  // Data portability (Q-008): a branch as Markdown, from projections, never from live state.
  app.get('/branches/:branchId/export.md', { schema: { params: BranchParams } }, async (req, reply) => {
    const { branch, work } = await requireBranch(db, req.params.branchId, req.user!.id, 'work.read')
    await assertCanExport(db, req.user!.id, 'markdown')
    const rows = await db
      .select({ title: chapters.title, content: documentProjections.contentJson })
      .from(chapters)
      .leftJoin(documentProjections, eq(documentProjections.documentId, chapters.documentId))
      .where(and(eq(chapters.branchId, branch.id), isNull(chapters.deletedAt)))
      .orderBy(asc(chapters.position))
    const title = branch.isDefault ? work.title : `${work.title} — ${branch.name}`
    const md = workToMarkdown(
      title,
      rows.map((r) => ({ title: r.title, content: (r.content ?? { type: 'doc' }) as PMNode })),
    )
    return reply
      .header('content-type', 'text/markdown; charset=utf-8')
      .header('content-disposition', `attachment; filename="${slugify(title)}.md"`)
      .send(md)
  })
}

import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod'
import { z } from 'zod'
import { and, asc, eq, isNotNull, isNull, sql } from 'drizzle-orm'
import { alias } from 'drizzle-orm/pg-core'
import { AlternateStatus, PROBLEM, PublishAlternateInput } from '@morrow/contracts'
import { alternatePublications, branches, chapters, type Database } from '@morrow/db'
import type { CollabGateway } from '../collab-gateway.ts'
import { requireWork } from '../access.ts'
import { recordActivity } from '../activity.ts'
import { chapterCredits } from '../credits.ts'
import { conflict, HttpProblem, notFound } from '../problems.ts'
import { livePublications } from './publishing.ts'

const WorkParams = z.object({ workId: z.uuid() })
const BranchParams = z.object({ workId: z.uuid(), branchId: z.uuid() })
const origin = alias(chapters, 'origin')
const divergeAt = alias(chapters, 'diverge_at')

/** Each published alternate's chapters in reading order, keyed by branch. */
export async function liveAlternates(db: Database, workId: string) {
  const rows = await db
    .select()
    .from(alternatePublications)
    .where(and(eq(alternatePublications.workId, workId), isNull(alternatePublications.supersededAt)))
    .orderBy(asc(alternatePublications.position))
  const byBranch = new Map<string, typeof rows>()
  for (const r of rows) byBranch.set(r.branchId, [...(byBranch.get(r.branchId) ?? []), r])
  return byBranch
}

/** A branch of this work that still exists and finished forking; anything else is not found. */
async function branchOf(db: Database, workId: string, branchId: string) {
  const [b] = await db
    .select()
    .from(branches)
    .where(
      and(
        eq(branches.id, branchId),
        eq(branches.workId, workId),
        isNull(branches.archivedAt),
        isNotNull(branches.forkedAt),
      ),
    )
  if (!b) throw notFound()
  return b
}

/**
 * Alternate versions (spec calls 1–3): published beside the main story, never instead of it. Publishing one is the
 * owner's decision (`work.publish`), not the branch writer's.
 */
export const alternateRoutes: FastifyPluginAsyncZod<{ db: Database; collab: CollabGateway }> = async (
  app,
  { db, collab },
) => {
  app.get(
    '/works/:workId/alternates',
    { schema: { params: WorkParams, response: { 200: z.object({ items: z.array(AlternateStatus) }) } } },
    async (req) => {
      const { work } = await requireWork(db, req.params.workId, req.user!.id, 'work.publish')
      const [main] = await livePublications(db, work.id)
      const live = await liveAlternates(db, work.id)
      // ponytail: unpaginated like GET /works/:workId/branches; a work's branch count is plan-limited
      const list = await db
        .select({ id: branches.id, name: branches.name })
        .from(branches)
        .where(
          and(
            eq(branches.workId, work.id),
            eq(branches.isDefault, false),
            isNull(branches.archivedAt),
            isNotNull(branches.forkedAt),
          ),
        )
        .orderBy(asc(branches.createdAt))
      return {
        items: list
          .filter((b) => b.id !== main?.branchId)
          .map((b) => ({
            branchId: b.id,
            name: b.name,
            published: live.has(b.id),
            chapterCount: live.get(b.id)?.length ?? 0,
          })),
      }
    },
  )

  /**
   * Pin the branch's chapters from where it diverges. The chapters before that are main's current publication,
   * so readers of the alternate keep getting main's fixes to the shared opening.
   */
  app.post(
    '/works/:workId/branches/:branchId/publish-alternate',
    { schema: { params: BranchParams, body: PublishAlternateInput, response: { 200: AlternateStatus } } },
    async (req) => {
      const userId = req.user!.id
      const { work } = await requireWork(db, req.params.workId, userId, 'work.publish')
      const branch = await branchOf(db, work.id, req.params.branchId)
      if (work.hiddenAt)
        throw new HttpProblem(
          409,
          PROBLEM.conflict,
          'This work is under review.',
          'A moderator has hidden it. See your account’s moderation page for details and appeals.',
        )
      const main = await livePublications(db, work.id)
      if (!work.publishedAt || !main.length) throw conflict('Publish the main story first.')
      // No alternates of alternates in this round: the parent must be the version readers get as main.
      if (branch.parentBranchId !== main[0]!.branchId)
        throw conflict(
          'Only a version that branches from the published main story can be published beside it.',
        )
      const divergesAt = branch.divergesAtChapterId ?? req.body.divergesAtChapterId
      if (!divergesAt) throw conflict('Choose the first chapter where this version differs.')
      const at = main.findIndex((p) => p.chapterId === divergesAt)
      if (at === -1) throw conflict('This version must differ from a published chapter of the main story.')
      // Readers are offered the choice at the end of the chapter before it, so there must be one.
      if (at === 0)
        throw conflict('This version differs from the first chapter, so it has nothing to share with main.')
      const afterPosition = main[at - 1]!.position

      const own = await db
        .select({
          c: chapters,
          // a copy of a main chapter before the divergence: readers get main's published version of it instead
          shared: sql<boolean>`coalesce(${origin.position} < ${divergeAt.position}, false)`,
        })
        .from(chapters)
        .leftJoin(origin, eq(origin.id, chapters.originChapterId))
        .innerJoin(divergeAt, eq(divergeAt.id, divergesAt))
        .where(and(eq(chapters.branchId, branch.id), isNull(chapters.deletedAt)))
        .orderBy(asc(chapters.position))
      // The branch's own new chapters count from where the shared opening ends, even if its copy of the
      // divergence chapter was deleted.
      const lastShared = own.findLastIndex((r) => r.shared)
      const diverging = own
        .filter((r, i) => !r.shared && (r.c.originChapterId !== null || i > lastShared))
        .map((r) => r.c)
      if (!diverging.length) throw conflict('This version has no chapters of its own from that point.')

      const pinned: {
        chapter: (typeof diverging)[number]
        snap: Awaited<ReturnType<CollabGateway['createSnapshot']>>
      }[] = []
      for (const c of diverging)
        pinned.push({
          chapter: c,
          snap: await collab.createSnapshot({
            documentId: c.documentId,
            workId: work.id,
            label: 'Published',
            createdBy: userId,
            reason: 'publish',
          }),
        })
      const before = new Date()
      const credits = await Promise.all(
        pinned.map(({ chapter }) =>
          chapterCredits(db, {
            workId: work.id,
            ownerId: work.ownerId,
            chapterId: chapter.id,
            documentId: chapter.documentId,
            before,
          }),
        ),
      )
      await db.transaction(async (tx) => {
        await tx
          .update(alternatePublications)
          .set({ supersededAt: sql`now()` })
          .where(
            and(eq(alternatePublications.branchId, branch.id), isNull(alternatePublications.supersededAt)),
          )
        await tx.insert(alternatePublications).values(
          pinned.map(({ chapter, snap }, i) => ({
            workId: work.id,
            branchId: branch.id,
            chapterId: chapter.id,
            snapshotId: snap.id,
            title: chapter.title,
            position: chapter.position,
            wordCount: snap.wordCount,
            afterPosition,
            publishedBy: userId,
            credits: credits[i]!,
          })),
        )
        // the owner's pick becomes the branch's recorded divergence, so republishing needs no choice
        if (!branch.divergesAtChapterId)
          await tx.update(branches).set({ divergesAtChapterId: divergesAt }).where(eq(branches.id, branch.id))
        await recordActivity(tx, {
          workId: work.id,
          actorId: userId,
          type: 'work.alternate_published',
          subjectType: 'branch',
          subjectId: branch.id,
          data: { chapters: pinned.length },
        })
      })
      return { branchId: branch.id, name: branch.name, published: true, chapterCount: pinned.length }
    },
  )

  app.post(
    '/works/:workId/branches/:branchId/unpublish-alternate',
    { schema: { params: BranchParams, response: { 200: AlternateStatus } } },
    async (req) => {
      const userId = req.user!.id
      const { work } = await requireWork(db, req.params.workId, userId, 'work.publish')
      const branch = await branchOf(db, work.id, req.params.branchId)
      await db.transaction(async (tx) => {
        await tx
          .update(alternatePublications)
          .set({ supersededAt: sql`now()` })
          .where(
            and(eq(alternatePublications.branchId, branch.id), isNull(alternatePublications.supersededAt)),
          )
        await recordActivity(tx, {
          workId: work.id,
          actorId: userId,
          type: 'work.alternate_unpublished',
          subjectType: 'branch',
          subjectId: branch.id,
        })
      })
      return { branchId: branch.id, name: branch.name, published: false, chapterCount: 0 }
    },
  )
}

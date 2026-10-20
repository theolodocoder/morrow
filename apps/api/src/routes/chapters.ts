import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod'
import { z } from 'zod'
import { and, asc, eq, gt, isNull, sql } from 'drizzle-orm'
import { generateKeyBetween } from 'fractional-indexing'
import { Chapter, CreateChapterInput, UpdateChapterInput } from '@morrow/contracts'
import { branches, chapters, documentProjections, documents, type Database } from '@morrow/db'
import { SCHEMA_VERSION } from '@morrow/editor'
import { requireBranch, requireWork } from '../access.ts'
import { supersedeProposalsFor } from './proposals.ts'
import { recordActivity } from '../activity.ts'
import { idempotent } from '../idempotency.ts'
import { conflict, forbidden, notFound } from '../problems.ts'
import type { CollabGateway } from '../collab-gateway.ts'
import { reconnectMembers } from './works.ts'

const live = (branchId: string) => and(eq(chapters.branchId, branchId), isNull(chapters.deletedAt))

export function toChapter(c: typeof chapters.$inferSelect, wordCount: number): Chapter {
  return {
    id: c.id,
    workId: c.workId,
    branchId: c.branchId,
    documentId: c.documentId,
    title: c.title,
    description: c.description,
    collaborationMode: c.collaborationMode,
    position: c.position,
    wordCount,
    updatedAt: c.updatedAt.toISOString(),
  }
}

/** Fractional position right after `afterId` (or at the start when `afterId` is null). */
export async function positionAfter(
  db: Database,
  branchId: string,
  afterId: string | null | undefined,
): Promise<string> {
  if (afterId === undefined) {
    const [last] = await db
      .select({ p: chapters.position })
      .from(chapters)
      .where(live(branchId))
      .orderBy(sql`${chapters.position} desc`)
      .limit(1)
    return generateKeyBetween(last?.p ?? null, null)
  }
  let lower: string | null = null
  if (afterId !== null) {
    const [after] = await db
      .select({ p: chapters.position })
      .from(chapters)
      .where(and(live(branchId), eq(chapters.id, afterId)))
    if (!after) throw notFound()
    lower = after.p
  }
  const [next] = await db
    .select({ p: chapters.position })
    .from(chapters)
    .where(and(live(branchId), lower ? gt(chapters.position, lower) : undefined))
    .orderBy(asc(chapters.position))
    .limit(1)
  return generateKeyBetween(lower, next?.p ?? null)
}

export const chapterRoutes: FastifyPluginAsyncZod<{ db: Database; collab: CollabGateway }> = async (
  app,
  { db, collab },
) => {
  app.get(
    '/works/:workId/chapters',
    {
      schema: {
        params: z.object({ workId: z.uuid() }),
        response: { 200: z.object({ items: z.array(Chapter) }) },
      },
    },
    async (req) => {
      const { work } = await requireWork(db, req.params.workId, req.user!.id, 'work.read')
      const rows = await db
        .select({ c: chapters, words: sql<number>`coalesce(${documentProjections.wordCount}, 0)` })
        .from(chapters)
        .leftJoin(documentProjections, eq(documentProjections.documentId, chapters.documentId))
        .where(and(eq(chapters.workId, work.id), live(work.defaultBranchId!)))
        .orderBy(asc(chapters.position))
      return { items: rows.map((r) => toChapter(r.c, r.words)) }
    },
  )

  app.post(
    '/works/:workId/chapters',
    {
      schema: {
        params: z.object({ workId: z.uuid() }),
        body: CreateChapterInput,
        response: { 201: Chapter },
      },
    },
    async (req, reply) => {
      const userId = req.user!.id
      const { work } = await requireWork(db, req.params.workId, userId, 'document.edit')
      const [branch] = await db.select().from(branches).where(eq(branches.id, work.defaultBranchId!))
      const chapter = await idempotent(db, req, reply, 201, () =>
        createChapterIn(db, branch!, userId, req.body),
      )
      return reply.status(201).send(chapter)
    },
  )

  app.patch(
    '/chapters/:chapterId',
    {
      schema: {
        params: z.object({ chapterId: z.uuid() }),
        body: UpdateChapterInput,
        response: { 200: Chapter },
      },
    },
    async (req) => {
      const userId = req.user!.id
      const [existing] = await db
        .select()
        .from(chapters)
        .where(and(eq(chapters.id, req.params.chapterId), isNull(chapters.deletedAt)))
      if (!existing) throw notFound()
      const access = await requireBranch(db, existing.branchId, userId, 'branch.write')
      const modeChange =
        req.body.collaborationMode !== undefined && req.body.collaborationMode !== existing.collaborationMode
      // A section's collaboration rules are a work setting, like the work's own mode (FR-006, FR-013).
      if (modeChange && !access.capabilities.includes('work.manage_settings')) throw forbidden()
      if (req.body.moveAfterChapterId === existing.id)
        throw conflict('A chapter cannot be moved after itself.')
      const position =
        req.body.moveAfterChapterId !== undefined
          ? await positionAfter(db, existing.branchId, req.body.moveAfterChapterId)
          : undefined
      const updated = await db.transaction(async (tx) => {
        const [c] = await tx
          .update(chapters)
          .set({
            ...(req.body.title ? { title: req.body.title } : {}),
            ...(req.body.description !== undefined ? { description: req.body.description } : {}),
            ...(modeChange ? { collaborationMode: req.body.collaborationMode ?? null } : {}),
            ...(position ? { position } : {}),
            updatedAt: sql`now()`,
          })
          .where(eq(chapters.id, existing.id))
          .returning()
        await recordActivity(tx, {
          workId: existing.workId,
          actorId: userId,
          type: modeChange
            ? 'chapter.collaboration_mode_changed'
            : position
              ? 'chapter.moved'
              : 'chapter.updated',
          subjectType: 'chapter',
          subjectId: existing.id,
          ...(modeChange
            ? { data: { from: existing.collaborationMode, to: req.body.collaborationMode ?? null } }
            : {}),
        })
        return c!
      })
      if (modeChange) await reconnectMembers(db, collab, existing.workId, req.log)
      const [p] = await db
        .select({ n: documentProjections.wordCount })
        .from(documentProjections)
        .where(eq(documentProjections.documentId, updated.documentId))
      return toChapter(updated, p?.n ?? 0)
    },
  )

  app.delete(
    '/chapters/:chapterId',
    { schema: { params: z.object({ chapterId: z.uuid() }) } },
    async (req, reply) => {
      const userId = req.user!.id
      const [existing] = await db
        .select()
        .from(chapters)
        .where(and(eq(chapters.id, req.params.chapterId), isNull(chapters.deletedAt)))
      if (!existing) throw notFound()
      await requireBranch(db, existing.branchId, userId, 'branch.write')
      await db.transaction(async (tx) => {
        const [{ n }] = (await tx
          .select({ n: sql<number>`count(*)::int` })
          .from(chapters)
          .where(live(existing.branchId))) as [{ n: number }]
        if (n <= 1) throw conflict('A work needs at least one chapter.')
        await tx
          .update(chapters)
          .set({ deletedAt: sql`now()` })
          .where(eq(chapters.id, existing.id))
        // Open proposals against a deleted chapter can no longer apply (FR-014 "superseded").
        await supersedeProposalsFor(tx, existing.id, userId)
        await recordActivity(tx, {
          workId: existing.workId,
          actorId: userId,
          type: 'chapter.deleted',
          subjectType: 'chapter',
          subjectId: existing.id,
        })
      })
      return reply.status(204).send()
    },
  )
}

/** Create a chapter (and its document) in a branch, after `afterChapterId` or at the end. Shared by all branches. */
export async function createChapterIn(
  db: Database,
  branch: typeof branches.$inferSelect,
  userId: string,
  input: { title?: string; afterChapterId?: string },
): Promise<Chapter> {
  const position = await positionAfter(db, branch.id, input.afterChapterId)
  return db.transaction(async (tx) => {
    const [d] = await tx
      .insert(documents)
      .values({ workId: branch.workId, kind: 'chapter', schemaVersion: SCHEMA_VERSION })
      .returning()
    const [c] = await tx
      .insert(chapters)
      .values({
        workId: branch.workId,
        branchId: branch.id,
        documentId: d!.id,
        title: input.title ?? 'Untitled chapter',
        position,
      })
      .returning()
    await recordActivity(tx, {
      workId: branch.workId,
      actorId: userId,
      type: 'chapter.created',
      subjectType: 'chapter',
      subjectId: c!.id,
    })
    return toChapter(c!, 0)
  })
}

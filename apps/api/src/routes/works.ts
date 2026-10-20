import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod'
import { z } from 'zod'
import { and, desc, eq, isNull, lt, or, sql } from 'drizzle-orm'
import { generateKeyBetween } from 'fractional-indexing'
import { coverOf, CreateWorkInput, Page, UpdateWorkInput, Work } from '@morrow/contracts'
import { CAPABILITIES, capabilitiesFor } from '@morrow/domain'
import {
  branches,
  chapters,
  documentProjections,
  documents,
  toAccessContext,
  workMembers,
  works,
  type Database,
} from '@morrow/db'
import { SCHEMA_VERSION } from '@morrow/editor'
import { requireWork } from '../access.ts'
import { assertCanAddPrivateWork } from '../entitlements.ts'
import { recordActivity } from '../activity.ts'
import { idempotent } from '../idempotency.ts'
import { preconditionFailed } from '../problems.ts'
import { slugify } from '../slug.ts'
import type { CollabGateway } from '../collab-gateway.ts'

const PAGE_SIZE = 50
const WorkId = z.object({ workId: z.uuid() })

/** Words across live chapters of the default branch, from projections (never from document state). */
const wordCountSql = sql<number>`coalesce((
  select sum(p.word_count)::int from ${chapters} c join ${documentProjections} p on p.document_id = c.document_id
  where c.work_id = ${works.id} and c.branch_id = ${works.defaultBranchId} and c.deleted_at is null), 0)`
/** Last edit: metadata changes or the newest content projection, whichever is later. */
const lastEditedSql = sql<Date>`greatest(${works.updatedAt}, coalesce((select max(p.projected_at) from ${documentProjections} p where p.work_id = ${works.id}), ${works.updatedAt}))`

export function toWork(
  w: typeof works.$inferSelect,
  extra: {
    wordCount: number
    memberCount: number
    myRole: Work['myRole']
    updatedAt?: Date
    capabilities: Work['capabilities']
  },
): Work {
  return {
    id: w.id,
    cover: coverOf(w.id, w.cover),
    releaseDay: w.releaseDay,
    openRoles: w.openRoles as Work['openRoles'],
    title: w.title,
    slug: w.slug,
    description: w.description,
    category: w.form,
    tags: w.tags,
    contentWarnings: w.contentWarnings,
    reactionKinds: w.reactionKinds as Work['reactionKinds'],
    license: w.license,
    collaborationMode: w.collaborationMode,
    publicPath: `${w.slug}-${w.publicId}`,
    publishedAt: w.publishedAt?.toISOString() ?? null,
    completed: w.completedAt !== null,
    visibility: w.visibility,
    participation: w.participation,
    defaultBranchId: w.defaultBranchId!,
    version: w.version,
    wordCount: extra.wordCount,
    memberCount: extra.memberCount,
    myRole: extra.myRole,
    createdAt: w.createdAt.toISOString(),
    updatedAt: (extra.updatedAt ?? w.updatedAt).toISOString(),
    capabilities: extra.capabilities,
  }
}

const memberCountSql = sql<number>`(select count(*)::int from ${workMembers} m where m.work_id = ${works.id})`

async function stats(db: Database, workId: string) {
  const [r] = await db
    .select({ wordCount: wordCountSql, memberCount: memberCountSql })
    .from(works)
    .where(eq(works.id, workId))
  return { wordCount: r?.wordCount ?? 0, memberCount: r?.memberCount ?? 1 }
}

const roleOf = (w: { ownerId: string }, userId: string, role: Work['myRole']): Work['myRole'] =>
  w.ownerId === userId ? 'owner' : role

const etag = (version: number) => `"v${version}"`

export const workRoutes: FastifyPluginAsyncZod<{ db: Database; collab: CollabGateway }> = async (
  app,
  { db, collab },
) => {
  app.get(
    '/works',
    { schema: { querystring: z.object({ cursor: z.string().optional() }), response: { 200: Page(Work) } } },
    async (req) => {
      const userId = req.user!.id
      const cursor = req.query.cursor ? decodeCursor(req.query.cursor) : null
      const rows = await db
        .select({
          work: works,
          role: workMembers.role,
          wordCount: wordCountSql,
          memberCount: memberCountSql,
          lastEdited: lastEditedSql,
        })
        .from(works)
        .innerJoin(workMembers, and(eq(workMembers.workId, works.id), eq(workMembers.userId, userId)))
        .where(
          and(
            isNull(works.deletedAt),
            cursor
              ? or(lt(lastEditedSql, cursor.t), and(eq(lastEditedSql, cursor.t), lt(works.id, cursor.id)))
              : undefined,
          ),
        )
        .orderBy(desc(lastEditedSql), desc(works.id))
        .limit(PAGE_SIZE + 1)
      const page = rows.slice(0, PAGE_SIZE)
      const items = page.map((r) =>
        toWork(r.work, {
          wordCount: r.wordCount,
          memberCount: r.memberCount,
          myRole: roleOf(r.work, userId, r.role),
          updatedAt: new Date(r.lastEdited),
          capabilities: capabilitiesFor({ userId }, toAccessContext(r)),
        }),
      )
      const last = page.at(-1)
      return {
        items,
        nextCursor:
          rows.length > PAGE_SIZE && last ? encodeCursor(new Date(last.lastEdited), last.work.id) : null,
      }
    },
  )

  app.post('/works', { schema: { body: CreateWorkInput, response: { 201: Work } } }, async (req, reply) => {
    const userId = req.user!.id
    // New works start private: within the owner's plan (FR-034).
    await assertCanAddPrivateWork(db, userId)
    const work = await idempotent(db, req, reply, 201, () =>
      db.transaction(async (tx) => {
        // Private by default (P-018): visibility and participation are not accepted on create.
        const [w] = await tx
          .insert(works)
          .values({
            ownerId: userId,
            title: req.body.title,
            slug: slugify(req.body.title),
            description: req.body.description,
            form: req.body.category,
          })
          .returning()
        await tx.insert(workMembers).values({ workId: w!.id, userId, role: 'owner', grantedBy: userId })
        const [b] = await tx
          .insert(branches)
          .values({ workId: w!.id, name: 'Main', slug: 'main', createdBy: userId, isDefault: true })
          .returning()
        const [d] = await tx
          .insert(documents)
          .values({ workId: w!.id, kind: 'chapter', schemaVersion: SCHEMA_VERSION })
          .returning()
        await tx.insert(chapters).values({
          workId: w!.id,
          branchId: b!.id,
          documentId: d!.id,
          title: 'Chapter 1',
          position: generateKeyBetween(null, null),
        })
        const [withBranch] = await tx
          .update(works)
          .set({ defaultBranchId: b!.id })
          .where(eq(works.id, w!.id))
          .returning()
        await recordActivity(tx, {
          workId: w!.id,
          actorId: userId,
          type: 'work.created',
          subjectType: 'work',
          subjectId: w!.id,
        })
        return toWork(withBranch!, {
          wordCount: 0,
          memberCount: 1,
          myRole: 'owner',
          capabilities: [...CAPABILITIES],
        })
      }),
    )
    return reply.status(201).header('etag', etag(work.version)).send(work)
  })

  app.get('/works/:workId', { schema: { params: WorkId, response: { 200: Work } } }, async (req, reply) => {
    const access = await requireWork(db, req.params.workId, req.user!.id, 'work.read')
    reply.header('etag', etag(access.work.version))
    return toWork(access.work, {
      ...(await stats(db, access.work.id)),
      myRole: roleOf(access.work, req.user!.id, access.role),
      capabilities: access.capabilities,
    })
  })

  app.patch(
    '/works/:workId',
    { schema: { params: WorkId, body: UpdateWorkInput, response: { 200: Work } } },
    async (req, reply) => {
      const userId = req.user!.id
      const access = await requireWork(db, req.params.workId, userId, 'work.manage_settings')
      const ifMatch = req.headers['if-match']
      const { category, completed, ...rest } = req.body
      // Making a shared work private again counts towards the owner's private works.
      if (rest.visibility === 'private' && access.work.visibility !== 'private')
        await assertCanAddPrivateWork(db, access.work.ownerId)
      const updated = await db.transaction(async (tx) => {
        const [w] = await tx
          .update(works)
          .set({
            ...rest,
            ...(category ? { form: category } : {}),
            ...(completed === undefined
              ? {}
              : { completedAt: completed ? sql`coalesce(${works.completedAt}, now())` : null }),
            ...(req.body.title ? { slug: slugify(req.body.title) } : {}),
            version: sql`${works.version} + 1`,
            updatedAt: sql`now()`,
          })
          .where(
            and(eq(works.id, access.work.id), ifMatch ? eq(works.version, parseEtag(ifMatch)) : undefined),
          )
          .returning()
        if (!w) throw preconditionFailed()
        await recordActivity(tx, {
          workId: w.id,
          actorId: userId,
          type: 'work.updated',
          subjectType: 'work',
          subjectId: w.id,
          data: { fields: Object.keys(req.body) },
        })
        if (completed && !access.work.completedAt)
          await recordActivity(tx, {
            workId: w.id,
            actorId: userId,
            type: 'work.completed',
            subjectType: 'work',
            subjectId: w.id,
          })
        // Visibility and collaboration policy changes get their own audit entries (FR-005, FR-013).
        if (req.body.visibility && req.body.visibility !== access.work.visibility)
          await recordActivity(tx, {
            workId: w.id,
            actorId: userId,
            type: 'work.visibility_changed',
            subjectType: 'work',
            subjectId: w.id,
            data: { from: access.work.visibility, to: w.visibility },
          })
        if (req.body.collaborationMode && req.body.collaborationMode !== access.work.collaborationMode)
          await recordActivity(tx, {
            workId: w.id,
            actorId: userId,
            type: 'work.collaboration_mode_changed',
            subjectType: 'work',
            subjectId: w.id,
            data: { from: access.work.collaborationMode, to: w.collaborationMode },
          })
        return w
      })
      // A new mode changes who may write: reconnect everyone so collab re-authorizes them under it.
      if (req.body.collaborationMode && req.body.collaborationMode !== access.work.collaborationMode)
        await reconnectMembers(db, collab, updated.id, req.log)
      reply.header('etag', etag(updated.version))
      return toWork(updated, {
        ...(await stats(db, updated.id)),
        myRole: roleOf(updated, req.user!.id, access.role),
        capabilities: access.capabilities,
      })
    },
  )

  app.delete('/works/:workId', { schema: { params: WorkId } }, async (req, reply) => {
    const userId = req.user!.id
    const access = await requireWork(db, req.params.workId, userId, 'work.delete')
    await db.transaction(async (tx) => {
      // Soft delete: recoverable for 30 days before a purge job removes content (architecture §14).
      await tx
        .update(works)
        .set({ deletedAt: sql`now()` })
        .where(eq(works.id, access.work.id))
      await recordActivity(tx, {
        workId: access.work.id,
        actorId: userId,
        type: 'work.deleted',
        subjectType: 'work',
        subjectId: access.work.id,
      })
    })
    return reply.status(204).send()
  })
}

const parseEtag = (v: string) => Number(/^"?v?(\d+)"?$/.exec(v.trim())?.[1] ?? NaN)
const encodeCursor = (t: Date, id: string) =>
  Buffer.from(JSON.stringify([t.toISOString(), id])).toString('base64url')
function decodeCursor(c: string): { t: Date; id: string } | null {
  try {
    const [t, id] = JSON.parse(Buffer.from(c, 'base64url').toString()) as [string, string]
    return { t: new Date(t), id }
  } catch {
    return null
  }
}

/** Ask collab to reconnect every member of a work (best effort; collab's periodic re-check is the backstop). */
export async function reconnectMembers(
  db: Database,
  collab: CollabGateway,
  workId: string,
  log: { warn: (o: object, m: string) => void },
) {
  const members = await db
    .select({ userId: workMembers.userId })
    .from(workMembers)
    .where(eq(workMembers.workId, workId))
  await Promise.all(
    members.map((m) =>
      collab
        .revokeAccess({ workId, userId: m.userId })
        .catch((err) => log.warn({ err, workId }, 'reconnect after policy change failed')),
    ),
  )
}

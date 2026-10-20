/**
 * Feedback on chapters (PRD FR-016/017): anchored comment threads and paragraph reactions. Feedback lives in
 * Postgres, never in the document, so it can't alter the text; anchors are Yjs relative positions that follow the
 * passage through edits. Readers of the document are told to refetch through collab.
 */
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod'
import { z } from 'zod'
import { and, asc, eq, inArray, isNull, sql } from 'drizzle-orm'
import {
  CommentBodyInput,
  CommentList,
  CommentThread,
  CreateCommentInput,
  FeedbackUnread,
  Mentionable,
  ReactionInput,
  ReactionsSummary,
  type Comment,
  type ReactionKind,
} from '@morrow/contracts'
import { can, type Capability } from '@morrow/domain'
import {
  comments,
  feedbackReads,
  loadDocumentAccess,
  profiles,
  reactions,
  toAccessContext,
  user,
  workMembers,
  works,
  type Database,
} from '@morrow/db'
import type { CollabGateway } from '../collab-gateway.ts'
import { recordActivity } from '../activity.ts'
import { conflict, forbidden, notFound } from '../problems.ts'
import { blockedSet, spamCheck } from '../safety.ts'
import { requireWork } from '../access.ts'

const DocParams = z.object({ documentId: z.uuid() })
const CommentParams = z.object({ commentId: z.uuid() })
type CommentRow = typeof comments.$inferSelect

/** A chapter document the caller can read; feedback isn't offered on proposal workspaces. 404 hides the rest. */
async function requireChapter(db: Database, documentId: string, userId: string, capability?: Capability) {
  const row = await loadDocumentAccess(db, documentId, userId)
  if (!row || row.proposal) throw notFound()
  const ctx = toAccessContext(row)
  const actor = { userId }
  if (!can(actor, 'work.read', ctx)) throw notFound()
  if (capability && !can(actor, capability, ctx)) throw forbidden()
  return { row, may: (c: Capability) => can(actor, c, ctx) }
}

/** @username mentions, resolved only to people who can read the work (never leaks who has an account). */
async function resolveMentions(
  db: Database,
  workId: string,
  ownerId: string,
  body: string,
  authorId: string,
) {
  const handles = [
    ...new Set([...body.matchAll(/(?:^|[^\w@])@([a-z0-9_]{3,30})\b/gi)].map((m) => m[1]!.toLowerCase())),
  ]
  if (!handles.length) return []
  const rows = await db
    .select({ id: profiles.userId, username: profiles.username, member: workMembers.userId })
    .from(profiles)
    .leftJoin(workMembers, and(eq(workMembers.userId, profiles.userId), eq(workMembers.workId, workId)))
    .where(inArray(profiles.username, handles))
  // Never between people who have blocked each other (FR-032).
  const blocked = await blockedSet(db, authorId)
  return rows.filter((r) => (r.member !== null || r.id === ownerId) && !blocked.has(r.id)).map((r) => r.id)
}

export const feedbackRoutes: FastifyPluginAsyncZod<{ db: Database; collab: CollabGateway }> = async (
  app,
  { db, collab },
) => {
  const changed = (documentId: string, what: 'comments' | 'reactions') =>
    collab
      .notifyFeedback({ documentId, what })
      .catch((err) => app.log.warn({ err }, 'feedback notify failed'))

  async function threads(
    documentId: string,
    userId: string,
    may: (c: Capability) => boolean,
    onlyId?: string,
  ) {
    const roots = await db
      .select()
      .from(comments)
      .where(
        and(
          eq(comments.documentId, documentId),
          isNull(comments.parentId),
          onlyId ? eq(comments.id, onlyId) : undefined,
        ),
      )
      .orderBy(asc(comments.createdAt))
    if (!roots.length) return []
    const replies = await db
      .select()
      .from(comments)
      .where(
        inArray(
          comments.parentId,
          roots.map((r) => r.id),
        ),
      )
      .orderBy(asc(comments.createdAt))
    const all = [...roots, ...replies]
    const people = new Map(
      (
        await db
          .select({ id: user.id, name: user.name, username: profiles.username })
          .from(user)
          .leftJoin(profiles, eq(profiles.userId, user.id))
          .where(
            inArray(user.id, [
              ...new Set(
                all.flatMap((c) => [c.authorId, ...c.mentions, ...(c.resolvedBy ? [c.resolvedBy] : [])]),
              ),
            ]),
          )
      ).map((p) => [p.id, p]),
    )
    const moderator = may('comment.moderate')
    const toComment = (c: CommentRow): Comment => ({
      id: c.id,
      author: { id: c.authorId, name: people.get(c.authorId)?.name ?? 'Someone' },
      body: c.deletedAt ? '' : c.body,
      mentions: c.deletedAt
        ? []
        : c.mentions.flatMap((id) => {
            const p = people.get(id)
            return p?.username ? [{ id, name: p.name, username: p.username }] : []
          }),
      createdAt: c.createdAt.toISOString(),
      editedAt: c.editedAt?.toISOString() ?? null,
      deleted: c.deletedAt !== null,
      canEdit: !c.deletedAt && c.authorId === userId && may('comment.create'),
      canDelete: !c.deletedAt && (c.authorId === userId || moderator),
    })
    return (
      roots
        // A deleted thread with no live replies disappears; otherwise it stays as context ("Comment deleted").
        .filter((r) => !r.deletedAt || replies.some((x) => x.parentId === r.id && !x.deletedAt))
        .map((r) => ({
          id: r.id,
          anchor: r.anchor!,
          resolved: r.resolvedAt
            ? {
                at: r.resolvedAt.toISOString(),
                by: { id: r.resolvedBy!, name: people.get(r.resolvedBy!)?.name ?? 'Someone' },
              }
            : null,
          canResolve: (r.authorId === userId && may('comment.create')) || moderator,
          comments: [r, ...replies.filter((x) => x.parentId === r.id)].map(toComment),
        })) as CommentThread[]
    )
  }

  async function loadComment(commentId: string, userId: string) {
    const [c] = await db.select().from(comments).where(eq(comments.id, commentId))
    if (!c) throw notFound()
    const access = await requireChapter(db, c.documentId, userId)
    return { c, ...access }
  }

  app.get(
    '/documents/:documentId/comments',
    { schema: { params: DocParams, response: { 200: CommentList } } },
    async (req) => {
      const { may } = await requireChapter(db, req.params.documentId, req.user!.id)
      return {
        items: await threads(req.params.documentId, req.user!.id, may),
        canComment: may('comment.create'),
      }
    },
  )

  app.post(
    '/documents/:documentId/comments',
    {
      schema: { params: DocParams, body: CreateCommentInput, response: { 201: CommentThread } },
      config: { rateLimit: { max: 30, timeWindow: '1 minute' } },
    },
    async (req, reply) => {
      const userId = req.user!.id
      const { row, may } = await requireChapter(db, req.params.documentId, userId, 'comment.create')
      await spamCheck(db, userId, req.body.body, 'comment')
      const mentions = await resolveMentions(db, row.work.id, row.work.ownerId, req.body.body, userId)
      const created = await db.transaction(async (tx) => {
        const [c] = await tx
          .insert(comments)
          .values({
            workId: row.work.id,
            documentId: req.params.documentId,
            authorId: userId,
            body: req.body.body,
            mentions,
            anchor: req.body.anchor,
          })
          .returning()
        await recordActivity(tx, {
          workId: row.work.id,
          actorId: userId,
          type: 'comment.created',
          subjectType: 'comment',
          subjectId: c!.id,
          data: { documentId: req.params.documentId, mentions },
        })
        return c!
      })
      await changed(req.params.documentId, 'comments')
      return reply.status(201).send((await threads(req.params.documentId, userId, may, created.id))[0]!)
    },
  )

  app.post(
    '/comments/:commentId/replies',
    {
      schema: { params: CommentParams, body: CommentBodyInput, response: { 201: CommentThread } },
      config: { rateLimit: { max: 30, timeWindow: '1 minute' } },
    },
    async (req, reply) => {
      const userId = req.user!.id
      const { c, row, may } = await loadComment(req.params.commentId, userId)
      if (!may('comment.create')) throw forbidden()
      const root = c.parentId ? (await db.select().from(comments).where(eq(comments.id, c.parentId)))[0]! : c
      await spamCheck(db, userId, req.body.body, 'comment')
      const mentions = await resolveMentions(db, row.work.id, row.work.ownerId, req.body.body, userId)
      await db.transaction(async (tx) => {
        const [r] = await tx
          .insert(comments)
          .values({
            workId: c.workId,
            documentId: c.documentId,
            parentId: root.id,
            authorId: userId,
            body: req.body.body,
            mentions,
          })
          .returning()
        // Replying to a resolved thread reopens it: the conversation isn't over.
        if (root.resolvedAt)
          await tx
            .update(comments)
            .set({ resolvedAt: null, resolvedBy: null })
            .where(eq(comments.id, root.id))
        await recordActivity(tx, {
          workId: c.workId,
          actorId: userId,
          type: 'comment.replied',
          subjectType: 'comment',
          subjectId: r!.id,
          data: { threadId: root.id, mentions },
        })
      })
      await changed(c.documentId, 'comments')
      return reply.status(201).send((await threads(c.documentId, userId, may, root.id))[0]!)
    },
  )

  app.patch(
    '/comments/:commentId',
    { schema: { params: CommentParams, body: CommentBodyInput, response: { 200: CommentThread } } },
    async (req) => {
      const userId = req.user!.id
      const { c, row, may } = await loadComment(req.params.commentId, userId)
      if (c.authorId !== userId || c.deletedAt || !may('comment.create')) throw forbidden()
      await spamCheck(db, userId, req.body.body, 'comment')
      const mentions = await resolveMentions(db, row.work.id, row.work.ownerId, req.body.body, userId)
      await db
        .update(comments)
        .set({ body: req.body.body, mentions, editedAt: sql`now()` })
        .where(eq(comments.id, c.id))
      await changed(c.documentId, 'comments')
      return (await threads(c.documentId, userId, may, c.parentId ?? c.id))[0]!
    },
  )

  app.delete('/comments/:commentId', { schema: { params: CommentParams } }, async (req, reply) => {
    const userId = req.user!.id
    const { c, may } = await loadComment(req.params.commentId, userId)
    if (c.deletedAt) return reply.status(204).send()
    // Authors delete their own; the owner and editors moderate any comment on their work (FR-016).
    if (c.authorId !== userId && !may('comment.moderate')) throw forbidden()
    await db.transaction(async (tx) => {
      await tx
        .update(comments)
        .set({ deletedAt: sql`now()`, deletedBy: userId })
        .where(eq(comments.id, c.id))
      await recordActivity(tx, {
        workId: c.workId,
        actorId: userId,
        type: c.authorId === userId ? 'comment.deleted' : 'comment.moderated',
        subjectType: 'comment',
        subjectId: c.id,
        data: { authorId: c.authorId },
      })
    })
    await changed(c.documentId, 'comments')
    return reply.status(204).send()
  })

  for (const action of ['resolve', 'reopen'] as const) {
    app.post(
      `/comments/:commentId/${action}`,
      { schema: { params: CommentParams, response: { 200: CommentThread } } },
      async (req) => {
        const userId = req.user!.id
        const { c, may } = await loadComment(req.params.commentId, userId)
        if (c.parentId) throw conflict('Resolve the thread, not a reply.')
        if (c.deletedAt) throw notFound()
        if (!((c.authorId === userId && may('comment.create')) || may('comment.moderate'))) throw forbidden()
        await db
          .update(comments)
          .set(
            action === 'resolve'
              ? {
                  resolvedAt: sql`coalesce(${comments.resolvedAt}, now())`,
                  resolvedBy: sql`coalesce(${comments.resolvedBy}, ${userId})`,
                }
              : { resolvedAt: null, resolvedBy: null },
          )
          .where(eq(comments.id, c.id))
        await changed(c.documentId, 'comments')
        return (await threads(c.documentId, userId, may, c.id))[0]!
      },
    )
  }

  // ---- "New feedback" signal and mention suggestions ----
  /**
   * Feedback that concerns the caller and arrived since they last opened it. The owner and editors (who moderate)
   * hear about every comment and reaction; everyone else about replies in their threads and mentions of them.
   */
  app.get(
    '/documents/:documentId/feedback/unread',
    { schema: { params: DocParams, response: { 200: FeedbackUnread } } },
    async (req) => {
      const me = req.user!.id
      const { may } = await requireChapter(db, req.params.documentId, me)
      const doc = req.params.documentId
      const moderator = may('comment.moderate')
      const since = sql`coalesce((select ${feedbackReads.seenAt} from ${feedbackReads} where ${feedbackReads.userId} = ${me} and ${feedbackReads.documentId} = ${doc}), '-infinity'::timestamptz)`
      const [c] = await db
        .execute<{ n: number }>(
          sql`
      select count(*)::int as n from ${comments} c
      where c.document_id = ${doc} and c.author_id <> ${me} and c.deleted_at is null and c.created_at > ${since}
        and (${moderator} or ${me} = any(c.mentions) or exists (
          select 1 from ${comments} t
          where (t.id = coalesce(c.parent_id, c.id) or t.parent_id = coalesce(c.parent_id, c.id)) and t.author_id = ${me}
        ))`,
        )
        .then((r) => r.rows)
      const [r] = moderator
        ? await db
            .execute<{ n: number }>(
              sql`select count(*)::int as n from ${reactions} where document_id = ${doc} and user_id <> ${me} and created_at > ${since}`,
            )
            .then((x) => x.rows)
        : [{ n: 0 }]
      return { comments: c?.n ?? 0, reactions: r?.n ?? 0 }
    },
  )

  app.post('/documents/:documentId/feedback/seen', { schema: { params: DocParams } }, async (req, reply) => {
    const me = req.user!.id
    await requireChapter(db, req.params.documentId, me)
    await db
      .insert(feedbackReads)
      .values({ userId: me, documentId: req.params.documentId })
      .onConflictDoUpdate({
        target: [feedbackReads.userId, feedbackReads.documentId],
        set: { seenAt: sql`now()` },
      })
    return reply.status(204).send()
  })

  /** People you can @mention: those who can read the work and have a username. */
  app.get(
    '/works/:workId/mentionable',
    {
      schema: {
        params: z.object({ workId: z.uuid() }),
        querystring: z.object({ q: z.string().max(30).default('') }),
        response: { 200: z.object({ items: z.array(Mentionable) }) },
      },
      config: { rateLimit: { max: 120, timeWindow: '1 minute' } },
    },
    async (req) => {
      const { work } = await requireWork(db, req.params.workId, req.user!.id, 'comment.create')
      const q = req.query.q.toLowerCase().replace(/[^a-z0-9_]/g, '')
      const rows = await db
        .execute<{ id: string; name: string; username: string }>(
          sql`
      select u.id, u.name, p.username from ${profiles} p join ${user} u on u.id = p.user_id
      where (p.user_id = ${work.ownerId} or exists (select 1 from ${workMembers} m where m.work_id = ${work.id} and m.user_id = p.user_id))
        and p.user_id <> ${req.user!.id}
        and (p.username like ${q + '%'} or lower(u.name) like ${'%' + q + '%'})
      order by p.username limit 8`,
        )
        .then((r) => r.rows)
      return { items: rows }
    },
  )

  // ---- Reactions (FR-017) ----
  async function summary(
    documentId: string,
    userId: string,
    workId: string,
    may: (c: Capability) => boolean,
  ): Promise<ReactionsSummary> {
    const [w] = await db.select({ kinds: works.reactionKinds }).from(works).where(eq(works.id, workId))
    const kinds = (w?.kinds ?? []) as ReactionKind[]
    const rows = await db
      .select({
        blockId: reactions.blockId,
        kind: reactions.kind,
        n: sql<number>`count(*)::int`,
        mine: sql<boolean>`bool_or(${reactions.userId} = ${userId})`,
      })
      .from(reactions)
      .where(and(eq(reactions.documentId, documentId), inArray(reactions.kind, kinds.length ? kinds : ['-'])))
      .groupBy(reactions.blockId, reactions.kind)
    const counts: ReactionsSummary['counts'] = {}
    const mine: ReactionsSummary['mine'] = {}
    for (const r of rows) {
      ;(counts[r.blockId] ??= {})[r.kind as ReactionKind] = r.n
      if (r.mine) (mine[r.blockId] ??= []).push(r.kind as ReactionKind)
    }
    return { kinds, canReact: kinds.length > 0 && may('reaction.create'), counts, mine }
  }

  app.get(
    '/documents/:documentId/reactions',
    { schema: { params: DocParams, response: { 200: ReactionsSummary } } },
    async (req) => {
      const { row, may } = await requireChapter(db, req.params.documentId, req.user!.id)
      return summary(req.params.documentId, req.user!.id, row.work.id, may)
    },
  )

  for (const method of ['PUT', 'DELETE'] as const) {
    app.route({
      method,
      url: '/documents/:documentId/reactions',
      schema: { params: DocParams, body: ReactionInput, response: { 200: ReactionsSummary } },
      config: { rateLimit: { max: 120, timeWindow: '1 minute' } },
      handler: async (req) => {
        const userId = req.user!.id
        const { row, may } = await requireChapter(db, req.params.documentId, userId, 'reaction.create')
        const { blockId, kind } = req.body
        if (method === 'PUT') {
          if (!(row.work.reactionKinds as string[]).includes(kind))
            throw conflict('This work doesn’t offer that reaction.')
          // Idempotent: reacting twice with the same kind is one reaction (unique index).
          await db
            .insert(reactions)
            .values({ workId: row.work.id, documentId: req.params.documentId, blockId, userId, kind })
            .onConflictDoNothing()
        } else {
          await db
            .delete(reactions)
            .where(
              and(
                eq(reactions.documentId, req.params.documentId),
                eq(reactions.blockId, blockId),
                eq(reactions.userId, userId),
                eq(reactions.kind, kind),
              ),
            )
        }
        await changed(req.params.documentId, 'reactions')
        return summary(req.params.documentId, userId, row.work.id, may)
      },
    })
  }
}

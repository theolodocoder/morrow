/**
 * Reporting, moderation and blocking (PRD FR-031/032).
 *
 * Policy for private content: a report stores a snapshot of exactly what was reported, taken through the reporter's
 * own access (you can only report what you can see). Moderators review that snapshot; they are never given general
 * access to a private work. Every moderator action is an append-only record; reversals are new records.
 */
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod'
import { z } from 'zod'
import { and, desc, eq, inArray, isNull, ne, or, sql } from 'drizzle-orm'
import {
  AppealInput,
  BlockInput,
  DecideAppealInput,
  MyModeration,
  MyReport,
  QueueAppeal,
  QueueReport,
  ReportInput,
  ResolveReportInput,
} from '@morrow/contracts'
import { can, canSeeProposal } from '@morrow/domain'
import {
  accountRestrictions,
  appeals,
  blocks,
  comments,
  featuredWorks,
  follows,
  loadDocumentAccess,
  loadWorkAccess,
  moderationActions,
  notifications,
  profiles,
  proposals,
  readerComments,
  reports,
  staff,
  toAccessContext,
  user,
  works,
  type Database,
} from '@morrow/db'
import { conflict, forbidden, notFound } from '../problems.ts'
import { readableWork } from './publishing.ts'
import { removeReaderComment } from './social.ts'
import { requireStaffUser } from '../staff.ts'

type ReportRow = typeof reports.$inferSelect
type ActionRow = typeof moderationActions.$inferSelect
const clip = (s: string, n = 200) => (s.length > n ? `${s.slice(0, n - 1)}…` : s)

async function nameOf(db: Database, id: string | null) {
  if (!id) return 'Someone'
  return (await db.select({ n: user.name }).from(user).where(eq(user.id, id)))[0]?.n ?? 'Someone'
}

/** A direct, quiet notification (not from the outbox: moderation messages are addressed to one person). */
async function tell(db: Database, userId: string, key: string, title: string, body: string, url: string) {
  await db
    .insert(notifications)
    .values({
      userId,
      category: 'activity',
      type: 'moderation',
      title,
      body: clip(body, 200),
      url,
      dedupeKey: key,
    })
    .onConflictDoNothing()
}

const summaryOf = (r: ReportRow) => {
  const s = r.snapshot as Record<string, unknown>
  return clip(String(s.title ?? s.body ?? s.displayName ?? s.username ?? r.targetType), 120)
}

export const moderationRoutes: FastifyPluginAsyncZod<{ db: Database }> = async (app, { db }) => {
  /** Staff only (others get 404, so the console isn't advertised), and only with two-factor on. */
  const requireStaff = (u: { id: string; twoFactorEnabled: boolean }) =>
    requireStaffUser(db, u.id, u.twoFactorEnabled)

  // ---- Reporting (anyone signed in, about what they can see) ----
  app.post(
    '/reports',
    {
      schema: { body: ReportInput, response: { 201: MyReport, 200: MyReport } },
      config: { rateLimit: { max: 20, timeWindow: '1 hour' } },
    },
    async (req, reply) => {
      const me = req.user!.id
      const t = req.body.target
      let target: {
        type: ReportRow['targetType']
        id: string
        workId: string | null
        subject: string | null
        snapshot: Record<string, unknown>
      }

      if (t.type === 'work') {
        const w = t.publicPath
          ? await readableWork(db, t.publicPath)
          : t.workId
            ? (await db.select().from(works).where(eq(works.id, t.workId)))[0]
            : undefined
        if (!w) throw notFound()
        if (!t.publicPath) {
          const access = await loadWorkAccess(db, w.id, me)
          if (!access || !can({ userId: me }, 'work.read', toAccessContext(access))) throw notFound()
        }
        target = {
          type: 'work',
          id: w.id,
          workId: w.id,
          subject: w.ownerId,
          snapshot: {
            title: w.title,
            description: w.description,
            publicPath: t.publicPath ?? null,
            owner: await nameOf(db, w.ownerId),
          },
        }
      } else if (t.type === 'comment') {
        const [c] = await db.select().from(comments).where(eq(comments.id, t.commentId))
        if (!c || c.deletedAt) throw notFound()
        const access = await loadDocumentAccess(db, c.documentId, me)
        if (!access || access.proposal || !can({ userId: me }, 'work.read', toAccessContext(access)))
          throw notFound()
        target = {
          type: 'comment',
          id: c.id,
          workId: c.workId,
          subject: c.authorId,
          snapshot: {
            body: c.body,
            quote: c.anchor?.quote ?? '',
            author: await nameOf(db, c.authorId),
            work: access.work.title,
            chapter: access.chapter.title,
          },
        }
      } else if (t.type === 'user') {
        const [p] = await db
          .select({ p: profiles, name: user.name })
          .from(profiles)
          .innerJoin(user, eq(user.id, profiles.userId))
          .where(eq(profiles.username, t.username.toLowerCase()))
        if (!p || !p.p.isPublic) throw notFound()
        target = {
          type: 'user',
          id: p.p.userId,
          workId: null,
          subject: p.p.userId,
          snapshot: { username: p.p.username, displayName: p.name, bio: p.p.bio },
        }
      } else if (t.type === 'reader_comment') {
        const [c] = await db.select().from(readerComments).where(eq(readerComments.id, t.commentId))
        if (!c || c.deletedAt) throw notFound()
        // Reader comments sit on published works: reportable by anyone who could read the work.
        const [w] = await db.select().from(works).where(eq(works.id, c.workId))
        if (!w || !(await readableWork(db, `${w.slug}-${w.publicId}`))) throw notFound()
        target = {
          type: 'reader_comment',
          id: c.id,
          workId: c.workId,
          subject: c.authorId,
          snapshot: {
            body: c.body,
            author: await nameOf(db, c.authorId),
            work: w.title,
            publicPath: `${w.slug}-${w.publicId}`,
          },
        }
      } else {
        const [p] = await db.select().from(proposals).where(eq(proposals.id, t.proposalId))
        if (!p) throw notFound()
        const access = await loadWorkAccess(db, p.workId, me)
        if (!access || !canSeeProposal({ userId: me }, toAccessContext(access), p)) throw notFound()
        target = {
          type: 'proposal',
          id: p.id,
          workId: p.workId,
          subject: p.authorId,
          snapshot: {
            title: p.title,
            explanation: p.explanation,
            body: p.body,
            author: await nameOf(db, p.authorId),
            work: access.work.title,
          },
        }
      }
      if (target.subject === me) throw conflict('You can’t report your own content.')

      const [created] = await db
        .insert(reports)
        .values({
          reporterId: me,
          targetType: target.type,
          targetId: target.id,
          workId: target.workId,
          subjectUserId: target.subject,
          category: req.body.category,
          details: req.body.details,
          snapshot: target.snapshot,
        })
        .onConflictDoNothing()
        .returning()
      // Already reported and still open: one report per person per thing.
      const row =
        created ??
        (
          await db
            .select()
            .from(reports)
            .where(
              and(
                eq(reports.reporterId, me),
                eq(reports.targetType, target.type),
                eq(reports.targetId, target.id),
                inArray(reports.status, ['open', 'reviewing']),
              ),
            )
        )[0]!
      return reply.status(created ? 201 : 200).send(toMine(row))
    },
  )

  const toMine = (r: ReportRow): z.infer<typeof MyReport> => ({
    id: r.id,
    targetType: r.targetType,
    summary: summaryOf(r),
    category: r.category,
    status: r.status,
    resolution: r.resolution,
    createdAt: r.createdAt.toISOString(),
  })

  /** "Users can see the outcome of their own reports" (FR-031): status and the moderator's note to them. */
  app.get(
    '/me/reports',
    { schema: { response: { 200: z.object({ items: z.array(MyReport) }) } } },
    async (req) => {
      const rows = await db
        .select()
        .from(reports)
        .where(eq(reports.reporterId, req.user!.id))
        .orderBy(desc(reports.createdAt))
        .limit(100)
      return { items: rows.map(toMine) }
    },
  )

  // ---- Blocking (FR-032) ----
  app.put('/me/blocks', { schema: { body: BlockInput } }, async (req, reply) => {
    const me = req.user!.id
    const [p] = await db
      .select({ id: profiles.userId })
      .from(profiles)
      .where(eq(profiles.username, req.body.username.toLowerCase()))
    if (!p) throw notFound()
    if (p.id === me) throw conflict('You can’t block yourself.')
    await db.transaction(async (tx) => {
      await tx.insert(blocks).values({ blockerId: me, blockedId: p.id }).onConflictDoNothing()
      // Blocking ends following in both directions.
      await tx
        .delete(follows)
        .where(
          or(
            and(eq(follows.followerId, me), eq(follows.targetType, 'author'), eq(follows.targetId, p.id)),
            and(eq(follows.followerId, p.id), eq(follows.targetType, 'author'), eq(follows.targetId, me)),
          ),
        )
    })
    return reply.status(204).send()
  })
  app.delete('/me/blocks', { schema: { body: BlockInput } }, async (req, reply) => {
    const [p] = await db
      .select({ id: profiles.userId })
      .from(profiles)
      .where(eq(profiles.username, req.body.username.toLowerCase()))
    if (p) await db.delete(blocks).where(and(eq(blocks.blockerId, req.user!.id), eq(blocks.blockedId, p.id)))
    return reply.status(204).send()
  })
  app.get(
    '/me/blocks',
    {
      schema: {
        response: {
          200: z.object({ items: z.array(z.object({ username: z.string(), displayName: z.string() })) }),
        },
      },
    },
    async (req) => {
      const rows = await db
        .select({ username: profiles.username, displayName: user.name })
        .from(blocks)
        .innerJoin(profiles, eq(profiles.userId, blocks.blockedId))
        .innerJoin(user, eq(user.id, blocks.blockedId))
        .where(eq(blocks.blockerId, req.user!.id))
      return { items: rows }
    },
  )

  // ---- What moderation means for me, and appeals ----
  async function toActionItem(
    a: ActionRow,
    forStaff: boolean,
  ): Promise<z.infer<typeof MyModeration>['actions'][number]> {
    const [rev] = await db
      .select({ id: moderationActions.id })
      .from(moderationActions)
      .where(eq(moderationActions.reverses, a.id))
      .limit(1)
    const [ap] = await db.select().from(appeals).where(eq(appeals.actionId, a.id)).limit(1)
    return {
      id: a.id,
      action: a.action,
      targetType: a.targetType,
      targetId: a.targetId,
      reason: a.reason,
      moderator: forStaff ? await nameOf(db, a.moderatorId) : 'A moderator',
      createdAt: a.createdAt.toISOString(),
      reversed: !!rev,
      appeal: ap ? { status: ap.status, decision: ap.decision } : null,
    }
  }

  app.get('/me/moderation', { schema: { response: { 200: MyModeration } } }, async (req) => {
    const me = req.user!.id
    const [r] = await db
      .select()
      .from(accountRestrictions)
      .where(
        and(
          eq(accountRestrictions.userId, me),
          isNull(accountRestrictions.liftedAt),
          or(isNull(accountRestrictions.until), sql`${accountRestrictions.until} > now()`),
        ),
      )
      .orderBy(desc(accountRestrictions.createdAt))
      .limit(1)
    const actions = await db
      .select()
      .from(moderationActions)
      .where(
        and(
          eq(moderationActions.subjectUserId, me),
          inArray(moderationActions.action, ['hide_work', 'remove_comment', 'restrict_account']),
        ),
      )
      .orderBy(desc(moderationActions.createdAt))
      .limit(50)
    return {
      restriction: r ? { kind: r.kind, until: r.until?.toISOString() ?? null, reason: r.reason } : null,
      actions: await Promise.all(actions.map((a) => toActionItem(a, false))),
    }
  })

  app.post(
    '/me/appeals',
    { schema: { body: AppealInput }, config: { rateLimit: { max: 5, timeWindow: '1 hour' } } },
    async (req, reply) => {
      const me = req.user!.id
      const [a] = await db.select().from(moderationActions).where(eq(moderationActions.id, req.body.actionId))
      if (!a || a.subjectUserId !== me) throw notFound()
      const [created] = await db
        .insert(appeals)
        .values({ actionId: a.id, userId: me, message: req.body.message })
        .onConflictDoNothing()
        .returning()
      if (!created) throw conflict('You’ve already appealed this decision.')
      return reply.status(201).send({ id: created.id })
    },
  )

  // ---- The moderation console (staff) ----
  app.get(
    '/moderation/reports',
    {
      schema: {
        querystring: z.object({ status: z.enum(['open', 'reviewing', 'closed']).default('open') }),
        response: { 200: z.object({ items: z.array(QueueReport) }) },
      },
    },
    async (req) => {
      await requireStaff(req.user!)
      const statuses =
        req.query.status === 'closed' ? (['actioned', 'dismissed'] as const) : ([req.query.status] as const)
      const rows = await db
        .select()
        .from(reports)
        .where(inArray(reports.status, [...statuses]))
        .orderBy(req.query.status === 'closed' ? desc(reports.resolvedAt) : reports.createdAt)
        .limit(100)
      return {
        items: await Promise.all(
          rows.map(async (r) => ({
            ...toMine(r),
            targetId: r.targetId,
            details: r.details,
            snapshot: r.snapshot as Record<string, unknown>,
            reporter: { id: r.reporterId, name: await nameOf(db, r.reporterId) },
            subject: r.subjectUserId
              ? { id: r.subjectUserId, name: await nameOf(db, r.subjectUserId) }
              : null,
            priorActions: r.subjectUserId
              ? (
                  await db
                    .select({ n: sql<number>`count(*)::int` })
                    .from(moderationActions)
                    .where(
                      and(
                        eq(moderationActions.subjectUserId, r.subjectUserId),
                        ne(moderationActions.action, 'dismiss_report'),
                      ),
                    )
                )[0]!.n
              : 0,
            reviewer: r.reviewerId ? await nameOf(db, r.reviewerId) : null,
          })),
        ),
      }
    },
  )

  app.post(
    '/moderation/reports/:reportId/claim',
    { schema: { params: z.object({ reportId: z.uuid() }) } },
    async (req, reply) => {
      await requireStaff(req.user!)
      await db
        .update(reports)
        .set({ status: 'reviewing', reviewerId: req.user!.id })
        .where(and(eq(reports.id, req.params.reportId), eq(reports.status, 'open')))
      return reply.status(204).send()
    },
  )

  app.post(
    '/moderation/reports/:reportId/resolve',
    { schema: { params: z.object({ reportId: z.uuid() }), body: ResolveReportInput } },
    async (req, reply) => {
      const me = req.user!.id
      await requireStaff(req.user!)
      const [r] = await db.select().from(reports).where(eq(reports.id, req.params.reportId))
      if (!r) throw notFound()
      if (r.status === 'actioned' || r.status === 'dismissed')
        throw conflict('This report is already closed.')
      // Nobody moderates their own content, or a report they made (FR-031 "beyond their authorized scope").
      if (r.subjectUserId === me || r.reporterId === me) throw forbidden()
      const { action, reason, resolution, restriction } = req.body
      if (action === 'remove_comment' && r.targetType !== 'comment' && r.targetType !== 'reader_comment')
        throw conflict('Only comments can be removed.')
      if (action === 'hide_work' && !r.workId) throw conflict('There’s no work to hide.')
      if (action === 'restrict_account' && (!r.subjectUserId || !restriction))
        throw conflict('Choose the restriction.')

      await db.transaction(async (tx) => {
        const record = async (a: ActionRow['action'], targetType: string, targetId: string) =>
          (
            await tx
              .insert(moderationActions)
              .values({
                moderatorId: me,
                action: a,
                targetType,
                targetId,
                subjectUserId: r.subjectUserId,
                reportId: r.id,
                reason,
              })
              .returning()
          )[0]!
        if (action === 'hide_work') {
          await tx
            .update(works)
            .set({ hiddenAt: sql`now()` })
            .where(eq(works.id, r.workId!))
          await record('hide_work', 'work', r.workId!)
        } else if (action === 'remove_comment' && r.targetType === 'reader_comment') {
          await removeReaderComment(tx as unknown as Database, r.targetId, me)
          await record('remove_comment', 'reader_comment', r.targetId)
        } else if (action === 'remove_comment') {
          await tx
            .update(comments)
            .set({ deletedAt: sql`now()`, deletedBy: me })
            .where(eq(comments.id, r.targetId))
          await record('remove_comment', 'comment', r.targetId)
        } else if (action === 'restrict_account') {
          const a = await record('restrict_account', 'user', r.subjectUserId!)
          await tx.insert(accountRestrictions).values({
            userId: r.subjectUserId!,
            kind: restriction!.kind,
            reason,
            actionId: a.id,
            until: restriction!.days ? sql`now() + ${`${restriction!.days} days`}::interval` : null,
          })
        } else {
          await record('dismiss_report', r.targetType, r.targetId)
        }
        // Close every open report about the same thing with the same outcome.
        await tx
          .update(reports)
          .set({
            status: action === 'dismiss' ? 'dismissed' : 'actioned',
            resolution,
            reviewerId: me,
            resolvedAt: sql`now()`,
          })
          .where(
            and(
              eq(reports.targetType, r.targetType),
              eq(reports.targetId, r.targetId),
              inArray(reports.status, ['open', 'reviewing']),
            ),
          )
      })
      await tell(
        db,
        r.reporterId,
        `report:${r.id}`,
        action === 'dismiss' ? 'We reviewed your report' : 'We acted on your report',
        resolution ||
          (action === 'dismiss' ? 'No action was needed this time.' : 'Thank you for reporting it.'),
        '/app/reports',
      )
      if (action !== 'dismiss' && r.subjectUserId)
        await tell(
          db,
          r.subjectUserId,
          `action:${r.id}`,
          'A moderator took action on your account or content',
          'See what happened and how to appeal.',
          '/app/moderation-status',
        )
      return reply.status(204).send()
    },
  )

  /** Undo an action (as a new, recorded action). */
  async function reverse(actionId: string, by: string, reason: string) {
    const [a] = await db.select().from(moderationActions).where(eq(moderationActions.id, actionId))
    if (!a) throw notFound()
    const [already] = await db.select().from(moderationActions).where(eq(moderationActions.reverses, a.id))
    if (already) throw conflict('Already reversed.')
    await db.transaction(async (tx) => {
      let undo: ActionRow['action']
      if (a.action === 'hide_work') {
        await tx.update(works).set({ hiddenAt: null }).where(eq(works.id, a.targetId))
        undo = 'restore_work'
      } else if (a.action === 'remove_comment' && a.targetType === 'reader_comment') {
        const [back] = await tx
          .update(readerComments)
          .set({ deletedAt: null, deletedBy: null })
          .where(and(eq(readerComments.id, a.targetId), sql`${readerComments.deletedAt} is not null`))
          .returning()
        if (back)
          await tx
            .update(works)
            .set({ readerCommentCount: sql`${works.readerCommentCount} + 1` })
            .where(eq(works.id, back.workId))
        undo = 'restore_comment'
      } else if (a.action === 'remove_comment') {
        await tx.update(comments).set({ deletedAt: null, deletedBy: null }).where(eq(comments.id, a.targetId))
        undo = 'restore_comment'
      } else if (a.action === 'restrict_account') {
        await tx
          .update(accountRestrictions)
          .set({ liftedAt: sql`now()` })
          .where(eq(accountRestrictions.actionId, a.id))
        undo = 'lift_restriction'
      } else throw conflict('This action can’t be reversed.')
      await tx.insert(moderationActions).values({
        moderatorId: by,
        action: undo,
        targetType: a.targetType,
        targetId: a.targetId,
        subjectUserId: a.subjectUserId,
        reportId: a.reportId,
        reason,
        reverses: a.id,
      })
    })
    return a
  }

  app.post(
    '/moderation/actions/:actionId/reverse',
    {
      schema: {
        params: z.object({ actionId: z.uuid() }),
        body: z.object({ reason: z.string().trim().min(3).max(1000) }),
      },
    },
    async (req, reply) => {
      await requireStaff(req.user!)
      await reverse(req.params.actionId, req.user!.id, req.body.reason)
      return reply.status(204).send()
    },
  )

  app.get(
    '/moderation/actions',
    {
      schema: {
        querystring: z.object({ subjectUserId: z.string().max(64).optional() }),
        response: {
          200: z.object({
            items: z.array(
              z.object({
                id: z.uuid(),
                action: z.string(),
                targetType: z.string(),
                targetId: z.string(),
                reason: z.string(),
                moderator: z.string(),
                createdAt: z.string(),
                reverses: z.uuid().nullable(),
              }),
            ),
          }),
        },
      },
    },
    async (req) => {
      await requireStaff(req.user!)
      const rows = await db
        .select()
        .from(moderationActions)
        .where(
          req.query.subjectUserId ? eq(moderationActions.subjectUserId, req.query.subjectUserId) : undefined,
        )
        .orderBy(desc(moderationActions.createdAt))
        .limit(200)
      return {
        items: await Promise.all(
          rows.map(async (a) => ({
            id: a.id,
            action: a.action,
            targetType: a.targetType,
            targetId: a.targetId,
            reason: a.reason,
            moderator: await nameOf(db, a.moderatorId),
            createdAt: a.createdAt.toISOString(),
            reverses: a.reverses,
          })),
        ),
      }
    },
  )

  app.get(
    '/moderation/appeals',
    { schema: { response: { 200: z.object({ items: z.array(QueueAppeal) }) } } },
    async (req) => {
      await requireStaff(req.user!)
      const rows = await db
        .select()
        .from(appeals)
        .where(eq(appeals.status, 'open'))
        .orderBy(appeals.createdAt)
        .limit(100)
      return {
        items: await Promise.all(
          rows.map(async (ap) => {
            const [a] = await db.select().from(moderationActions).where(eq(moderationActions.id, ap.actionId))
            return {
              id: ap.id,
              message: ap.message,
              user: { id: ap.userId, name: await nameOf(db, ap.userId) },
              action: await toActionItem(a!, true),
              createdAt: ap.createdAt.toISOString(),
            }
          }),
        ),
      }
    },
  )

  app.post(
    '/moderation/appeals/:appealId/decide',
    { schema: { params: z.object({ appealId: z.uuid() }), body: DecideAppealInput } },
    async (req, reply) => {
      const me = req.user!.id
      await requireStaff(req.user!)
      const [ap] = await db.select().from(appeals).where(eq(appeals.id, req.params.appealId))
      if (!ap) throw notFound()
      if (ap.status !== 'open') throw conflict('Already decided.')
      if (ap.userId === me) throw forbidden()
      // A second look by someone else: the moderator who took the action doesn't decide its appeal.
      const [a] = await db.select().from(moderationActions).where(eq(moderationActions.id, ap.actionId))
      if (a?.moderatorId === me) throw forbidden()
      if (req.body.decision === 'overturned')
        await reverse(ap.actionId, me, `Appeal upheld: ${req.body.note}`)
      await db
        .update(appeals)
        .set({ status: req.body.decision, decision: req.body.note, decidedBy: me, decidedAt: sql`now()` })
        .where(eq(appeals.id, ap.id))
      await tell(
        db,
        ap.userId,
        `appeal:${ap.id}`,
        req.body.decision === 'overturned' ? 'Your appeal was successful' : 'Your appeal was reviewed',
        req.body.note,
        '/app/moderation-status',
      )
      return reply.status(204).send()
    },
  )

  // Editorial picks for discovery (FR-020), managed by staff.
  app.put(
    '/moderation/featured',
    {
      schema: {
        body: z.object({ publicPath: z.string().max(200), note: z.string().trim().max(280).default('') }),
      },
    },
    async (req, reply) => {
      await requireStaff(req.user!)
      const w = await readableWork(db, req.body.publicPath)
      if (!w || w.visibility !== 'public') throw notFound()
      await db
        .insert(featuredWorks)
        .values({ workId: w.id, note: req.body.note, featuredBy: req.user!.id })
        .onConflictDoUpdate({
          target: featuredWorks.workId,
          set: { note: req.body.note, featuredBy: req.user!.id, featuredAt: sql`now()` },
        })
      return reply.status(204).send()
    },
  )
  app.delete(
    '/moderation/featured',
    { schema: { body: z.object({ publicPath: z.string().max(200) }) } },
    async (req, reply) => {
      await requireStaff(req.user!)
      const w = await readableWork(db, req.body.publicPath)
      if (w) await db.delete(featuredWorks).where(eq(featuredWorks.workId, w.id))
      return reply.status(204).send()
    },
  )

  /** Whether the signed-in person is staff (for showing the console link). */
  app.get(
    '/me/staff',
    {
      schema: {
        response: {
          200: z.object({ role: z.enum(['moderator', 'admin']).nullable(), twoFactorEnabled: z.boolean() }),
        },
      },
    },
    async (req) => {
      const [s] = await db.select({ role: staff.role }).from(staff).where(eq(staff.userId, req.user!.id))
      return { role: s?.role ?? null, twoFactorEnabled: req.user!.twoFactorEnabled }
    },
  )
}

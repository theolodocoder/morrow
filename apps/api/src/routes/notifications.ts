import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod'
import { z } from 'zod'
import { and, desc, eq, gt, inArray, isNull, lt, or, sql } from 'drizzle-orm'
import {
  AcceptedInvitation,
  MarkReadInput,
  MyInvitations,
  NotificationList,
  NotificationPreferences,
  UpdateNotificationPreferences,
  NOTIFICATION_CATEGORIES,
} from '@morrow/contracts'
import { invitations, notificationPreferences, notifications, user, works, type Database } from '@morrow/db'
import { DEFAULT_PREFERENCES } from '../notifications.ts'
import { HttpProblem, notFound } from '../problems.ts'
import { PROBLEM } from '@morrow/contracts'
import { claimInvitation } from './members.ts'

const encode = (d: Date, id: string) =>
  Buffer.from(JSON.stringify([d.toISOString(), id])).toString('base64url')
const decode = (c: string) => {
  try {
    const [t, id] = JSON.parse(Buffer.from(c, 'base64url').toString()) as [string, string]
    return { t: new Date(t), id }
  } catch {
    return null
  }
}

export const notificationRoutes: FastifyPluginAsyncZod<{ db: Database }> = async (app, { db }) => {
  const unreadCount = async (userId: string) =>
    (
      await db
        .select({ n: sql<number>`count(*)::int` })
        .from(notifications)
        .where(and(eq(notifications.userId, userId), isNull(notifications.readAt)))
    )[0]!.n

  app.get(
    '/me/notifications',
    {
      schema: {
        querystring: z.object({
          cursor: z.string().max(200).optional(),
          category: z.enum(NOTIFICATION_CATEGORIES).optional(),
          unread: z.coerce.boolean().optional(),
        }),
        response: { 200: NotificationList },
      },
    },
    async (req) => {
      const me = req.user!.id
      const after = req.query.cursor ? decode(req.query.cursor) : null
      const rows = await db
        .select()
        .from(notifications)
        .where(
          and(
            eq(notifications.userId, me),
            req.query.category ? eq(notifications.category, req.query.category) : undefined,
            req.query.unread ? isNull(notifications.readAt) : undefined,
            after
              ? or(
                  lt(notifications.createdAt, after.t),
                  and(eq(notifications.createdAt, after.t), lt(notifications.id, after.id)),
                )
              : undefined,
          ),
        )
        .orderBy(desc(notifications.createdAt), desc(notifications.id))
        .limit(31)
      const page = rows.slice(0, 30)
      return {
        items: page.map((n) => ({
          id: n.id,
          category: n.category,
          type: n.type,
          title: n.title,
          body: n.body,
          url: n.url,
          read: n.readAt !== null,
          createdAt: n.createdAt.toISOString(),
        })),
        nextCursor: rows.length > 30 ? encode(page.at(-1)!.createdAt, page.at(-1)!.id) : null,
        unread: await unreadCount(me),
      }
    },
  )

  app.get(
    '/me/notifications/unread',
    { schema: { response: { 200: z.object({ count: z.number().int() }) } } },
    async (req) => ({ count: await unreadCount(req.user!.id) }),
  )

  app.post(
    '/me/notifications/read',
    { schema: { body: MarkReadInput, response: { 200: z.object({ count: z.number().int() }) } } },
    async (req) => {
      const me = req.user!.id
      await db
        .update(notifications)
        .set({ readAt: sql`now()` })
        .where(
          and(
            eq(notifications.userId, me),
            isNull(notifications.readAt),
            'ids' in req.body ? inArray(notifications.id, req.body.ids) : undefined,
          ),
        )
      return { count: await unreadCount(me) }
    },
  )

  async function preferences(userId: string) {
    const [p] = await db
      .select()
      .from(notificationPreferences)
      .where(eq(notificationPreferences.userId, userId))
    return {
      categories: Object.fromEntries(
        NOTIFICATION_CATEGORIES.map((c) => [c, { ...DEFAULT_PREFERENCES[c], ...(p?.categories?.[c] ?? {}) }]),
      ) as NotificationPreferences['categories'],
      quietStart: p?.quietStart ?? null,
      quietEnd: p?.quietEnd ?? null,
      timeZone: p?.timeZone ?? 'UTC',
    }
  }
  app.get(
    '/me/notification-preferences',
    { schema: { response: { 200: NotificationPreferences } } },
    async (req) => preferences(req.user!.id),
  )
  app.put(
    '/me/notification-preferences',
    { schema: { body: UpdateNotificationPreferences, response: { 200: NotificationPreferences } } },
    async (req) => {
      const me = req.user!.id
      const current = await preferences(me)
      if (req.body.timeZone) {
        try {
          new Intl.DateTimeFormat('en', { timeZone: req.body.timeZone })
        } catch {
          throw new HttpProblem(400, PROBLEM.validation, 'Unknown time zone.')
        }
      }
      const next = {
        categories: { ...current.categories, ...(req.body.categories ?? {}) },
        quietStart: req.body.quietStart !== undefined ? req.body.quietStart : current.quietStart,
        quietEnd: req.body.quietEnd !== undefined ? req.body.quietEnd : current.quietEnd,
        timeZone: req.body.timeZone ?? current.timeZone,
      }
      await db
        .insert(notificationPreferences)
        .values({ userId: me, ...next })
        .onConflictDoUpdate({
          target: notificationPreferences.userId,
          set: { ...next, updatedAt: sql`now()` },
        })
      return preferences(me)
    },
  )

  // Invitations inbox: only for a verified address (anyone can sign up claiming an address; invitations name private
  // works). Until then the emailed link, whose token proves the inbox, is the way in.
  app.get('/me/invitations', { schema: { response: { 200: MyInvitations } } }, async (req) => {
    const me = req.user!
    if (!me.emailVerified) return { items: [], verified: false }
    const rows = await db
      .select({ inv: invitations, title: works.title, inviter: user.name })
      .from(invitations)
      .innerJoin(works, eq(works.id, invitations.workId))
      .innerJoin(user, eq(user.id, invitations.invitedBy))
      .where(
        and(
          sql`lower(${invitations.email}) = ${me.email.toLowerCase()}`,
          isNull(invitations.acceptedAt),
          isNull(invitations.revokedAt),
          gt(invitations.expiresAt, sql`now()`),
          isNull(works.deletedAt),
        ),
      )
      .orderBy(desc(invitations.createdAt))
    return {
      verified: true,
      items: rows.map((r) => ({
        id: r.inv.id,
        workTitle: r.title,
        invitedByName: r.inviter,
        role: r.inv.role as 'editor',
        expiresAt: r.inv.expiresAt.toISOString(),
      })),
    }
  })

  app.post(
    '/me/invitations/:invitationId/accept',
    { schema: { params: z.object({ invitationId: z.uuid() }), response: { 200: AcceptedInvitation } } },
    async (req) => {
      const me = req.user!
      const [inv] = await db.select().from(invitations).where(eq(invitations.id, req.params.invitationId))
      // Not yours, not verified, or gone: indistinguishable on purpose.
      if (
        !me.emailVerified ||
        !inv ||
        inv.email.toLowerCase() !== me.email.toLowerCase() ||
        inv.revokedAt ||
        inv.acceptedAt ||
        inv.expiresAt <= new Date()
      )
        throw notFound()
      await claimInvitation(db, inv, me.id)
      return { workId: inv.workId }
    },
  )
}

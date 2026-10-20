/**
 * The admin app's API (staff only, two-factor required): people, plans and comps, and the audit trail.
 * Moderators look people up; only admins change plans or grant comps. Every change is recorded (`admin.*` events).
 */
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod'
import { z } from 'zod'
import { and, desc, eq, ilike, inArray, isNull, like, or, sql } from 'drizzle-orm'
import { PlanInfo, PlanLimitsSchema } from '@morrow/contracts'
import {
  accountRestrictions,
  activityEvents,
  moderationActions,
  plans,
  profiles,
  staff,
  subscriptions,
  user,
  works,
  type Database,
} from '@morrow/db'
import { recordActivity } from '../activity.ts'
import { planFor, toPlanInfo } from '../entitlements.ts'
import { notFound } from '../problems.ts'
import { requireStaffUser } from '../staff.ts'

const likeEscape = (s: string) => s.replace(/[\\%_]/g, (c) => `\\${c}`)
const AdminUser = z.object({
  id: z.string(),
  name: z.string(),
  email: z.string(),
  username: z.string().nullable(),
  joinedAt: z.string(),
  plan: z.string(),
  planStatus: z.string(),
  restriction: z.string().nullable(),
  staffRole: z.string().nullable(),
  twoFactorEnabled: z.boolean(),
})

export const adminRoutes: FastifyPluginAsyncZod<{ db: Database }> = async (app, { db }) => {
  const staffOnly = (u: { id: string; twoFactorEnabled: boolean }) =>
    requireStaffUser(db, u.id, u.twoFactorEnabled)
  const adminOnly = (u: { id: string; twoFactorEnabled: boolean }) =>
    requireStaffUser(db, u.id, u.twoFactorEnabled, 'admin')

  async function describe(ids: string[]) {
    if (!ids.length) return []
    const rows = await db
      .select({ u: user, username: profiles.username, role: staff.role })
      .from(user)
      .leftJoin(profiles, eq(profiles.userId, user.id))
      .leftJoin(staff, eq(staff.userId, user.id))
      .where(inArray(user.id, ids))
    return Promise.all(
      rows.map(async (r) => {
        const { plan, subscription } = await planFor(db, r.u.id)
        const [restr] = await db
          .select({ kind: accountRestrictions.kind })
          .from(accountRestrictions)
          .where(
            and(
              eq(accountRestrictions.userId, r.u.id),
              isNull(accountRestrictions.liftedAt),
              or(isNull(accountRestrictions.until), sql`${accountRestrictions.until} > now()`),
            ),
          )
          .limit(1)
        return {
          id: r.u.id,
          name: r.u.name,
          email: r.u.email,
          username: r.username,
          joinedAt: r.u.createdAt.toISOString(),
          plan: plan.key,
          planStatus: subscription?.status ?? 'free',
          restriction: restr?.kind ?? null,
          staffRole: r.role,
          twoFactorEnabled: (r.u as { twoFactorEnabled?: boolean | null }).twoFactorEnabled === true,
        }
      }),
    )
  }

  app.get(
    '/admin/users',
    {
      schema: {
        querystring: z.object({ q: z.string().trim().min(2).max(100) }),
        response: { 200: z.object({ items: z.array(AdminUser) }) },
      },
    },
    async (req) => {
      await staffOnly(req.user!)
      const q = likeEscape(req.query.q)
      const rows = await db
        .select({ id: user.id })
        .from(user)
        .leftJoin(profiles, eq(profiles.userId, user.id))
        .where(
          or(
            ilike(user.email, `%${q}%`),
            ilike(user.name, `%${q}%`),
            like(profiles.username, `${q.toLowerCase()}%`),
          ),
        )
        .limit(25)
      return { items: await describe(rows.map((r) => r.id)) }
    },
  )

  app.get(
    '/admin/users/:userId',
    {
      schema: {
        params: z.object({ userId: z.string().max(64) }),
        response: {
          200: AdminUser.extend({
            works: z.number().int(),
            actions: z.array(z.object({ action: z.string(), reason: z.string(), createdAt: z.string() })),
          }),
        },
      },
    },
    async (req) => {
      await staffOnly(req.user!)
      const [u] = await describe([req.params.userId])
      if (!u) throw notFound()
      const [w] = await db
        .select({ n: sql<number>`count(*)::int` })
        .from(works)
        .where(and(eq(works.ownerId, u.id), isNull(works.deletedAt)))
      const acts = await db
        .select()
        .from(moderationActions)
        .where(eq(moderationActions.subjectUserId, u.id))
        .orderBy(desc(moderationActions.createdAt))
        .limit(50)
      return {
        ...u,
        works: w!.n,
        actions: acts.map((a) => ({
          action: a.action,
          reason: a.reason,
          createdAt: a.createdAt.toISOString(),
        })),
      }
    },
  )

  // ---- Comps (admins): a plan given, not bought. Billing can stay disabled. ----
  app.put(
    '/admin/users/:userId/comp',
    {
      schema: {
        params: z.object({ userId: z.string().max(64) }),
        body: z.object({ planKey: z.string().max(40), note: z.string().trim().min(3).max(500) }),
      },
    },
    async (req, reply) => {
      await adminOnly(req.user!)
      const [p] = await db.select().from(plans).where(eq(plans.key, req.body.planKey))
      const [u] = await db.select({ id: user.id }).from(user).where(eq(user.id, req.params.userId))
      if (!p || !u) throw notFound()
      await db.transaction(async (tx) => {
        const values = {
          userId: u.id,
          planKey: p.key,
          status: 'comped' as const,
          source: 'comp' as const,
          grantedBy: req.user!.id,
          note: req.body.note,
          currentPeriodEnd: null,
          cancelAtPeriodEnd: false,
        }
        await tx
          .insert(subscriptions)
          .values(values)
          .onConflictDoUpdate({ target: subscriptions.userId, set: { ...values, updatedAt: sql`now()` } })
        await recordActivity(tx, {
          workId: null,
          actorId: req.user!.id,
          type: 'admin.comp_granted',
          subjectType: 'user',
          subjectId: u.id,
          data: { plan: p.key, note: req.body.note },
        })
      })
      return reply.status(204).send()
    },
  )
  app.delete(
    '/admin/users/:userId/comp',
    {
      schema: {
        params: z.object({ userId: z.string().max(64) }),
        body: z.object({ note: z.string().trim().min(3).max(500) }),
      },
    },
    async (req, reply) => {
      await adminOnly(req.user!)
      await db.transaction(async (tx) => {
        const removed = await tx
          .delete(subscriptions)
          .where(and(eq(subscriptions.userId, req.params.userId), eq(subscriptions.source, 'comp')))
          .returning()
        if (removed.length)
          await recordActivity(tx, {
            workId: null,
            actorId: req.user!.id,
            type: 'admin.comp_revoked',
            subjectType: 'user',
            subjectId: req.params.userId,
            data: { plan: removed[0]!.planKey, note: req.body.note },
          })
      })
      return reply.status(204).send()
    },
  )

  // ---- Plans (admins): limits and prices are data (PRD §18). ----
  app.get(
    '/admin/plans',
    {
      schema: {
        response: {
          200: z.object({
            items: z.array(PlanInfo.extend({ active: z.boolean(), sortOrder: z.number().int() })),
          }),
        },
      },
    },
    async (req) => {
      await staffOnly(req.user!)
      const rows = await db.select().from(plans).orderBy(plans.sortOrder)
      return { items: rows.map((p) => ({ ...toPlanInfo(p), active: p.active, sortOrder: p.sortOrder })) }
    },
  )
  app.put(
    '/admin/plans/:key',
    {
      schema: {
        params: z.object({ key: z.string().max(40) }),
        body: z.object({
          name: z.string().trim().min(1).max(60),
          description: z.string().trim().max(500),
          priceMonthly: z.number().int().min(0).max(1_000_000).nullable(),
          limits: PlanLimitsSchema,
          features: z.array(z.string().max(40)).max(30),
          active: z.boolean(),
        }),
      },
    },
    async (req, reply) => {
      await adminOnly(req.user!)
      const [before] = await db.select().from(plans).where(eq(plans.key, req.params.key))
      if (!before) throw notFound()
      await db.transaction(async (tx) => {
        await tx
          .update(plans)
          .set({ ...req.body, updatedAt: sql`now()` })
          .where(eq(plans.key, req.params.key))
        await recordActivity(tx, {
          workId: null,
          actorId: req.user!.id,
          type: 'admin.plan_updated',
          subjectType: 'plan',
          subjectId: req.params.key,
          data: { before: toPlanInfo(before), after: req.body },
        })
      })
      return reply.status(204).send()
    },
  )

  // ---- Audit trail: every staff action, newest first ----
  app.get(
    '/admin/audit',
    {
      schema: {
        response: {
          200: z.object({
            items: z.array(
              z.object({
                at: z.string(),
                actor: z.string(),
                kind: z.string(),
                subject: z.string(),
                detail: z.string(),
              }),
            ),
          }),
        },
      },
    },
    async (req) => {
      await staffOnly(req.user!)
      const mods = await db
        .select({ a: moderationActions, who: user.name })
        .from(moderationActions)
        .innerJoin(user, eq(user.id, moderationActions.moderatorId))
        .orderBy(desc(moderationActions.createdAt))
        .limit(100)
      const admins = await db
        .select({ e: activityEvents, who: user.name })
        .from(activityEvents)
        .innerJoin(user, eq(user.id, activityEvents.actorId))
        .where(like(activityEvents.type, 'admin.%'))
        .orderBy(desc(activityEvents.createdAt))
        .limit(100)
      const items = [
        ...mods.map(({ a, who }) => ({
          at: a.createdAt.toISOString(),
          actor: who,
          kind: a.action,
          subject: `${a.targetType} ${a.targetId}`,
          detail: a.reason,
        })),
        ...admins.map(({ e, who }) => ({
          at: e.createdAt.toISOString(),
          actor: who,
          kind: e.type.replace('admin.', ''),
          subject: `${e.subjectType} ${e.subjectId}`,
          detail: String((e.data as { note?: string }).note ?? ''),
        })),
      ]
        .sort((x, y) => y.at.localeCompare(x.at))
        .slice(0, 150)
      return { items }
    },
  )
}

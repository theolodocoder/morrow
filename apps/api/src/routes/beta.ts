/**
 * Beta feedback and product metrics (PRD Phase 7). Metrics are derived from data Morrow already holds: no tracking
 * script, no cookies, no third party, and nothing about anyone's manuscript text (T-004's privacy posture).
 */
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod'
import { z } from 'zod'
import { eq, sql } from 'drizzle-orm'
import { feedback, type Database } from '@morrow/db'
import { requireStaffUser } from '../staff.ts'

export const betaRoutes: FastifyPluginAsyncZod<{ db: Database }> = async (app, { db }) => {
  app.post(
    '/feedback',
    {
      schema: {
        body: z.object({
          kind: z.enum(['bug', 'idea', 'praise', 'other']),
          message: z.string().trim().min(3).max(4000),
          path: z.string().max(300).default(''),
        }),
      },
      config: { rateLimit: { max: 10, timeWindow: '1 hour' } },
    },
    async (req, reply) => {
      // Paths only: strip query strings and fragments, which could carry tokens.
      const path = req.body.path.split(/[?#]/)[0]!.slice(0, 300)
      await db.insert(feedback).values({
        userId: req.user!.id,
        kind: req.body.kind,
        message: req.body.message,
        path,
        userAgent: String(req.headers['user-agent'] ?? '').slice(0, 300),
      })
      return reply.status(201).send({ ok: true })
    },
  )

  app.get(
    '/admin/feedback',
    {
      schema: { querystring: z.object({ status: z.enum(['new', 'triaged', 'done']).default('new') }) },
    },
    async (req) => {
      await requireStaffUser(db, req.user!.id, req.user!.twoFactorEnabled)
      const rows = await db.execute<{
        id: string
        kind: string
        message: string
        path: string
        created_at: Date
        name: string | null
        status: string
      }>(sql`
      select f.id, f.kind, f.message, f.path, f.created_at, f.status, u.name from ${feedback} f left join "user" u on u.id = f.user_id
      where f.status = ${req.query.status} order by f.created_at desc limit 200`)
      return {
        items: rows.rows.map((r) => ({
          id: r.id,
          kind: r.kind,
          message: r.message,
          path: r.path,
          status: r.status,
          from: r.name ?? 'Someone',
          createdAt: new Date(r.created_at).toISOString(),
        })),
      }
    },
  )
  app.patch(
    '/admin/feedback/:id',
    {
      schema: {
        params: z.object({ id: z.uuid() }),
        body: z.object({ status: z.enum(['new', 'triaged', 'done']) }),
      },
    },
    async (req, reply) => {
      await requireStaffUser(db, req.user!.id, req.user!.twoFactorEnabled)
      await db.update(feedback).set({ status: req.body.status }).where(eq(feedback.id, req.params.id))
      return reply.status(204).send()
    },
  )

  /** The beta's vital signs, by day, for the last 30 days: counts only. */
  app.get('/admin/metrics', async (req) => {
    await requireStaffUser(db, req.user!.id, req.user!.twoFactorEnabled)
    const daily = await db.execute<{
      day: string
      signups: number
      works: number
      active_writers: number
      publishes: number
      proposals: number
      comments: number
    }>(sql`
      with days as (select generate_series(current_date - 29, current_date, interval '1 day')::date as day)
      select to_char(d.day, 'YYYY-MM-DD') as day,
        (select count(*)::int from "user" u where u.created_at::date = d.day) as signups,
        (select count(*)::int from works w where w.created_at::date = d.day) as works,
        (select count(distinct s.user_id)::int from edit_sessions s where s.started_at::date = d.day) as active_writers,
        (select count(*)::int from activity_events a where a.type = 'work.published' and a.created_at::date = d.day) as publishes,
        (select count(*)::int from proposals p where p.created_at::date = d.day) as proposals,
        (select count(*)::int from comments c where c.created_at::date = d.day) as comments
      from days d order by d.day`)
    const [totals] = (
      await db.execute<{ people: number; works: number; published: number; collaborative: number }>(sql`
      select (select count(*)::int from "user") as people,
        (select count(*)::int from works where deleted_at is null) as works,
        (select count(*)::int from works where published_at is not null and deleted_at is null) as published,
        (select count(*)::int from works w where deleted_at is null and (select count(*) from work_members m where m.work_id = w.id) > 1) as collaborative`)
    ).rows
    return { totals, daily: daily.rows }
  })
}

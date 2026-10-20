/**
 * Writing streaks and a daily word goal (P-055). The editor reports the words its writer adds, a few times a minute,
 * against the writer's local date; a streak is consecutive days with any words, counted back from today (or from
 * yesterday, so a streak isn't "lost" before today's writing starts). Streaks reward showing up, never volume.
 */
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod'
import { z } from 'zod'
import { and, desc, eq, gt, sql } from 'drizzle-orm'
import { WritingGoalInput, WritingReport, WritingStats } from '@morrow/contracts'
import { profiles, writingLog, type Database } from '@morrow/db'
import { HttpProblem } from '../problems.ts'
import { PROBLEM } from '@morrow/contracts'

const DAY_MS = 86_400_000
const iso = (d: Date) => d.toISOString().slice(0, 10)
const shift = (day: string, n: number) => iso(new Date(Date.parse(`${day}T00:00:00Z`) + n * DAY_MS))

/** Consecutive days with words, ending at `from` (or the day before, if `from` has none yet). */
export function streakOf(days: Set<string>, from: string) {
  let d = days.has(from) ? from : shift(from, -1)
  let n = 0
  while (days.has(d)) {
    n++
    d = shift(d, -1)
  }
  return n
}
export function bestOf(days: string[]) {
  const sorted = [...days].sort()
  let best = 0
  let run = 0
  for (let i = 0; i < sorted.length; i++) {
    run = i > 0 && shift(sorted[i - 1]!, 1) === sorted[i] ? run + 1 : 1
    best = Math.max(best, run)
  }
  return best
}

export const writingRoutes: FastifyPluginAsyncZod<{ db: Database }> = async (app, { db }) => {
  app.post(
    '/me/writing',
    { schema: { body: WritingReport }, config: { rateLimit: { max: 30, timeWindow: '1 minute' } } },
    async (req, reply) => {
      // A local date is within a day of the server's: anything else is a clock gone wrong (or a forged streak).
      const now = Date.now()
      const t = Date.parse(`${req.body.day}T12:00:00Z`)
      if (Number.isNaN(t) || Math.abs(t - now) > 1.6 * DAY_MS)
        throw new HttpProblem(400, PROBLEM.validation, 'That date isn’t today.')
      await db
        .insert(writingLog)
        .values({ userId: req.user!.id, day: req.body.day, words: Math.max(0, req.body.words) })
        .onConflictDoUpdate({
          target: [writingLog.userId, writingLog.day],
          set: { words: sql`greatest(${writingLog.words} + ${req.body.words}, 0)`, updatedAt: sql`now()` },
        })
      return reply.status(204).send()
    },
  )

  app.get(
    '/me/writing',
    {
      schema: {
        querystring: z.object({
          day: z
            .string()
            .regex(/^\d{4}-\d{2}-\d{2}$/)
            .optional(),
        }),
        response: { 200: WritingStats },
      },
    },
    async (req) => {
      const me = req.user!.id
      const today = req.query.day ?? iso(new Date())
      const rows = await db
        .select({ day: writingLog.day, words: writingLog.words })
        .from(writingLog)
        .where(and(eq(writingLog.userId, me), gt(writingLog.words, 0)))
        .orderBy(desc(writingLog.day))
        .limit(400)
      const byDay = new Map(rows.map((r) => [r.day, r.words]))
      const [p] = await db
        .select({ goal: profiles.dailyWordGoal })
        .from(profiles)
        .where(eq(profiles.userId, me))
      return {
        goal: p?.goal ?? 0,
        today: byDay.get(today) ?? 0,
        streak: streakOf(new Set(byDay.keys()), today),
        best: bestOf([...byDay.keys()]),
        week: Array.from({ length: 7 }, (_, i) => {
          const day = shift(today, i - 6)
          return { day, words: byDay.get(day) ?? 0 }
        }),
      }
    },
  )

  app.put('/me/writing/goal', { schema: { body: WritingGoalInput } }, async (req) => {
    await db.update(profiles).set({ dailyWordGoal: req.body.goal }).where(eq(profiles.userId, req.user!.id))
    return { goal: req.body.goal }
  })
}

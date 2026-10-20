/** "Notify me": join the list for a feature that's coming (comics). Told by notification when it ships. */
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod'
import { z } from 'zod'
import { and, eq } from 'drizzle-orm'
import { featureWaitlist, type Database } from '@morrow/db'

export const COMING_FEATURES = ['comics'] as const
const Params = z.object({ feature: z.enum(COMING_FEATURES) })
const State = z.object({ waiting: z.boolean() })

export const waitlistRoutes: FastifyPluginAsyncZod<{ db: Database }> = async (app, { db }) => {
  const waiting = async (userId: string, feature: string) =>
    (
      await db
        .select({ f: featureWaitlist.feature })
        .from(featureWaitlist)
        .where(and(eq(featureWaitlist.userId, userId), eq(featureWaitlist.feature, feature)))
    ).length > 0

  app.get('/me/waitlist/:feature', { schema: { params: Params, response: { 200: State } } }, async (req) => ({
    waiting: await waiting(req.user!.id, req.params.feature),
  }))
  app.put('/me/waitlist/:feature', { schema: { params: Params, response: { 200: State } } }, async (req) => {
    await db
      .insert(featureWaitlist)
      .values({ userId: req.user!.id, feature: req.params.feature })
      .onConflictDoNothing()
    return { waiting: true }
  })
  app.delete(
    '/me/waitlist/:feature',
    { schema: { params: Params, response: { 200: State } } },
    async (req) => {
      await db
        .delete(featureWaitlist)
        .where(and(eq(featureWaitlist.userId, req.user!.id), eq(featureWaitlist.feature, req.params.feature)))
      return { waiting: false }
    },
  )
}

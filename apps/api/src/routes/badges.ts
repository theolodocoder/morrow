import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod'
import { and, asc, eq } from 'drizzle-orm'
import { AvatarBadge, MyBadges } from '@morrow/contracts'
import { z } from 'zod'
import { achievements, profiles, userAchievements, type Database } from '@morrow/db'
import { evaluateBadges } from '../badges.ts'
import { badgesByUser } from '../people.ts'

/** Your badges: earned and still to earn, so the goals are visible (FR-025). */
export const badgeRoutes: FastifyPluginAsyncZod<{ db: Database }> = async (app, { db }) => {
  /** The badge you wear on your avatar (P-052): one cheap read, no rule checks, for headers. */
  app.get(
    '/me/badge',
    { schema: { response: { 200: z.object({ badge: AvatarBadge.nullable() }) } } },
    async (req) => ({
      badge: (await badgesByUser(db, [req.user!.id])).get(req.user!.id) ?? null,
    }),
  )

  app.get('/me/badges', { schema: { response: { 200: MyBadges } } }, async (req) => {
    const me = req.user!.id
    // Some rules (writing in four different weeks) have no event of their own: check on the way in.
    await evaluateBadges(db, me)
    const rows = await db
      .select({
        code: achievements.code,
        name: achievements.name,
        description: achievements.description,
        awardedAt: userAchievements.awardedAt,
      })
      .from(achievements)
      .leftJoin(
        userAchievements,
        and(eq(userAchievements.achievementCode, achievements.code), eq(userAchievements.userId, me)),
      )
      .where(eq(achievements.active, true))
      .orderBy(asc(achievements.sortOrder))
    const [p] = await db.select({ show: profiles.showBadges }).from(profiles).where(eq(profiles.userId, me))
    return {
      items: rows.map((r) => ({ ...r, awardedAt: r.awardedAt?.toISOString() ?? null })),
      showOnProfile: p?.show ?? true,
    }
  })
}

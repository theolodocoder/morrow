import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod'
import { z } from 'zod'
import { and, asc, desc, eq, isNotNull, isNull, ne, sql } from 'drizzle-orm'
import {
  Profile,
  PublicAuthor,
  UpdateProfileInput,
  Username,
  UsernameAvailability,
  RESERVED_USERNAMES,
} from '@morrow/contracts'
import {
  achievements,
  follows,
  isUniqueViolation,
  profiles,
  publications,
  user,
  userAchievements,
  workMembers,
  works,
  type Database,
} from '@morrow/db'
import { avatarOf, randomAvatar } from '../people.ts'
import { conflict, notFound } from '../problems.ts'

type ProfileRow = typeof profiles.$inferSelect

function toProfile(p: ProfileRow, displayName: string): Profile {
  return {
    username: p.username,
    displayName,
    bio: p.bio,
    interests: p.interests,
    genres: p.genres,
    links: p.links as Profile['links'],
    avatarSeed: p.avatarSeed,
    avatar: avatarOf(p.avatar),
    isPublic: p.isPublic,
    showBio: p.showBio,
    showInterests: p.showInterests,
    showLinks: p.showLinks,
    showFollows: p.showFollows,
    showBadges: p.showBadges,
    onboarded: p.onboardedAt !== null,
  }
}

async function isTaken(db: Database, username: string, exceptUserId?: string) {
  const [row] = await db
    .select({ userId: profiles.userId })
    .from(profiles)
    .where(eq(profiles.username, username))
  return !!row && row.userId !== exceptUserId
}

/** A free username derived from the display name, e.g. "Ama Owusu" → "ama_owusu" or "ama_owusu2". */
export async function suggestUsername(db: Database, name: string) {
  let stem = name
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 24)
  if (stem.length < 3) stem = `writer_${stem}`.replace(/_+$/, '')
  if (RESERVED_USERNAMES.has(stem)) stem = `${stem}_writes`
  for (let n = 0; ; n++) {
    const candidate = n === 0 ? stem : `${stem}${n + 1}`
    if (!(await isTaken(db, candidate))) return candidate
  }
}

/**
 * Every account gets a handle at sign-up, so anyone (invitees who never see onboarding included) can be
 * @mentioned. It starts private: no public author page until the person finishes or skips onboarding.
 */
export async function ensureProfile(db: Database, userId: string, name: string) {
  for (let attempt = 0; attempt < 6; attempt++) {
    try {
      await db
        .insert(profiles)
        // Everyone starts with a face of their own, not a blank: they can change it in onboarding or settings.
        .values({
          userId,
          username: await suggestUsername(db, name),
          isPublic: false,
          avatar: randomAvatar(),
        })
        .onConflictDoNothing({ target: profiles.userId })
      return
    } catch (err) {
      if (!isUniqueViolation(err)) throw err // a same-name sign-up took the suggestion first: try the next one
    }
  }
}

export const profileRoutes: FastifyPluginAsyncZod<{ db: Database }> = async (app, { db }) => {
  app.get('/me/profile', { schema: { response: { 200: Profile } } }, async (req) => {
    const me = req.user!
    const [p] = await db.select().from(profiles).where(eq(profiles.userId, me.id))
    if (p) return toProfile(p, me.name)
    // Not set up yet: offer a suggestion; nothing is stored until the writer saves.
    return {
      username: await suggestUsername(db, me.name),
      displayName: me.name,
      bio: '',
      interests: [],
      genres: [],
      links: [],
      avatarSeed: me.id.slice(-8),
      avatar: null,
      isPublic: true,
      showBio: true,
      showInterests: true,
      showLinks: true,
      showFollows: true,
      showBadges: true,
      onboarded: false,
    }
  })

  app.put(
    '/me/profile',
    { schema: { body: UpdateProfileInput, response: { 200: Profile } } },
    async (req) => {
      const me = req.user!
      const { displayName, onboarded, username, ...fields } = req.body
      if (username && (await isTaken(db, username, me.id))) throw conflict('That username is taken.')
      // A username we suggested (not one the writer chose) can lose a race to someone with the same name who is
      // saving at the same moment; then we simply suggest the next free one. A chosen name that's taken is a 409.
      for (let attempt = 0; ; attempt++) {
        try {
          const p = await db.transaction(async (tx) => {
            if (displayName)
              await tx
                .update(user)
                .set({ name: displayName, updatedAt: sql`now()` })
                .where(eq(user.id, me.id))
            const [existing] = await tx.select().from(profiles).where(eq(profiles.userId, me.id))
            const values = {
              ...(onboarded && existing && !existing.onboardedAt && fields.isPublic === undefined
                ? { isPublic: true }
                : {}),
              ...fields,
              ...(username ? { username } : {}),
              ...(onboarded ? { onboardedAt: sql`coalesce(${profiles.onboardedAt}, now())` } : {}),
              updatedAt: sql`now()`,
            }
            if (existing)
              return (await tx.update(profiles).set(values).where(eq(profiles.userId, me.id)).returning())[0]!
            return (
              await tx
                .insert(profiles)
                .values({
                  userId: me.id,
                  username: username ?? (await suggestUsername(db, displayName ?? me.name)),
                  ...fields,
                  ...(onboarded ? { onboardedAt: new Date() } : {}),
                })
                .returning()
            )[0]!
          })
          return toProfile(p, displayName ?? me.name)
        } catch (err) {
          const lostRace = isUniqueViolation(err)
          if (lostRace && !username && attempt < 5) continue
          if (lostRace) throw conflict('That username is taken.')
          throw err
        }
      }
    },
  )

  app.get(
    '/usernames/:username/availability',
    {
      schema: { params: z.object({ username: z.string().max(60) }), response: { 200: UsernameAvailability } },
      config: { rateLimit: { max: 60, timeWindow: '1 minute' } },
    },
    async (req) => {
      const parsed = Username.safeParse(req.params.username)
      if (!parsed.success)
        return {
          username: req.params.username,
          available: false,
          reason: parsed.error.issues[0]?.message ?? 'Invalid username.',
        }
      const taken = await isTaken(db, parsed.data, req.user!.id)
      return {
        username: parsed.data,
        available: !taken,
        ...(taken ? { reason: 'That username is taken.' } : {}),
      }
    },
  )
}

/** Signed-out: a public author page shows only what the author chose to show, and only published public works. */
export const publicProfileRoutes: FastifyPluginAsyncZod<{ db: Database }> = async (app, { db }) => {
  app.get(
    '/authors/:username',
    { schema: { params: z.object({ username: z.string().max(60) }), response: { 200: PublicAuthor } } },
    async (req) => {
      const [row] = await db
        .select({ p: profiles, name: user.name, createdAt: user.createdAt })
        .from(profiles)
        .innerJoin(user, eq(user.id, profiles.userId))
        .where(eq(profiles.username, req.params.username.toLowerCase()))
      if (!row || !row.p.isPublic) throw notFound()
      const published = await db
        .select({
          title: works.title,
          description: works.description,
          category: works.form,
          slug: works.slug,
          publicId: works.publicId,
          publishedAt: works.publishedAt,
          // what readers can actually read: the pinned publications, never the live draft
          wordCount: sql<number>`(select coalesce(sum(pb.word_count), 0)::int from ${publications} pb where pb.work_id = ${works.id} and pb.superseded_at is null)`,
        })
        .from(works)
        // Never private or unlisted work, never unpublished, never deleted (FR-002, FR-005).
        .where(
          and(
            eq(works.ownerId, row.p.userId),
            eq(works.visibility, 'public'),
            isNotNull(works.publishedAt),
            isNull(works.deletedAt),
            isNull(works.hiddenAt), // moderation (FR-031)
          ),
        )
        .orderBy(desc(works.publishedAt))
        .limit(50)
      // Works they write on with others: shown so readers can find a collaborator's work, not just an owner's.
      const collaborations = await db
        .select({
          title: works.title,
          description: works.description,
          category: works.form,
          slug: works.slug,
          publicId: works.publicId,
          publishedAt: works.publishedAt,
          wordCount: sql<number>`(select coalesce(sum(pb.word_count), 0)::int from ${publications} pb where pb.work_id = ${works.id} and pb.superseded_at is null)`,
        })
        .from(workMembers)
        .innerJoin(works, eq(works.id, workMembers.workId))
        .where(
          and(
            eq(workMembers.userId, row.p.userId),
            ne(works.ownerId, row.p.userId),
            eq(works.visibility, 'public'),
            isNotNull(works.publishedAt),
            isNull(works.deletedAt),
            isNull(works.hiddenAt),
          ),
        )
        .orderBy(desc(works.publishedAt))
        .limit(50)
      const badges = row.p.showBadges
        ? await db
            .select({
              code: achievements.code,
              name: achievements.name,
              description: achievements.description,
              awardedAt: userAchievements.awardedAt,
            })
            .from(userAchievements)
            .innerJoin(achievements, eq(achievements.code, userAchievements.achievementCode))
            .where(and(eq(userAchievements.userId, row.p.userId), eq(achievements.active, true)))
            .orderBy(asc(achievements.sortOrder))
        : null
      const summary = (w: (typeof published)[number]) => ({
        title: w.title,
        description: w.description,
        category: w.category,
        publicPath: `${w.slug}-${w.publicId}`,
        publishedAt: w.publishedAt!.toISOString(),
        wordCount: w.wordCount,
      })
      return {
        username: row.p.username,
        displayName: row.name,
        avatarSeed: row.p.avatarSeed,
        avatar: avatarOf(row.p.avatar),
        joinedAt: row.createdAt.toISOString(),
        bio: row.p.showBio ? row.p.bio : null,
        interests: row.p.showInterests ? row.p.interests : null,
        genres: row.p.showInterests ? row.p.genres : null,
        links: row.p.showLinks ? (row.p.links as PublicAuthor['links']) : null,
        ...(await followCounts(db, row.p.userId, row.p.showFollows)),
        works: published.map(summary),
        collaborations: collaborations.map(summary),
        badges: badges?.map((b) => ({ ...b, awardedAt: b.awardedAt.toISOString() })) ?? null,
      }
    },
  )
}

/** Follower and following counts, unless the author keeps them private (FR-022). */
async function followCounts(db: Database, userId: string, shown: boolean) {
  if (!shown) return { followers: null, following: null }
  const [r] = await db
    .select({
      followers: sql<number>`count(*) filter (where ${follows.targetType} = 'author' and ${follows.targetId} = ${userId})::int`,
      following: sql<number>`count(*) filter (where ${follows.followerId} = ${userId} and ${follows.targetType} = 'author')::int`,
    })
    .from(follows)
    .where(
      sql`(${follows.targetType} = 'author' and ${follows.targetId} = ${userId}) or ${follows.followerId} = ${userId}`,
    )
  return { followers: r?.followers ?? 0, following: r?.following ?? 0 }
}

/**
 * How a person appears on public pages: name, avatar, and a profile link only if their profile is public.
 * One place, so a private profile never leaks a username through some other list.
 */
import { randomInt } from 'node:crypto'
import { and, desc, eq, inArray } from 'drizzle-orm'
import { AVATAR_PARTS, AvatarConfig, type PublicPerson } from '@morrow/contracts'
import { achievements, profiles, user, userAchievements, type Database } from '@morrow/db'

/** A starting avatar for a new account: a face from random parts, which the person can change any time. */
export function randomAvatar(): AvatarConfig {
  const pick = (n: number) => randomInt(n)
  return {
    style: 'face',
    skin: pick(AVATAR_PARTS.skin),
    hair: pick(AVATAR_PARTS.hair),
    hairColor: pick(AVATAR_PARTS.hairColor),
    eyes: pick(AVATAR_PARTS.eyes),
    mouth: pick(AVATAR_PARTS.mouth),
    accessory: pick(AVATAR_PARTS.accessory),
    background: pick(AVATAR_PARTS.background),
  }
}

/** Stored avatars are validated on the way out too: a bad row renders initials, never breaks a page. */
export function avatarOf(raw: unknown): AvatarConfig | null {
  const parsed = AvatarConfig.safeParse(raw)
  return parsed.success ? parsed.data : null
}

export function toPerson(r: {
  name: string
  username: string | null
  isPublic: boolean | null
  avatarSeed: string | null
  avatar: unknown
  fallbackSeed: string
}): PublicPerson {
  return {
    displayName: r.name,
    username: r.isPublic ? r.username : null,
    avatarSeed: r.avatarSeed ?? r.fallbackSeed.slice(-8),
    avatar: avatarOf(r.avatar),
  }
}

/** People by user id, for public display. Missing ids are simply absent. */
export async function peopleByIds(db: Database, ids: string[]): Promise<Map<string, PublicPerson>> {
  const unique = [...new Set(ids)]
  if (!unique.length) return new Map()
  const rows = await db
    .select({
      id: user.id,
      name: user.name,
      username: profiles.username,
      isPublic: profiles.isPublic,
      avatarSeed: profiles.avatarSeed,
      avatar: profiles.avatar,
    })
    .from(user)
    .leftJoin(profiles, eq(profiles.userId, user.id))
    .where(inArray(user.id, unique))
  const badges = await badgesByUser(db, unique)
  return new Map(
    rows.map((r) => [r.id, { ...toPerson({ ...r, fallbackSeed: r.id }), badge: badges.get(r.id) ?? null }]),
  )
}

/** Each person's latest badge and their count, for people who show badges on their profile. */
export async function badgesByUser(db: Database, ids: string[]) {
  const out = new Map<string, { code: string; name: string; count: number }>()
  if (!ids.length) return out
  const rows = await db
    .select({ userId: userAchievements.userId, code: achievements.code, name: achievements.name })
    .from(userAchievements)
    .innerJoin(achievements, eq(achievements.code, userAchievements.achievementCode))
    .innerJoin(profiles, eq(profiles.userId, userAchievements.userId))
    .where(
      and(
        inArray(userAchievements.userId, ids),
        eq(profiles.showBadges, true),
        eq(achievements.active, true),
      ),
    )
    .orderBy(desc(userAchievements.awardedAt))
  for (const r of rows) {
    const had = out.get(r.userId)
    if (had) had.count++
    else out.set(r.userId, { code: r.code, name: r.name, count: 1 })
  }
  return out
}

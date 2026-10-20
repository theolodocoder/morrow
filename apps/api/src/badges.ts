/**
 * Badges (PRD FR-025). Definitions (name, description, on/off) are data in `achievements`; the unlock rule for each code
 * is here, as a query over what actually happened. Rules are re-checked, never counted up, so they're idempotent:
 * re-running can't award twice (the primary key), and nothing depends on having seen every event.
 *
 * Every rule is reachable by normal use, and none rewards volume of trivial activity (PRD §10.3).
 */
import { and, eq, sql, type SQL } from 'drizzle-orm'
import {
  achievements,
  branchMerges,
  branches,
  editSessions,
  notifications,
  proposals,
  userAchievements,
  workMembers,
  works,
  type Database,
  writingLog,
} from '@morrow/db'
import { bestOf } from './routes/writing.ts'

const one = async (db: Database, q: SQL) => Number(((await db.execute(q)).rows[0] as { n?: unknown })?.n ?? 0)

export const BADGE_RULES: Record<string, (db: Database, userId: string) => Promise<boolean>> = {
  first_chapter: async (db, u) =>
    (await one(
      db,
      sql`select count(*)::int as n from ${works} where owner_id = ${u} and published_at is not null and deleted_at is null and visibility <> 'private'`,
    )) > 0,
  the_finisher: async (db, u) =>
    (await one(
      db,
      sql`select count(*)::int as n from ${works} where owner_id = ${u} and completed_at is not null and published_at is not null and deleted_at is null`,
    )) > 0,
  the_muse: async (db, u) =>
    (await one(
      db,
      sql`select count(*)::int as n from ${proposals} p join ${works} w on w.id = p.work_id where p.author_id = ${u} and p.status = 'accepted' and w.owner_id <> ${u}`,
    )) > 0,
  the_editor: async (db, u) =>
    (await one(
      db,
      sql`select count(*)::int as n from ${proposals} where author_id = ${u} and status = 'accepted' and kind = 'edit'`,
    )) >= 5,
  bridge_builder: async (db, u) =>
    (await one(
      db,
      sql`select count(distinct o.user_id)::int as n from ${workMembers} m join ${workMembers} o on o.work_id = m.work_id and o.user_id <> m.user_id where m.user_id = ${u}`,
    )) >= 3,
  plot_twister: async (db, u) =>
    (await one(
      db,
      sql`select count(*)::int as n from ${branchMerges} bm join ${branches} b on b.id = bm.source_branch_id where b.created_by = ${u} and bm.status in ('merged', 'partial')`,
    )) > 0,
  reliable_one: async (db, u) =>
    (await one(
      db,
      sql`select count(distinct date_trunc('week', started_at))::int as n from ${editSessions} where user_id = ${u}`,
    )) >= 4,
  steady_hand: async (db, u) => {
    const days = (
      await db.execute(
        sql`select day::text as d from ${writingLog} where user_id = ${u} and words > 0 order by day`,
      )
    ).rows.map((r) => (r as { d: string }).d)
    return bestOf(days) >= 7
  },
  prompt_answerer: async (db, u) =>
    (await one(
      db,
      sql`select count(*)::int as n from ${works} where owner_id = ${u} and published_at is not null and deleted_at is null and visibility = 'public' and exists (select 1 from unnest(tags) t where t like 'prompt-%')`,
    )) > 0,
  found_readers: async (db, u) =>
    (await one(
      db,
      sql`select coalesce(sum(like_count), 0)::int as n from ${works} where owner_id = ${u} and deleted_at is null`,
    )) >= 10,
}

/** Check every active badge the person doesn't have yet; award and announce the ones they've now earned. */
export async function evaluateBadges(db: Database, userId: string): Promise<string[]> {
  const pending = await db
    .select({ code: achievements.code, name: achievements.name, description: achievements.description })
    .from(achievements)
    .where(
      and(
        eq(achievements.active, true),
        sql`not exists (select 1 from ${userAchievements} ua where ua.user_id = ${userId} and ua.achievement_code = ${achievements.code})`,
      ),
    )
  const awarded: string[] = []
  for (const a of pending) {
    const rule = BADGE_RULES[a.code]
    if (!rule || !(await rule(db, userId))) continue
    const [fresh] = await db
      .insert(userAchievements)
      .values({ userId, achievementCode: a.code })
      .onConflictDoNothing()
      .returning()
    if (!fresh) continue
    awarded.push(a.code)
    // A quiet note, not a celebration screen (PRD §10.7): one in-app notification, never email.
    await db
      .insert(notifications)
      .values({
        userId,
        category: 'activity',
        type: 'badge.earned',
        title: `You earned a badge: ${a.name}`,
        body: a.description,
        url: '/app/badges',
        dedupeKey: `badge:${a.code}`,
      })
      .onConflictDoNothing()
  }
  return awarded
}

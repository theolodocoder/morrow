/**
 * The writer's dashboard: what's happening around your profile and your published work, over 7, 30 or 90 days, each
 * compared with the period before. Everything is counted from rows that already exist (no tracking beyond the
 * one-per-day read and profile-view counts). Days are UTC.
 *
 * Who did what is shown only where it's already public or yours to know (likes, comments, follows). Reads and saves
 * stay counts: nobody learns who read or saved their work.
 */
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod'
import { and, eq, inArray, sql } from 'drizzle-orm'
import { Dashboard, DashboardQuery } from '@morrow/contracts'
import {
  bookmarks,
  follows,
  profileViews,
  profiles,
  readerComments,
  userAchievements,
  workLikes,
  workViews,
  works,
  type Database,
} from '@morrow/db'
import { avatarOf, peopleByIds } from '../people.ts'
import { blockedSet } from '../safety.ts'

interface DayRow {
  day: string
  reads: number
  likes: number
  comments: number
  followers: number
  saves: number
  profile_views: number
}
type Key = 'reads' | 'likes' | 'comments' | 'followers' | 'saves' | 'profileViews'
const clip = (s: string, n = 160) => (s.length > n ? `${s.slice(0, n - 1)}…` : s)

export const dashboardRoutes: FastifyPluginAsyncZod<{ db: Database }> = async (app, { db }) => {
  app.get(
    '/me/dashboard',
    { schema: { querystring: DashboardQuery, response: { 200: Dashboard } } },
    async (req) => {
      const me = req.user!.id
      const n = req.query.days
      // Works I own and haven't deleted: activity on unpublished ones is simply zero.
      const mine = sql`(select id from ${works} where owner_id = ${me} and deleted_at is null)`

      const rows = (
        await db.execute(sql`
          with days as (
            select d::date as day from generate_series((now() at time zone 'UTC')::date - ${2 * n - 1}::int, (now() at time zone 'UTC')::date, interval '1 day') d
          )
          select to_char(days.day, 'YYYY-MM-DD') as day,
            (select count(*)::int from ${workViews} v where v.work_id in ${mine} and v.day = days.day) as reads,
            (select count(*)::int from ${workLikes} l where l.work_id in ${mine} and l.user_id <> ${me}
              and (l.created_at at time zone 'UTC')::date = days.day) as likes,
            (select count(*)::int from ${readerComments} c where c.work_id in ${mine} and c.author_id <> ${me}
              and c.deleted_at is null and (c.created_at at time zone 'UTC')::date = days.day) as comments,
            (select count(*)::int from ${follows} f where f.target_type = 'author' and f.target_id = ${me}
              and (f.created_at at time zone 'UTC')::date = days.day) as followers,
            (select count(*)::int from ${bookmarks} b where b.work_id in ${mine} and b.user_id <> ${me}
              and (b.created_at at time zone 'UTC')::date = days.day) as saves,
            (select count(*)::int from ${profileViews} p where p.user_id = ${me} and p.day = days.day) as profile_views
          from days order by days.day`)
      ).rows as unknown as DayRow[]
      const previous = rows.slice(0, n)
      const current = rows.slice(n)
      const sum = (rs: DayRow[], k: keyof DayRow) => rs.reduce((t, r) => t + Number(r[k]), 0)
      const metric = (k: keyof DayRow) => ({ current: sum(current, k), previous: sum(previous, k) })

      const [p] = await db.select().from(profiles).where(eq(profiles.userId, me))
      const [counts] = (
        await db.execute(sql`select
          (select count(*)::int from ${follows} where target_type = 'author' and target_id = ${me}) as followers,
          (select count(*)::int from ${follows} where follower_id = ${me} and target_type = 'author') as following,
          (select count(*)::int from ${works} where owner_id = ${me} and deleted_at is null and published_at is not null) as published,
          (select count(*)::int from ${userAchievements} where user_id = ${me}) as badges`)
      ).rows as { followers: number; following: number; published: number; badges: number }[]

      const workRows = (
        await db.execute(sql`
          select w.id, w.title, w.slug, w.public_id, w.published_at, w.completed_at, w.view_count, w.like_count,
            w.reader_comment_count,
            (select count(*)::int from ${workViews} v where v.work_id = w.id and v.day > (now() at time zone 'UTC')::date - ${n}::int) as reads_in_period,
            (select count(*)::int from ${bookmarks} b where b.work_id = w.id) as saves,
            (select count(*)::int from ${follows} f where f.target_type = 'work' and f.target_id = w.id::text) as work_followers
          from ${works} w
          where w.owner_id = ${me} and w.deleted_at is null and w.published_at is not null
          order by reads_in_period desc, w.view_count desc, w.published_at desc
          limit 20`)
      ).rows as {
        id: string
        title: string
        slug: string
        public_id: string
        published_at: Date
        completed_at: Date | null
        view_count: number
        like_count: number
        reader_comment_count: number
        reads_in_period: number
        saves: number
        work_followers: number
      }[]

      // Recent activity from people, newest first (blocked people are left out).
      const events = (
        await db.execute(sql`
          (select 'like' as kind, l.user_id as actor, l.created_at as at, w.title, w.slug, w.public_id, null as body
             from ${workLikes} l join ${works} w on w.id = l.work_id
             where w.owner_id = ${me} and w.deleted_at is null and l.user_id <> ${me})
          union all
          (select 'comment', c.author_id, c.created_at, w.title, w.slug, w.public_id, c.body
             from ${readerComments} c join ${works} w on w.id = c.work_id
             where w.owner_id = ${me} and w.deleted_at is null and c.author_id <> ${me} and c.deleted_at is null)
          union all
          (select 'follow', f.follower_id, f.created_at, null, null, null, null
             from ${follows} f where f.target_type = 'author' and f.target_id = ${me})
          union all
          (select 'work_follow', f.follower_id, f.created_at, w.title, w.slug, w.public_id, null
             from ${follows} f join ${works} w on f.target_type = 'work' and f.target_id = w.id::text
             where w.owner_id = ${me} and w.deleted_at is null and f.follower_id <> ${me})
          order by at desc limit 40`)
      ).rows as {
        kind: 'like' | 'comment' | 'follow' | 'work_follow'
        actor: string
        at: Date
        title: string | null
        slug: string | null
        public_id: string | null
        body: string | null
      }[]
      const blocked = await blockedSet(db, me)
      const visible = events.filter((e) => !blocked.has(e.actor))
      const people = await peopleByIds(
        db,
        visible.map((e) => e.actor),
      )
      const followers = visible
        .filter((e) => e.kind === 'follow' || e.kind === 'work_follow')
        .map((e) => e.actor)
      const back = new Set(
        followers.length
          ? (
              await db
                .select({ t: follows.targetId })
                .from(follows)
                .where(
                  and(
                    eq(follows.followerId, me),
                    eq(follows.targetType, 'author'),
                    inArray(follows.targetId, followers),
                  ),
                )
            ).map((r) => r.t)
          : [],
      )

      return {
        days: n,
        profile: {
          displayName: req.user!.name,
          username: p?.username ?? '',
          avatarSeed: p?.avatarSeed ?? me.slice(-8),
          avatar: avatarOf(p?.avatar),
          isPublic: p?.isPublic ?? false,
          followers: counts!.followers,
          following: counts!.following,
          publishedWorks: counts!.published,
          badges: counts!.badges,
        },
        totals: {
          reads: metric('reads'),
          likes: metric('likes'),
          comments: metric('comments'),
          followers: metric('followers'),
          saves: metric('saves'),
          profileViews: metric('profile_views'),
        } satisfies Record<Key, unknown>,
        daily: current.map((r) => ({
          day: r.day,
          reads: r.reads,
          likes: r.likes,
          comments: r.comments,
          followers: r.followers,
          saves: r.saves,
          profileViews: r.profile_views,
        })),
        works: workRows.map((w) => ({
          title: w.title,
          publicPath: `${w.slug}-${w.public_id}`,
          appWorkId: w.id,
          publishedAt: new Date(w.published_at).toISOString(),
          completed: w.completed_at !== null,
          readsInPeriod: w.reads_in_period,
          reads: w.view_count,
          likes: w.like_count,
          comments: w.reader_comment_count,
          saves: w.saves,
          workFollowers: w.work_followers,
        })),
        activity: visible.slice(0, 30).flatMap((e) => {
          const person = people.get(e.actor)
          if (!person) return []
          return [
            {
              kind: e.kind,
              at: new Date(e.at).toISOString(),
              person,
              work: e.title ? { title: e.title, publicPath: `${e.slug}-${e.public_id}` } : null,
              excerpt: e.body ? clip(e.body) : null,
              followingBack: e.kind === 'follow' || e.kind === 'work_follow' ? back.has(e.actor) : null,
            },
          ]
        }),
      }
    },
  )
}

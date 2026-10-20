/**
 * Following authors and works, bookmarks, and the personal reading list (PRD FR-022). You can only follow what you
 * can see publicly; the reading list re-checks visibility every time, so a work that goes private disappears from it
 * unless you're a member.
 */
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod'
import { z } from 'zod'
import { and, desc, eq, inArray, isNull, ne, sql } from 'drizzle-orm'
import { BookmarkInput, FollowState, FollowTarget, ReadingList } from '@morrow/contracts'
import { can } from '@morrow/domain'
import {
  bookmarks,
  follows,
  loadWorkAccess,
  profiles,
  toAccessContext,
  user,
  works,
  workLikes,
  type Database,
} from '@morrow/db'
import { conflict, notFound } from '../problems.ts'
import { readableWork } from './publishing.ts'
import { avatarOf } from '../people.ts'
import { blockedBetween } from '../safety.ts'
import { listQuery, toWork, type Row } from './discovery.ts'
import { DiscoveryWork } from '@morrow/contracts'

type Target = z.infer<typeof FollowTarget>

export const followRoutes: FastifyPluginAsyncZod<{ db: Database }> = async (app, { db }) => {
  /** The thing to follow, if it's publicly visible. 404 otherwise: private things are indistinguishable from none. */
  async function resolve(t: Target, me: string) {
    if (t.type === 'author') {
      const [p] = await db
        .select({ userId: profiles.userId, isPublic: profiles.isPublic })
        .from(profiles)
        .where(eq(profiles.username, t.username.toLowerCase()))
      if (!p || !p.isPublic) throw notFound()
      if (p.userId === me) throw conflict('You can’t follow yourself.')
      if (await blockedBetween(db, me, p.userId)) throw notFound() // indistinguishable from a missing profile
      return { targetType: 'author' as const, targetId: p.userId }
    }
    const w = await readableWork(db, t.publicPath)
    if (!w) throw notFound()
    return { targetType: 'work' as const, targetId: w.id }
  }

  app.put(
    '/me/follows',
    { schema: { body: FollowTarget }, config: { rateLimit: { max: 60, timeWindow: '1 minute' } } },
    async (req, reply) => {
      const me = req.user!.id
      const target = await resolve(req.body, me)
      await db
        .insert(follows)
        .values({ followerId: me, ...target })
        .onConflictDoNothing()
      return reply.status(204).send()
    },
  )
  app.delete('/me/follows', { schema: { body: FollowTarget } }, async (req, reply) => {
    const me = req.user!.id
    // Unfollowing works even if the target has since gone private.
    if (req.body.type === 'author') {
      const [p] = await db
        .select({ id: profiles.userId })
        .from(profiles)
        .where(eq(profiles.username, req.body.username.toLowerCase()))
      if (p)
        await db
          .delete(follows)
          .where(
            and(eq(follows.followerId, me), eq(follows.targetType, 'author'), eq(follows.targetId, p.id)),
          )
    } else {
      const publicId = req.body.publicPath.slice(req.body.publicPath.lastIndexOf('-') + 1)
      const [w] = await db.select({ id: works.id }).from(works).where(eq(works.publicId, publicId))
      if (w)
        await db
          .delete(follows)
          .where(and(eq(follows.followerId, me), eq(follows.targetType, 'work'), eq(follows.targetId, w.id)))
    }
    return reply.status(204).send()
  })

  app.put(
    '/me/bookmarks',
    { schema: { body: BookmarkInput }, config: { rateLimit: { max: 60, timeWindow: '1 minute' } } },
    async (req, reply) => {
      const w = await readableWork(db, req.body.publicPath)
      if (!w) throw notFound()
      await db.insert(bookmarks).values({ userId: req.user!.id, workId: w.id }).onConflictDoNothing()
      return reply.status(204).send()
    },
  )
  app.delete('/me/bookmarks', { schema: { body: BookmarkInput } }, async (req, reply) => {
    const publicId = req.body.publicPath.slice(req.body.publicPath.lastIndexOf('-') + 1)
    const [w] = await db.select({ id: works.id }).from(works).where(eq(works.publicId, publicId))
    if (w)
      await db.delete(bookmarks).where(and(eq(bookmarks.userId, req.user!.id), eq(bookmarks.workId, w.id)))
    return reply.status(204).send()
  })

  /** For the follow/bookmark buttons on public pages (which are rendered anonymously). */
  app.get(
    '/me/follow-state',
    {
      schema: {
        querystring: z.object({
          author: z.string().max(30).optional(),
          work: z.string().max(200).optional(),
        }),
        response: { 200: FollowState },
      },
    },
    async (req) => {
      const me = req.user!.id
      let followingAuthor = false
      let followingWork = false
      let bookmarked = false
      let liked = false
      let isMe = false
      if (req.query.author) {
        const [p] = await db
          .select({ id: profiles.userId })
          .from(profiles)
          .where(eq(profiles.username, req.query.author.toLowerCase()))
        isMe = p?.id === me
        if (p)
          followingAuthor = !!(
            await db
              .select()
              .from(follows)
              .where(
                and(eq(follows.followerId, me), eq(follows.targetType, 'author'), eq(follows.targetId, p.id)),
              )
          )[0]
      }
      if (req.query.work) {
        const w = await readableWork(db, req.query.work)
        if (w) {
          isMe = isMe || w.ownerId === me
          followingWork = !!(
            await db
              .select()
              .from(follows)
              .where(
                and(eq(follows.followerId, me), eq(follows.targetType, 'work'), eq(follows.targetId, w.id)),
              )
          )[0]
          bookmarked = !!(
            await db
              .select()
              .from(bookmarks)
              .where(and(eq(bookmarks.userId, me), eq(bookmarks.workId, w.id)))
          )[0]
          liked = !!(
            await db
              .select()
              .from(workLikes)
              .where(and(eq(workLikes.userId, me), eq(workLikes.workId, w.id)))
          )[0]
        }
      }
      return { followingAuthor, followingWork, bookmarked, liked, isMe }
    },
  )

  /** Discovery's "from people you follow" (FR-020): recent public releases by followed writers and works. */
  app.get(
    '/me/feed',
    { schema: { response: { 200: z.object({ items: z.array(DiscoveryWork) }) } } },
    async (req) => {
      const me = req.user!.id
      const followed = sql`(
      exists (select 1 from ${follows} f where f.follower_id = ${me} and f.target_type = 'author' and f.target_id = w.owner_id)
      or exists (select 1 from ${follows} f where f.follower_id = ${me} and f.target_type = 'work' and f.target_id = w.id::text))`
      const rows = (await db.execute(listQuery(followed, sql`w.published_at desc`, 12)))
        .rows as unknown as Row[]
      return { items: rows.map(toWork) }
    },
  )

  app.get('/me/reading-list', { schema: { response: { 200: ReadingList } } }, async (req) => {
    const me = req.user!.id
    const marked = await db
      .select({ workId: bookmarks.workId })
      .from(bookmarks)
      .where(eq(bookmarks.userId, me))
      .orderBy(desc(bookmarks.createdAt))
    const followedWorks = await db
      .select({ id: follows.targetId })
      .from(follows)
      .where(and(eq(follows.followerId, me), eq(follows.targetType, 'work')))
      .orderBy(desc(follows.createdAt))
    const followedAuthors = await db
      .select({ id: follows.targetId })
      .from(follows)
      .where(and(eq(follows.followerId, me), eq(follows.targetType, 'author')))
      .orderBy(desc(follows.createdAt))

    // Visibility is decided now, not when you bookmarked: public and published, or you're a member.
    const ids = [...new Set([...marked.map((m) => m.workId), ...followedWorks.map((f) => f.id)])]
    const rows = ids.length
      ? await db
          .select({ w: works, author: user.name })
          .from(works)
          .innerJoin(user, eq(user.id, works.ownerId))
          .where(and(inArray(works.id, ids), isNull(works.deletedAt)))
      : []
    const visible = new Map<string, z.infer<typeof ReadingList>['bookmarks'][number]>()
    for (const { w, author } of rows) {
      const publiclyReadable = w.visibility !== 'private' && w.publishedAt !== null && w.hiddenAt === null
      let member = false
      if (!publiclyReadable) {
        const access = await loadWorkAccess(db, w.id, me)
        member = !!access && can({ userId: me }, 'work.read', toAccessContext(access))
        if (!member) continue
      }
      visible.set(w.id, {
        title: w.title,
        description: w.description,
        category: w.form,
        authorName: author,
        publicPath: publiclyReadable ? `${w.slug}-${w.publicId}` : null,
        appWorkId: publiclyReadable ? null : w.id,
        publishedAt: w.publishedAt?.toISOString() ?? null,
      })
    }
    const authorIds = followedAuthors.map((a) => a.id)
    const authors = authorIds.length
      ? await db
          .select({
            username: profiles.username,
            displayName: user.name,
            avatarSeed: profiles.avatarSeed,
            avatar: profiles.avatar,
            id: profiles.userId,
          })
          .from(profiles)
          .innerJoin(user, eq(user.id, profiles.userId))
          .where(
            and(inArray(profiles.userId, authorIds), eq(profiles.isPublic, true), ne(profiles.userId, me)),
          )
      : []
    const order = new Map(authorIds.map((id, i) => [id, i]))
    return {
      bookmarks: marked.flatMap((m) => visible.get(m.workId) ?? []),
      works: followedWorks.flatMap((f) => visible.get(f.id) ?? []),
      authors: authors
        .sort((a, b) => order.get(a.id)! - order.get(b.id)!)
        .map(({ id: _id, ...a }) => ({ ...a, avatar: avatarOf(a.avatar) })),
    }
  })
}

/** Followers to tell when a work is published: the author's (public works only) and the work's own. */
export async function followersOfPublication(
  db: Database,
  w: { id: string; ownerId: string; visibility: string },
) {
  const rows = await db
    .selectDistinct({ id: follows.followerId })
    .from(follows)
    .where(
      w.visibility === 'public'
        ? sql`(${follows.targetType} = 'author' and ${follows.targetId} = ${w.ownerId}) or (${follows.targetType} = 'work' and ${follows.targetId} = ${w.id})`
        : and(eq(follows.targetType, 'work'), eq(follows.targetId, w.id)),
    )
  return rows.map((r) => r.id)
}

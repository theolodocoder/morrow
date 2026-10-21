/**
 * The public, social side of reading (FR-020/022/023): the feed, likes, views and reader comments.
 * Everything here is about published work that anyone may read; the same "findable" rule as Discover applies to the
 * feed, and comments are only on works a reader could open. Counts are denormalised on `works` and changed in the same
 * transaction as the row they count, so the feed never has to count.
 */
import { createHmac } from 'node:crypto'
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod'
import { z } from 'zod'
import { and, asc, desc, eq, inArray, isNull, sql, type SQL } from 'drizzle-orm'
import type { ReaderComment } from '@morrow/contracts'
import { openingLine, type PMNode } from '@morrow/editor'
import {
  coverOf,
  CreateReaderCommentInput,
  Feed,
  FeedQuery,
  LikeState,
  ParagraphCommentCounts,
  PROBLEM,
  ReaderComments,
  type FeedItem,
  type ReaderReply,
} from '@morrow/contracts'
import {
  bookmarks,
  documentSnapshots,
  follows,
  profileViews,
  profiles,
  publications,
  readerComments,
  workLikes,
  workMembers,
  workViews,
  works,
  type Database,
  type Transaction,
} from '@morrow/db'
import { recordActivity } from '../activity.ts'
import { peopleByIds, toPerson } from '../people.ts'
import { HttpProblem, forbidden, notFound } from '../problems.ts'
import { blockedBetween, blockedSet, spamCheck } from '../safety.ts'
import { livePublications, readableWork } from './publishing.ts'
import { readableAlternates } from './alternates.ts'

const PathParams = z.object({ publicPath: z.string().max(200) })
const findable = sql`w.visibility = 'public' and w.published_at is not null and w.deleted_at is null and w.hidden_at is null`

/** The card's opening: the first few paragraphs of the first chapter (at most half of a short one), as plain text. */
const EXCERPT_BLOCKS = 3
const excerptSql = sql`left((
  select string_agg(b.t, ' ')
  from (
    select (select string_agg(x #>> '{}', '') from jsonb_path_query(e.blk, 'strict $.**?(@.type == "text").text') x) as t
    from (select coalesce((
      select s.content_json->'content' from ${publications} pb
      join ${documentSnapshots} s on s.id = pb.snapshot_id
      where pb.work_id = w.id and pb.superseded_at is null
      order by pb.position limit 1
    ), '[]'::jsonb) as blocks) d,
    jsonb_array_elements(d.blocks) with ordinality as e(blk, n)
    where e.n <= greatest(1, least(${EXCERPT_BLOCKS}, ceil(jsonb_array_length(d.blocks) / 2.0)))
  ) b where b.t is not null and b.t <> ''
), 360)`

/**
 * Popular: likes and comments count more than views, and everything fades with age (half-life ~2 days), so a new
 * piece can rise and an old hit doesn't sit at the top forever. Shown to readers as "Popular", never as a quality score.
 */
const popularity = sql`((w.like_count * 3 + w.reader_comment_count * 2 + w.view_count * 0.2 + 1)
  / power(extract(epoch from now() - w.published_at) / 3600 + 2, 1.2))`

interface FeedRow {
  id: string
  owner_id: string
  title: string
  description: string
  form: FeedItem['category']
  tags: string[]
  slug: string
  public_id: string
  published_at: Date
  completed_at: Date | null
  cover: unknown
  like_count: number
  view_count: number
  reader_comment_count: number
  word_count: number
  excerpt: string | null
}

const encode = (v: unknown) => Buffer.from(JSON.stringify(v)).toString('base64url')
function decode<T>(cursor: string | undefined): T | null {
  if (!cursor) return null
  try {
    return JSON.parse(Buffer.from(cursor, 'base64url').toString()) as T
  } catch {
    return null
  }
}

/** Search engines, link previews and monitors aren't readers. */
const BOT = /bot|crawl|spider|slurp|preview|monitor|curl|wget|python|headless|lighthouse/i

export const publicSocialRoutes: FastifyPluginAsyncZod<{
  db: Database
  viewSecret: string
}> = async (app, { db, viewSecret }) => {
  app.get('/feed', { schema: { querystring: FeedQuery, response: { 200: Feed } } }, async (req, reply) => {
    // Depends on who's asking (their likes, follows and blocks): never shared-cached.
    reply.header('cache-control', 'private, no-store')
    const me = req.user?.id ?? null
    const { category, sort, limit } = req.query
    if (sort === 'following' && !me) return { items: [], nextCursor: null }
    // Signed out, "For you" has no one to be for: it's Popular.
    const ranked = sort === 'popular' || sort === 'for_you'

    // the feed is what people write here; classics live on their own shelf (P-063)
    const where: SQL[] = [findable, sql`w.source is null`]
    if (category) where.push(sql`w.form = ${category}`)
    if (me) {
      const blocked = [...(await blockedSet(db, me))]
      if (blocked.length)
        where.push(
          sql`w.owner_id not in (${sql.join(
            blocked.map((b) => sql`${b}`),
            sql`, `,
          )})`,
        )
    }
    if (sort === 'following')
      where.push(sql`(
        exists (select 1 from ${follows} f where f.follower_id = ${me} and f.target_type = 'author' and f.target_id = w.owner_id)
        or exists (select 1 from ${follows} f where f.follower_id = ${me} and f.target_type = 'work' and f.target_id = w.id::text)
      )`)

    let order: SQL
    let offset = 0
    if (sort === 'for_you' && me) {
      offset = decode<{ o: number }>(req.query.cursor)?.o ?? 0
      // Affinity: how much this work looks like what you've liked, saved, read or followed. Each signal multiplies
      // popularity, so a perfect match that nobody reads doesn't outrank everything, and new pieces still surface.
      const liked = sql`(select w2.id from ${works} w2 where w2.id in (
          select l.work_id from ${workLikes} l where l.user_id = ${me}
          union select b.work_id from ${bookmarks} b where b.user_id = ${me}
          union select (f.target_id)::uuid from ${follows} f where f.follower_id = ${me} and f.target_type = 'work'
        ))`
      const affinity = sql`(1
        + 1.5 * (w.form in (select w3.form from ${works} w3 where w3.id in ${liked}))::int
        + 0.6 * (select count(*) from unnest(w.tags) t where t in (select unnest(w4.tags) from ${works} w4 where w4.id in ${liked}))
        + 3 * exists (select 1 from ${follows} f where f.follower_id = ${me} and f.target_type = 'author' and f.target_id = w.owner_id)::int
      )`
      where.push(sql`w.owner_id <> ${me}`)
      where.push(sql`not exists (select 1 from ${workLikes} l where l.work_id = w.id and l.user_id = ${me})`)
      order = sql`${popularity} * ${affinity} desc, w.published_at desc, w.id desc`
    } else if (ranked) {
      offset = decode<{ o: number }>(req.query.cursor)?.o ?? 0
      order = sql`${popularity} desc, w.published_at desc, w.id desc`
    } else {
      const after = decode<{ t: string; id: string }>(req.query.cursor)
      if (after) where.push(sql`(w.published_at, w.id) < (${after.t}::timestamptz, ${after.id}::uuid)`)
      order = sql`w.published_at desc, w.id desc`
    }

    const rows = (
      await db.execute(sql`
        select w.id, w.owner_id, w.title, w.description, w.form, w.tags, w.slug, w.public_id, w.published_at,
          w.completed_at, w.cover, w.like_count, w.view_count, w.reader_comment_count,
          (select coalesce(sum(pb.word_count), 0)::int from ${publications} pb where pb.work_id = w.id and pb.superseded_at is null) as word_count,
          ${excerptSql} as excerpt
        from ${works} w
        where ${sql.join(where, sql` and `)}
        order by ${order}
        limit ${limit + 1} offset ${offset}`)
    ).rows as unknown as FeedRow[]
    const page = rows.slice(0, limit)
    const ids = page.map((r) => r.id)

    const members = ids.length
      ? await db
          .select({ workId: workMembers.workId, userId: workMembers.userId })
          .from(workMembers)
          .where(
            and(
              inArray(workMembers.workId, ids),
              inArray(workMembers.role, ['editor', 'collaborator', 'contributor']),
            ),
          )
          .orderBy(asc(workMembers.createdAt))
      : []
    const people = await peopleByIds(db, [...page.map((r) => r.owner_id), ...members.map((m) => m.userId)])

    let liked = new Set<string>()
    let saved = new Set<string>()
    let followed = new Set<string>()
    if (me && ids.length) {
      liked = new Set(
        (
          await db
            .select({ w: workLikes.workId })
            .from(workLikes)
            .where(and(eq(workLikes.userId, me), inArray(workLikes.workId, ids)))
        ).map((r) => r.w),
      )
      saved = new Set(
        (
          await db
            .select({ w: bookmarks.workId })
            .from(bookmarks)
            .where(and(eq(bookmarks.userId, me), inArray(bookmarks.workId, ids)))
        ).map((r) => r.w),
      )
      followed = new Set(
        (
          await db
            .select({ t: follows.targetId })
            .from(follows)
            .where(
              and(
                eq(follows.followerId, me),
                eq(follows.targetType, 'author'),
                inArray(follows.targetId, [...new Set(page.map((r) => r.owner_id))]),
              ),
            )
        ).map((r) => r.t),
      )
    }

    const items: FeedItem[] = page.map((r) => {
      const others = members.filter((m) => m.workId === r.id && m.userId !== r.owner_id)
      return {
        title: r.title,
        description: r.description,
        excerpt: (r.excerpt ?? '').replace(/\s+/g, ' ').trim(),
        category: r.form,
        tags: r.tags,
        publicPath: `${r.slug}-${r.public_id}`,
        publishedAt: new Date(r.published_at).toISOString(),
        author: people.get(r.owner_id) ?? {
          displayName: 'Unknown',
          username: null,
          avatarSeed: r.owner_id.slice(-8),
          avatar: null,
        },
        collaborators: others
          .slice(0, 4)
          .map((m) => people.get(m.userId))
          .filter((p) => p !== undefined),
        collaboratorCount: others.length,
        wordCount: r.word_count,
        completed: r.completed_at !== null,
        cover: coverOf(r.id, r.cover),
        likes: r.like_count,
        views: r.view_count,
        comments: r.reader_comment_count,
        viewer: me
          ? {
              liked: liked.has(r.id),
              bookmarked: saved.has(r.id),
              followingAuthor: followed.has(r.owner_id),
              isAuthor: r.owner_id === me,
            }
          : null,
      }
    })
    const last = page.at(-1)
    const nextCursor =
      rows.length > limit && last
        ? ranked
          ? encode({ o: offset + limit })
          : encode({ t: new Date(last.published_at).toISOString(), id: last.id })
        : null
    return { items, nextCursor }
  })

  // A view: one per reader per work per day, the author's own visits excluded. Called by the reading page in the
  // browser (so link prefetches and crawlers that don't run scripts never count).
  app.post(
    '/reading/:publicPath/view',
    { schema: { params: PathParams }, config: { rateLimit: { max: 60, timeWindow: '1 minute' } } },
    async (req, reply) => {
      const w = await readableWork(db, req.params.publicPath)
      if (!w) throw notFound()
      const ua = req.headers['user-agent'] ?? ''
      if (BOT.test(ua) || req.user?.id === w.ownerId) return reply.status(204).send()
      const day = new Date().toISOString().slice(0, 10)
      // Signed out: a keyed hash of address + browser + day. Not reversible, and it can't link one day to the next.
      const viewer = req.user
        ? `u:${req.user.id}`
        : `a:${createHmac('sha256', viewSecret).update(`${req.ip}|${ua}|${day}`).digest('base64url').slice(0, 22)}`
      await db.transaction(async (tx) => {
        const [fresh] = await tx
          .insert(workViews)
          .values({ workId: w.id, viewer, day })
          .onConflictDoNothing()
          .returning()
        if (!fresh) return
        const [row] = await tx
          .update(works)
          .set({ viewCount: sql`${works.viewCount} + 1` })
          .where(eq(works.id, w.id))
          .returning({ n: works.viewCount })
        await milestone(tx, w, 'reads', row!.n)
      })
      return reply.status(204).send()
    },
  )

  // A visit to an author's public page, for their dashboard. Same rules as reads: once a day, never your own, no bots.
  app.post(
    '/authors/:username/view',
    {
      schema: { params: z.object({ username: z.string().max(60) }) },
      config: { rateLimit: { max: 60, timeWindow: '1 minute' } },
    },
    async (req, reply) => {
      const [p] = await db
        .select({ userId: profiles.userId, isPublic: profiles.isPublic })
        .from(profiles)
        .where(eq(profiles.username, req.params.username.toLowerCase()))
      if (!p || !p.isPublic) throw notFound()
      const ua = req.headers['user-agent'] ?? ''
      if (BOT.test(ua) || req.user?.id === p.userId) return reply.status(204).send()
      const day = new Date().toISOString().slice(0, 10)
      const viewer = req.user
        ? `u:${req.user.id}`
        : `a:${createHmac('sha256', viewSecret).update(`${req.ip}|${ua}|${day}`).digest('base64url').slice(0, 22)}`
      await db.insert(profileViews).values({ userId: p.userId, viewer, day }).onConflictDoNothing()
      return reply.status(204).send()
    },
  )

  app.get(
    '/reading/:publicPath/comments',
    {
      schema: {
        params: PathParams,
        querystring: z.object({
          cursor: z.string().max(200).optional(),
          /** a chapter's discussion (paragraph comments included), or with `block` one paragraph's thread (P-054); without these, the comments on the whole work */
          chapter: z.string().max(240).optional(),
          block: z.string().max(120).optional(),
        }),
        response: { 200: ReaderComments },
      },
    },
    async (req, reply) => {
      reply.header('cache-control', 'private, no-store')
      const w = await readableWork(db, req.params.publicPath)
      if (!w) throw notFound()
      const me = req.user?.id ?? null
      const hidden = me ? await blockedSet(db, me) : new Set<string>()
      const per = 20
      const after = decode<{ t: string; id: string }>(req.query.cursor)
      const chapterId = req.query.chapter ? await publishedChapterId(db, w.id, req.query.chapter) : null
      if ((req.query.chapter || req.query.block) && !chapterId) throw notFound()
      // Replies inherit their parent's chapter and block, so one scope covers a thread and its count.
      const scope = and(
        eq(readerComments.workId, w.id),
        chapterId
          ? and(
              eq(readerComments.chapterId, chapterId),
              req.query.block ? eq(readerComments.blockId, req.query.block) : undefined,
            )
          : isNull(readerComments.chapterId),
      )
      const tops = await db
        .select()
        .from(readerComments)
        .where(
          and(
            scope,
            isNull(readerComments.parentId),
            after
              ? sql`(${readerComments.createdAt}, ${readerComments.id}) < (${after.t}::timestamptz, ${after.id}::uuid)`
              : undefined,
          ),
        )
        .orderBy(desc(readerComments.createdAt), desc(readerComments.id))
        .limit(per + 1)
      const page = tops.slice(0, per)
      const replies = page.length
        ? await db
            .select()
            .from(readerComments)
            .where(
              and(
                inArray(
                  readerComments.parentId,
                  page.map((c) => c.id),
                ),
                isNull(readerComments.deletedAt),
              ),
            )
            .orderBy(asc(readerComments.createdAt))
        : []
      const people = await peopleByIds(
        db,
        [...page, ...replies].map((c) => c.authorId),
      )
      // The whole-work list has no quotes; a chapter's snapshot is read once for all its comments.
      const doc = chapterId ? await publishedDoc(db, w.id, chapterId) : undefined
      const view = (c: typeof readerComments.$inferSelect): ReaderReply => ({
        id: c.id,
        parentId: c.parentId,
        body: c.deletedAt ? '' : c.body,
        createdAt: c.createdAt.toISOString(),
        editedAt: c.editedAt?.toISOString() ?? null,
        author: c.deletedAt
          ? { displayName: 'Removed', username: null, avatarSeed: '00000000', avatar: null }
          : (people.get(c.authorId) ??
            toPerson({
              name: 'Someone',
              username: null,
              isPublic: false,
              avatarSeed: null,
              avatar: null,
              fallbackSeed: c.authorId,
            })),
        byAuthor: c.authorId === w.ownerId,
        canDelete: !c.deletedAt && !!me && (me === c.authorId || me === w.ownerId),
        removed: !!c.deletedAt,
        blockId: c.blockId,
        quote: null,
      })
      const items: ReaderComment[] = []
      for (const c of page) {
        if (hidden.has(c.authorId)) continue
        const mine = replies.filter((r) => r.parentId === c.id && !hidden.has(r.authorId)).map(view)
        // A deleted comment stays only as a placeholder for its replies.
        if (c.deletedAt && !mine.length) continue
        items.push({ ...view(c), quote: quoteOf(doc, c.blockId), replies: mine })
      }
      // Counted like works.readerCommentCount (replies too, removed ones not), but for this thread alone.
      const [count] = await db
        .select({ n: sql<number>`count(*)::int` })
        .from(readerComments)
        .where(and(scope, isNull(readerComments.deletedAt)))
      const last = page.at(-1)
      return {
        items,
        total: count!.n,
        nextCursor:
          tops.length > per && last ? encode({ t: last.createdAt.toISOString(), id: last.id }) : null,
        canComment: !!me && req.user!.restriction === null && !(await blockedBetween(db, me, w.ownerId)),
      }
    },
  )

  /** Paragraph comment counts for one chapter (P-054): the reader shows a small bubble beside each such paragraph. */
  app.get(
    '/reading/:publicPath/chapters/:chapterSlug/paragraph-comments',
    {
      schema: {
        params: z.object({ publicPath: z.string().max(200), chapterSlug: z.string().max(240) }),
        response: { 200: ParagraphCommentCounts },
      },
    },
    async (req, reply) => {
      reply.header('cache-control', 'private, no-store')
      const w = await readableWork(db, req.params.publicPath)
      if (!w) throw notFound()
      const chapterId = await publishedChapterId(db, w.id, req.params.chapterSlug)
      if (!chapterId) throw notFound()
      const hidden = req.user ? [...(await blockedSet(db, req.user.id))] : []
      const rows = await db
        .select({ block: readerComments.blockId, n: sql<number>`count(*)::int` })
        .from(readerComments)
        .where(
          and(
            eq(readerComments.chapterId, chapterId),
            isNull(readerComments.deletedAt),
            sql`${readerComments.blockId} is not null`,
            hidden.length ? sql`${readerComments.authorId} not in ${hidden}` : undefined,
          ),
        )
        .groupBy(readerComments.blockId)
      return { counts: Object.fromEntries(rows.map((r) => [r.block!, r.n])) }
    },
  )
}

/**
 * The published chapter a slug names (slugs end with the chapter id's last six characters): main's first, then
 * the chapters of an alternate version readers can reach.
 */
async function publishedChapterId(db: Database, workId: string, slug: string) {
  const suffix = slug.slice(-6)
  const main = await livePublications(db, workId)
  const named = (rows: { chapterId: string }[]) => rows.find((r) => r.chapterId.endsWith(suffix))?.chapterId
  return named(main) ?? (await readableAlternates(db, main)).map((a) => named(a.rows)).find(Boolean) ?? null
}

/** The live (published) text of one chapter, main's or a readable alternate's. */
async function publishedDoc(db: Database, workId: string, chapterId: string) {
  const main = await livePublications(db, workId)
  const row = [...main, ...(await readableAlternates(db, main)).flatMap((a) => a.rows)].find(
    (r) => r.chapterId === chapterId,
  )
  if (!row) return undefined
  const [snap] = await db
    .select({ doc: documentSnapshots.contentJson })
    .from(documentSnapshots)
    .where(eq(documentSnapshots.id, row.snapshotId))
  return snap?.doc as PMNode | undefined
}

const findBlock = (node: PMNode, id: string): PMNode | undefined =>
  node.attrs?.id === id ? node : node.content?.map((c) => findBlock(c, id)).find(Boolean)

/** A paragraph's published text for a comment to quote; null when it is no longer in the chapter. */
function quoteOf(doc: PMNode | undefined, blockId: string | null) {
  const block = doc && blockId ? findBlock(doc, blockId) : undefined
  // 279 + the ellipsis keeps it within 280
  return block ? openingLine({ type: 'doc', content: [block] }, 279) : null
}

/**
 * Milestones (P-056): the moment a work passes 10, 50, 100, 500, … reads or likes, the writer hears about it (and gets a
 * card to share). Recorded once per threshold: an unlike and re-like can't fire it twice (the notification's dedupe
 * key is the threshold itself).
 */
export const MILESTONES = [10, 50, 100, 250, 500, 1000, 2500, 5000, 10000, 25000, 50000, 100000]
async function milestone(
  tx: Transaction,
  w: { id: string; ownerId: string },
  kind: 'reads' | 'likes',
  n: number,
) {
  if (!MILESTONES.includes(n)) return
  await recordActivity(tx, {
    workId: w.id,
    actorId: w.ownerId,
    type: 'work.milestone',
    subjectType: 'work',
    subjectId: w.id,
    data: { kind, n },
  })
}

/** Signed-in actions: like, comment, delete a comment. */
export const socialRoutes: FastifyPluginAsyncZod<{ db: Database }> = async (app, { db }) => {
  const likeState = async (workId: string, me: string) => {
    const [w] = await db.select({ likes: works.likeCount }).from(works).where(eq(works.id, workId))
    const [l] = await db
      .select({ x: workLikes.userId })
      .from(workLikes)
      .where(and(eq(workLikes.workId, workId), eq(workLikes.userId, me)))
    return { liked: !!l, likes: w?.likes ?? 0 }
  }

  app.put(
    '/reading/:publicPath/like',
    { schema: { params: PathParams, response: { 200: LikeState } } },
    async (req) => {
      const me = req.user!.id
      const w = await readableWork(db, req.params.publicPath)
      if (!w) throw notFound()
      await db.transaction(async (tx) => {
        const [fresh] = await tx
          .insert(workLikes)
          .values({ workId: w.id, userId: me })
          .onConflictDoNothing()
          .returning()
        if (!fresh) return
        const [row] = await tx
          .update(works)
          .set({ likeCount: sql`${works.likeCount} + 1` })
          .where(eq(works.id, w.id))
          .returning({ n: works.likeCount })
        await milestone(tx, w, 'likes', row!.n)
        if (me !== w.ownerId)
          await recordActivity(tx, {
            workId: w.id,
            actorId: me,
            type: 'work.liked',
            subjectType: 'work',
            subjectId: w.id,
          })
      })
      return likeState(w.id, me)
    },
  )

  app.delete(
    '/reading/:publicPath/like',
    { schema: { params: PathParams, response: { 200: LikeState } } },
    async (req) => {
      const me = req.user!.id
      const w = await readableWork(db, req.params.publicPath)
      if (!w) throw notFound()
      await db.transaction(async (tx) => {
        const gone = await tx
          .delete(workLikes)
          .where(and(eq(workLikes.workId, w.id), eq(workLikes.userId, me)))
          .returning()
        if (gone.length)
          await tx
            .update(works)
            .set({ likeCount: sql`greatest(${works.likeCount} - 1, 0)` })
            .where(eq(works.id, w.id))
      })
      return likeState(w.id, me)
    },
  )

  app.post(
    '/reading/:publicPath/comments',
    {
      schema: { params: PathParams, body: CreateReaderCommentInput },
      config: { rateLimit: { max: 20, timeWindow: '1 minute' } },
    },
    async (req, reply) => {
      const me = req.user!.id
      const w = await readableWork(db, req.params.publicPath)
      if (!w) throw notFound()
      if (await blockedBetween(db, me, w.ownerId)) throw forbidden()
      let parentId: string | null = null
      let parentAuthor: string | null = null
      let chapterId: string | null = null
      let blockId: string | null = null
      if (req.body.chapterSlug) {
        chapterId = await publishedChapterId(db, w.id, req.body.chapterSlug)
        if (!chapterId) throw notFound()
        blockId = req.body.blockId ?? null
      }
      if (req.body.parentId) {
        const [p] = await db.select().from(readerComments).where(eq(readerComments.id, req.body.parentId))
        if (!p || p.workId !== w.id) throw notFound()
        // One level of replies: answering a reply joins the same thread.
        parentId = p.parentId ?? p.id
        parentAuthor = p.authorId
        // replies stay with their paragraph
        chapterId = p.chapterId
        blockId = p.blockId
        if (await blockedBetween(db, me, p.authorId)) throw forbidden()
      }
      await spamCheck(db, me, req.body.body, 'reader_comment')
      const c = await db.transaction(async (tx) => {
        const [row] = await tx
          .insert(readerComments)
          .values({ workId: w.id, authorId: me, parentId, chapterId, blockId, body: req.body.body })
          .returning()
        await tx
          .update(works)
          .set({ readerCommentCount: sql`${works.readerCommentCount} + 1` })
          .where(eq(works.id, w.id))
        await recordActivity(tx, {
          workId: w.id,
          actorId: me,
          type: parentId ? 'reader_comment.replied' : 'reader_comment.created',
          subjectType: 'reader_comment',
          subjectId: row!.id,
          data: { parentAuthor },
        })
        return row!
      })
      return reply.status(201).send({ id: c.id })
    },
  )

  app.delete(
    '/reader-comments/:commentId',
    { schema: { params: z.object({ commentId: z.uuid() }) } },
    async (req, reply) => {
      const me = req.user!.id
      const [c] = await db.select().from(readerComments).where(eq(readerComments.id, req.params.commentId))
      if (!c || c.deletedAt) throw notFound()
      const [w] = await db.select({ ownerId: works.ownerId }).from(works).where(eq(works.id, c.workId))
      // Your own comment, or any comment on your work (the author keeps their own space civil).
      if (c.authorId !== me && w?.ownerId !== me)
        throw new HttpProblem(403, PROBLEM.forbidden, 'You can only delete your own comments.')
      await removeReaderComment(db, c.id, me)
      return reply.status(204).send()
    },
  )
}

/** Soft-delete and keep the count honest. Shared with moderation. */
export async function removeReaderComment(db: Database, commentId: string, by: string) {
  await db.transaction(async (tx) => {
    const [gone] = await tx
      .update(readerComments)
      .set({ deletedAt: sql`now()`, deletedBy: by })
      .where(and(eq(readerComments.id, commentId), isNull(readerComments.deletedAt)))
      .returning()
    if (gone)
      await tx
        .update(works)
        .set({ readerCommentCount: sql`greatest(${works.readerCommentCount} - 1, 0)` })
        .where(eq(works.id, gone.workId))
  })
}

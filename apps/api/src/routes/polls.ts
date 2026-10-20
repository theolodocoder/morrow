/**
 * "What if" reader polls (P-062). The writer asks a question at the end of a chapter; readers vote (signed in, once,
 * changeable until it closes); counts show once you've voted or it has closed, so the first votes aren't herded by
 * the rest. The writer always sees the counts, in the editor.
 */
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod'
import { z } from 'zod'
import { and, eq, sql } from 'drizzle-orm'
import { Poll, PollInput, VoteInput } from '@morrow/contracts'
import { chapterPolls, chapters, pollVotes, type Database } from '@morrow/db'
import { requireWork } from '../access.ts'
import { blockedBetween } from '../safety.ts'
import { conflict, forbidden, notFound } from '../problems.ts'
import { livePublications, readableWork } from './publishing.ts'

const ChapterParams = z.object({ chapterId: z.uuid() })
const ReadParams = z.object({ publicPath: z.string().max(200), chapterSlug: z.string().max(240) })

async function view(
  db: Database,
  poll: typeof chapterPolls.$inferSelect,
  me: string | null,
  writer: boolean,
): Promise<Poll> {
  const counts = await db
    .select({ option: pollVotes.option, n: sql<number>`count(*)::int` })
    .from(pollVotes)
    .where(eq(pollVotes.pollId, poll.id))
    .groupBy(pollVotes.option)
  const [mine] = me
    ? await db
        .select({ option: pollVotes.option })
        .from(pollVotes)
        .where(and(eq(pollVotes.pollId, poll.id), eq(pollVotes.userId, me)))
    : []
  const closed = !!poll.closesAt && poll.closesAt <= new Date()
  const show = writer || closed || mine !== undefined
  return {
    question: poll.question,
    options: poll.options.map((label, i) => ({
      label,
      votes: show ? (counts.find((c) => c.option === i)?.n ?? 0) : null,
    })),
    total: counts.reduce((t, c) => t + c.n, 0),
    myVote: mine?.option ?? null,
    closesAt: poll.closesAt?.toISOString() ?? null,
    closed,
  }
}

/** Writers: set, read and remove a chapter's poll (anyone who may publish the work). */
export const pollRoutes: FastifyPluginAsyncZod<{ db: Database }> = async (app, { db }) => {
  const chapterOf = async (chapterId: string, userId: string, capability: 'work.read' | 'work.publish') => {
    const [c] = await db.select().from(chapters).where(eq(chapters.id, chapterId))
    if (!c) throw notFound()
    await requireWork(db, c.workId, userId, capability)
    return c
  }

  app.get('/chapters/:chapterId/poll', { schema: { params: ChapterParams } }, async (req) => {
    const c = await chapterOf(req.params.chapterId, req.user!.id, 'work.read')
    const [poll] = await db.select().from(chapterPolls).where(eq(chapterPolls.chapterId, c.id))
    return { poll: poll ? await view(db, poll, req.user!.id, true) : null }
  })

  app.put(
    '/chapters/:chapterId/poll',
    { schema: { params: ChapterParams, body: PollInput } },
    async (req) => {
      const c = await chapterOf(req.params.chapterId, req.user!.id, 'work.publish')
      const [existing] = await db.select().from(chapterPolls).where(eq(chapterPolls.chapterId, c.id))
      const closesAt = req.body.closesInDays
        ? new Date(Date.now() + req.body.closesInDays * 86_400_000)
        : null
      if (existing) {
        const [{ n }] = (await db
          .select({ n: sql<number>`count(*)::int` })
          .from(pollVotes)
          .where(eq(pollVotes.pollId, existing.id))) as [{ n: number }]
        // Once people have voted, the answers can't change under them (the closing date can).
        if (n > 0 && JSON.stringify(existing.options) !== JSON.stringify(req.body.options))
          throw conflict(
            'People have already voted: you can change the question’s closing date, not its answers.',
          )
        const [poll] = await db
          .update(chapterPolls)
          .set({ question: req.body.question, options: req.body.options, closesAt })
          .where(eq(chapterPolls.id, existing.id))
          .returning()
        return { poll: await view(db, poll!, req.user!.id, true) }
      }
      const [poll] = await db
        .insert(chapterPolls)
        .values({
          workId: c.workId,
          chapterId: c.id,
          question: req.body.question,
          options: req.body.options,
          closesAt,
          createdBy: req.user!.id,
        })
        .returning()
      return { poll: await view(db, poll!, req.user!.id, true) }
    },
  )

  app.delete('/chapters/:chapterId/poll', { schema: { params: ChapterParams } }, async (req, reply) => {
    const c = await chapterOf(req.params.chapterId, req.user!.id, 'work.publish')
    await db.delete(chapterPolls).where(eq(chapterPolls.chapterId, c.id))
    return reply.status(204).send()
  })

  /** Readers vote (or change their vote) while it's open. */
  app.post(
    '/reading/:publicPath/chapters/:chapterSlug/poll/vote',
    { schema: { params: ReadParams, body: VoteInput, response: { 200: Poll } } },
    async (req) => {
      const me = req.user!.id
      const { w, poll } = await publicPoll(db, req.params.publicPath, req.params.chapterSlug)
      if (!poll) throw notFound()
      if (await blockedBetween(db, me, w.ownerId)) throw forbidden()
      if (poll.closesAt && poll.closesAt <= new Date()) throw conflict('This poll has closed.')
      if (req.body.option >= poll.options.length) throw notFound()
      await db
        .insert(pollVotes)
        .values({ pollId: poll.id, userId: me, option: req.body.option })
        .onConflictDoUpdate({
          target: [pollVotes.pollId, pollVotes.userId],
          set: { option: req.body.option },
        })
      return view(db, poll, me, w.ownerId === me)
    },
  )
}

async function publicPoll(db: Database, publicPath: string, slug: string) {
  const w = await readableWork(db, publicPath)
  if (!w) throw notFound()
  const suffix = slug.slice(-6)
  const pub = (await livePublications(db, w.id)).find((p) => p.chapterId.endsWith(suffix))
  if (!pub) throw notFound()
  const [poll] = await db.select().from(chapterPolls).where(eq(chapterPolls.chapterId, pub.chapterId))
  return { w, poll }
}

/** Anyone: the poll at the end of a published chapter (counts once you've voted or it's closed). */
export const publicPollRoutes: FastifyPluginAsyncZod<{ db: Database }> = async (app, { db }) => {
  app.get(
    '/reading/:publicPath/chapters/:chapterSlug/poll',
    { schema: { params: ReadParams, response: { 200: z.object({ poll: Poll.nullable() }) } } },
    async (req, reply) => {
      reply.header('cache-control', 'private, no-store')
      const { w, poll } = await publicPoll(db, req.params.publicPath, req.params.chapterSlug)
      return { poll: poll ? await view(db, poll, req.user?.id ?? null, req.user?.id === w.ownerId) : null }
    },
  )
}

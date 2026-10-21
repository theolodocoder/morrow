/**
 * Where a signed-in reader got to in each chapter of a published work (spec call 6), so Continue and "% read" follow
 * them between devices. A row per (reader, work, chapter); only its reader ever reads or writes it.
 */
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod'
import { z } from 'zod'
import { and, desc, eq, sql } from 'drizzle-orm'
import { ReadingPositions, SaveReadingPositions } from '@morrow/contracts'
import { readingPositions, type Database } from '@morrow/db'
import { notFound } from '../problems.ts'
import { chapterSlug, livePublications, readableWork } from './publishing.ts'
import { readableAlternates } from './alternates.ts'

const PathParams = z.object({ publicPath: z.string().max(200) })

/** Every chapter readers can open, main's then each version's, keyed by the six-character id suffix slugs end with. */
async function liveChapters(db: Database, workId: string) {
  const main = await livePublications(db, workId)
  const rows = [...main, ...(await readableAlternates(db, main)).flatMap((a) => a.rows)]
  const bySuffix = new Map<string, { chapterId: string; slug: string }>()
  for (const r of rows) {
    const suffix = r.chapterId.slice(-6)
    if (!bySuffix.has(suffix))
      bySuffix.set(suffix, { chapterId: r.chapterId, slug: chapterSlug(r.title, r.chapterId) })
  }
  return bySuffix
}

export const readingPositionRoutes: FastifyPluginAsyncZod<{ db: Database }> = async (app, { db }) => {
  app.get(
    '/me/reading/:publicPath/positions',
    { schema: { params: PathParams, response: { 200: ReadingPositions } } },
    async (req, reply) => {
      reply.header('cache-control', 'private, no-store')
      const w = await readableWork(db, req.params.publicPath)
      if (!w) throw notFound()
      const live = [...(await liveChapters(db, w.id)).values()]
      const rows = await db
        .select()
        .from(readingPositions)
        .where(and(eq(readingPositions.userId, req.user!.id), eq(readingPositions.workId, w.id)))
        .orderBy(desc(readingPositions.updatedAt))
      const slugOf = new Map(live.map((c) => [c.chapterId, c.slug]))
      const byChapter = new Map(rows.map((r) => [r.chapterId, r]))
      return {
        // reading order; chapters taken down since are left out, not reported as errors
        items: live.flatMap((c) => {
          const r = byChapter.get(c.chapterId)
          return r ? [{ chapterSlug: c.slug, blockId: r.blockId, percent: r.percent }] : []
        }),
        last: rows.map((r) => slugOf.get(r.chapterId)).find(Boolean) ?? null,
      }
    },
  )

  app.put(
    '/me/reading/:publicPath/positions',
    {
      schema: { params: PathParams, body: SaveReadingPositions },
      // a save every few seconds while reading, plus one as the page closes
      config: { rateLimit: { max: 30, timeWindow: '1 minute' } },
    },
    async (req, reply) => {
      const w = await readableWork(db, req.params.publicPath)
      if (!w) throw notFound()
      const live = await liveChapters(db, w.id)
      // One row per chapter (Postgres can't upsert a row twice in one statement), the furthest point of any repeats,
      // moved to the end so the last chapter named is the one Continue opens.
      const best = new Map<string, { chapterId: string; blockId: string | null; percent: number }>()
      for (const item of req.body.items) {
        const c = item.chapterSlug.length >= 6 ? live.get(item.chapterSlug.slice(-6)) : undefined
        if (!c) continue
        const prev = best.get(c.chapterId)
        best.delete(c.chapterId)
        best.set(
          c.chapterId,
          prev && prev.percent > item.percent ? prev : { ...item, chapterId: c.chapterId },
        )
      }
      if (best.size)
        await db
          .insert(readingPositions)
          .values(
            [...best.values()].map((p) => ({
              userId: req.user!.id,
              workId: w.id,
              chapterId: p.chapterId,
              blockId: p.blockId,
              percent: p.percent,
              // per row, in order, unlike now(): the last chapter in the save is the latest
              updatedAt: sql`clock_timestamp()`,
            })),
          )
          .onConflictDoUpdate({
            target: [readingPositions.userId, readingPositions.workId, readingPositions.chapterId],
            // furthest wins, so re-reading an early page never loses the place; the paragraph goes with the percent, and a
            // save that knows no paragraph never erases one
            set: {
              percent: sql`greatest(${readingPositions.percent}, excluded.percent)`,
              blockId: sql`case when excluded.percent >= ${readingPositions.percent} then coalesce(excluded.block_id, ${readingPositions.blockId}) else ${readingPositions.blockId} end`,
              updatedAt: sql`excluded.updated_at`,
            },
          })
      return reply.status(204).send()
    },
  )
}

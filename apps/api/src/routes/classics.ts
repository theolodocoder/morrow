/**
 * Retell a classic (P-063): copy a public-domain work into a new private work of your own (every chapter as published,
 * keeping its history), to rewrite, continue, modernise or answer. Only public-domain works can be retold this way;
 * nobody else's writing is ever copied.
 */
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod'
import { z } from 'zod'
import { eq } from 'drizzle-orm'
import { SCHEMA_VERSION } from '@morrow/editor'
import { branches, chapters, documents, workMembers, works, type Database } from '@morrow/db'
import type { CollabGateway } from '../collab-gateway.ts'
import { recordActivity } from '../activity.ts'
import { assertCanAddPrivateWork } from '../entitlements.ts'
import { HttpProblem, conflict, notFound } from '../problems.ts'
import { PROBLEM } from '@morrow/contracts'
import { slugify } from '../slug.ts'
import { classicOf, livePublications, readableWork } from './publishing.ts'

export const classicRoutes: FastifyPluginAsyncZod<{ db: Database; collab: CollabGateway }> = async (
  app,
  { db, collab },
) => {
  app.post(
    '/works/retell',
    {
      schema: {
        body: z.object({ publicPath: z.string().min(3).max(200) }),
        response: { 201: z.object({ id: z.uuid() }) },
      },
      config: { rateLimit: { max: 10, timeWindow: '1 hour' } },
    },
    async (req, reply) => {
      const me = req.user!.id
      const source = await readableWork(db, req.body.publicPath)
      if (!source) throw notFound()
      const classic = classicOf(source.source)
      if (!classic) throw conflict('Only public-domain classics can be retold this way.')
      await assertCanAddPrivateWork(db, me)
      const pubs = await livePublications(db, source.id)
      const title = `${source.title}: a retelling`
      const { work, made } = await db.transaction(async (tx) => {
        const [w] = await tx
          .insert(works)
          .values({
            ownerId: me,
            title,
            slug: slugify(title),
            description: `Based on ${source.title} by ${classic.author} (${classic.year}, public domain).`,
            form: source.form,
            tags: ['retelling', slugify(source.title)],
          })
          .returning()
        await tx.insert(workMembers).values({ workId: w!.id, userId: me, role: 'owner', grantedBy: me })
        const [b] = await tx
          .insert(branches)
          .values({ workId: w!.id, name: 'Main', slug: 'main', createdBy: me, isDefault: true })
          .returning()
        await tx.update(works).set({ defaultBranchId: b!.id }).where(eq(works.id, w!.id))
        const made: { documentId: string; snapshotId: string }[] = []
        for (const p of pubs) {
          const [d] = await tx
            .insert(documents)
            .values({ workId: w!.id, kind: 'chapter', schemaVersion: SCHEMA_VERSION })
            .returning()
          await tx.insert(chapters).values({
            workId: w!.id,
            branchId: b!.id,
            documentId: d!.id,
            title: p.title,
            position: p.position,
          })
          made.push({ documentId: d!.id, snapshotId: p.snapshotId })
        }
        await recordActivity(tx, {
          workId: w!.id,
          actorId: me,
          type: 'work.created',
          subjectType: 'work',
          subjectId: w!.id,
          data: { retelling: source.id },
        })
        return { work: w!, made }
      })
      try {
        for (const m of made)
          await collab.forkSnapshot({
            snapshotId: m.snapshotId,
            targetDocumentId: m.documentId,
            workId: work.id,
            fromWorkId: source.id,
          })
      } catch (err) {
        req.log.error({ err }, 'retelling copy failed')
        throw new HttpProblem(
          503,
          PROBLEM.internal,
          'Couldn’t copy the book just now. Try again in a moment.',
        )
      }
      return reply.status(201).send({ id: work.id })
    },
  )
}

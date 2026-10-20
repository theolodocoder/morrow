import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod'
import { z } from 'zod'
import { and, desc, eq } from 'drizzle-orm'
import { CreateSnapshotInput, Snapshot } from '@morrow/contracts'
import { documentSnapshots, user, type Database } from '@morrow/db'
import type { CollabGateway } from '../collab-gateway.ts'
import { requireDocument } from '../access.ts'
import { notFound } from '../problems.ts'

const DocParams = z.object({ documentId: z.uuid() })
const toSnapshot = (
  s: typeof documentSnapshots.$inferSelect,
  createdByName: string | null = null,
): Snapshot => ({
  createdByName,
  id: s.id,
  documentId: s.documentId,
  reason: s.reason,
  label: s.label,
  wordCount: s.wordCount,
  createdBy: s.createdBy,
  createdAt: s.createdAt.toISOString(),
})

export const snapshotRoutes: FastifyPluginAsyncZod<{ db: Database; collab: CollabGateway }> = async (
  app,
  { db, collab },
) => {
  app.get(
    '/documents/:documentId/snapshots',
    { schema: { params: DocParams, response: { 200: z.object({ items: z.array(Snapshot) }) } } },
    async (req) => {
      const access = await requireDocument(db, req.params.documentId, req.user!.id, 'work.read')
      const rows = await db
        .select({ s: documentSnapshots, name: user.name })
        .from(documentSnapshots)
        .leftJoin(user, eq(user.id, documentSnapshots.createdBy))
        .where(
          and(
            eq(documentSnapshots.workId, access.work.id),
            eq(documentSnapshots.documentId, req.params.documentId),
          ),
        )
        .orderBy(desc(documentSnapshots.createdAt))
        .limit(100)
      return { items: rows.map((r) => toSnapshot(r.s, r.name)) }
    },
  )

  // "Save version": collab flushes the live document and records it (only collab reads live content, P-013).
  app.post(
    '/documents/:documentId/snapshots',
    { schema: { params: DocParams, body: CreateSnapshotInput, response: { 201: Snapshot } } },
    async (req, reply) => {
      const userId = req.user!.id
      const access = await requireDocument(db, req.params.documentId, userId, 'document.write')
      const snapshot = await collab.createSnapshot({
        documentId: req.params.documentId,
        workId: access.work.id,
        label: req.body.label ?? null,
        createdBy: userId,
      })
      return reply.status(201).send(snapshot)
    },
  )

  app.get(
    '/snapshots/:snapshotId',
    {
      schema: {
        params: z.object({ snapshotId: z.uuid() }),
        response: { 200: Snapshot.extend({ content: z.unknown() }) },
      },
    },
    async (req) => {
      const [s] = await db
        .select()
        .from(documentSnapshots)
        .where(eq(documentSnapshots.id, req.params.snapshotId))
      if (!s) throw notFound()
      await requireDocument(db, s.documentId, req.user!.id, 'work.read')
      return { ...toSnapshot(s), content: s.contentJson }
    },
  )
}

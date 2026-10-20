import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod'
import { CollabTicket, CollabTicketInput } from '@morrow/contracts'
import { mintTicket } from '@morrow/domain/signing'
import { SCHEMA_VERSION } from '@morrow/editor'
import type { Database } from '@morrow/db'
import type { ApiEnv } from '../env.ts'
import { requireDocument } from '../access.ts'

export const collabRoutes: FastifyPluginAsyncZod<{ db: Database; env: ApiEnv }> = async (
  app,
  { db, env },
) => {
  app.post(
    '/collab/tickets',
    {
      schema: { body: CollabTicketInput, response: { 200: CollabTicket } },
      config: { rateLimit: { max: 120, timeWindow: '1 minute' } },
    },
    async (req) => {
      const userId = req.user!.id
      const access = await requireDocument(db, req.body.documentId, userId, 'work.read')
      // A suspended account reads but never writes (FR-031); collab enforces the same on connect.
      const mode: 'edit' | 'read' = access.canWrite && req.user!.restriction !== 'suspended' ? 'edit' : 'read'
      const { ticket, expiresAt } = mintTicket(env.TICKET_SECRET, {
        userId,
        documentId: req.body.documentId,
        mode,
      })
      return {
        ticket,
        expiresAt: expiresAt.toISOString(),
        collabUrl: env.COLLAB_PUBLIC_URL,
        mode,
        schemaVersion: SCHEMA_VERSION,
      }
    },
  )
}

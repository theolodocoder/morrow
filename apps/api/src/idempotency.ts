import { createHash } from 'node:crypto'
import { and, eq } from 'drizzle-orm'
import type { FastifyReply, FastifyRequest } from 'fastify'
import { idempotencyKeys, type Database } from '@morrow/db'
import { conflict } from './problems.ts'

/**
 * Run a create operation at most once per (user, Idempotency-Key). A retry with the same key and body
 * returns the stored response; the same key with a different body is a client bug and gets 409.
 */
export async function idempotent<T>(
  db: Database,
  req: FastifyRequest,
  reply: FastifyReply,
  status: number,
  run: () => Promise<T>,
): Promise<T> {
  const key = req.headers['idempotency-key']
  if (typeof key !== 'string' || !key) return run()
  const userId = req.user!.id
  const hash = createHash('sha256')
    .update(JSON.stringify(req.body ?? null))
    .digest('hex')
  const [prior] = await db
    .select()
    .from(idempotencyKeys)
    .where(and(eq(idempotencyKeys.userId, userId), eq(idempotencyKeys.key, key)))
  if (prior) {
    if (prior.requestHash !== hash || prior.route !== req.routeOptions.url)
      throw conflict('Idempotency-Key reused with a different request.')
    reply.header('idempotent-replay', 'true')
    return prior.body as T
  }
  const result = await run()
  await db
    .insert(idempotencyKeys)
    .values({
      userId,
      key,
      route: req.routeOptions.url ?? req.url,
      requestHash: hash,
      status,
      body: result as object,
    })
    .onConflictDoNothing()
  return result
}

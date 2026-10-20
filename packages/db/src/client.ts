import { drizzle } from 'drizzle-orm/node-postgres'
import pg from 'pg'
import * as schema from './schema.ts'

export function createDb(connectionString: string, options: { max?: number } = {}) {
  const pool = new pg.Pool({ connectionString, max: options.max ?? 10 })
  return { db: drizzle(pool, { schema }), pool }
}
export type Database = ReturnType<typeof createDb>['db']
export type Transaction = Parameters<Parameters<Database['transaction']>[0]>[0]

/**
 * Postgres unique-constraint violation (23505). Drizzle wraps driver errors, so the code may sit on `cause`;
 * checking only `err.code` silently never matches (found in Phase 1 onboarding, which returned 500 instead of 409).
 */
export function isUniqueViolation(err: unknown): boolean {
  for (
    let e = err as { code?: unknown; cause?: unknown } | undefined, depth = 0;
    e && depth < 4;
    e = e.cause as typeof e, depth++
  )
    if (e.code === '23505') return true
  return false
}

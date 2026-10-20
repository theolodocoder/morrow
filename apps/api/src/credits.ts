import { and, eq, lt, ne, sql } from 'drizzle-orm'
import { editSessions, proposals, type Database } from '@morrow/db'

/** Recorded edits a member needs on a chapter to be its co-writer, so a typo fix doesn't earn a credit. */
const COWRITER_MIN_EDITS = 20

/**
 * Who earned credit on one chapter up to `before` (the moment it was published). Built only from trusted
 * server-side edit sessions and accepted proposals; Yjs client ids are never used, and word-level authorship
 * isn't recorded. The owner is the author and is never listed here.
 */
export async function chapterCredits(
  db: Database,
  q: { workId: string; ownerId: string; chapterId: string; documentId: string; before: Date },
): Promise<{ userId: string; role: 'cowriter' | 'contributor' }[]> {
  const writers = await db
    .select({ userId: editSessions.userId })
    .from(editSessions)
    .where(
      and(
        eq(editSessions.workId, q.workId),
        eq(editSessions.documentId, q.documentId),
        lt(editSessions.startedAt, q.before),
        ne(editSessions.userId, q.ownerId),
      ),
    )
    .groupBy(editSessions.userId)
    .having(sql`sum(${editSessions.updateCount}) >= ${COWRITER_MIN_EDITS}`)
  const proposers = await db
    .selectDistinct({ userId: proposals.authorId })
    .from(proposals)
    .where(
      and(
        eq(proposals.workId, q.workId),
        eq(proposals.chapterId, q.chapterId),
        eq(proposals.status, 'accepted'),
        lt(proposals.decidedAt, q.before),
        ne(proposals.authorId, q.ownerId),
      ),
    )
  const cowriters = new Set(writers.map((w) => w.userId))
  return [
    ...[...cowriters].map((userId) => ({ userId, role: 'cowriter' as const })),
    ...proposers
      .filter((p) => !cowriters.has(p.userId))
      .map((p) => ({ userId: p.userId, role: 'contributor' as const })),
  ]
}

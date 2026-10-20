/**
 * Safety rules shared by every route (PRD FR-032): blocks, spam limits. Account restrictions are enforced centrally in
 * app.ts (API) and on connect (collab).
 */
import { and, eq, gt, or, sql } from 'drizzle-orm'
import { PROBLEM } from '@morrow/contracts'
import { blocks, comments, proposals, readerComments, type Database } from '@morrow/db'
import { HttpProblem } from './problems.ts'

/** Whether either has blocked the other. */
export async function blockedBetween(db: Database, a: string, b: string) {
  if (a === b) return false
  const [row] = await db
    .select({ x: blocks.blockerId })
    .from(blocks)
    .where(
      or(
        and(eq(blocks.blockerId, a), eq(blocks.blockedId, b)),
        and(eq(blocks.blockerId, b), eq(blocks.blockedId, a)),
      ),
    )
    .limit(1)
  return !!row
}

/** Everyone `userId` has blocked or been blocked by. */
export async function blockedSet(db: Database, userId: string) {
  const rows = await db
    .select({ blocker: blocks.blockerId, blocked: blocks.blockedId })
    .from(blocks)
    .where(or(eq(blocks.blockerId, userId), eq(blocks.blockedId, userId)))
  return new Set(rows.map((r) => (r.blocker === userId ? r.blocked : r.blocker)))
}

const MAX_LINKS = 3
const DUPLICATE_WINDOW = '10 minutes'

/**
 * Spam rules for comments and proposals (FR-032): few links per post, and no posting the same text again and again.
 * Deliberately simple and explainable; real-world tuning comes from the moderation queue.
 */
export async function spamCheck(
  db: Database,
  userId: string,
  body: string,
  kind: 'comment' | 'proposal' | 'reader_comment',
) {
  const links = body.match(/https?:\/\/|www\./gi)?.length ?? 0
  if (links > MAX_LINKS)
    throw new HttpProblem(
      422,
      PROBLEM.validation,
      `Too many links.`,
      `Keep it to ${MAX_LINKS} links or fewer.`,
    )
  const text = body.trim()
  if (text.length < 12) return // short replies ("Thanks!") repeat naturally
  const t = { comment: comments, proposal: proposals, reader_comment: readerComments }[kind]
  const table = t as typeof comments
  const author = t.authorId
  const field = t.body
  const [dup] = await db
    .select({ id: table.id })
    .from(table)
    .where(
      and(
        eq(author, userId),
        eq(field, text),
        gt(table.createdAt, sql`now() - ${DUPLICATE_WINDOW}::interval`),
      ),
    )
    .limit(1)
  if (dup)
    throw new HttpProblem(
      429,
      PROBLEM.rateLimited,
      'You just posted that.',
      'Posting the same text repeatedly isn’t allowed.',
    )
}

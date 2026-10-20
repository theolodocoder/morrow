/**
 * Access-scoped loading (architecture §11): every route and the collab service resolve a resource
 * together with the caller's relationship to it, then ask `can()` from @morrow/domain. Callers treat
 * "not found" and "not allowed" identically (404), so existence never leaks.
 */
import { and, desc, eq, gt, isNull, or, sql } from 'drizzle-orm'
import type { Database } from './client.ts'
import { accountRestrictions, branches, chapters, proposals, workMembers, works } from './schema.ts'

export interface WorkAccessRow {
  work: typeof works.$inferSelect
  role: (typeof workMembers.$inferSelect)['role'] | null
}

export async function loadWorkAccess(
  db: Database,
  workId: string,
  userId: string | null,
): Promise<WorkAccessRow | null> {
  const [row] = await db
    .select({ work: works, role: workMembers.role })
    .from(works)
    .leftJoin(workMembers, and(eq(workMembers.workId, works.id), eq(workMembers.userId, userId ?? '')))
    .where(and(eq(works.id, workId), isNull(works.deletedAt)))
  return row ?? null
}

export interface DocumentAccessRow extends WorkAccessRow {
  chapter: typeof chapters.$inferSelect
  branch: typeof branches.$inferSelect
  /** set when the document is a proposal's private workspace; `chapter` and `branch` are then its target */
  proposal?: Pick<typeof proposals.$inferSelect, 'id' | 'authorId' | 'status'>
}

/** Resolve a chapter document, or a proposal workspace, to its work, branch and the caller's role in one query. */
export async function loadDocumentAccess(
  db: Database,
  documentId: string,
  userId: string | null,
): Promise<DocumentAccessRow | null> {
  const [row] = await db
    .select({ work: works, role: workMembers.role, chapter: chapters, branch: branches })
    .from(chapters)
    .innerJoin(works, eq(works.id, chapters.workId))
    .innerJoin(branches, eq(branches.id, chapters.branchId))
    .leftJoin(workMembers, and(eq(workMembers.workId, works.id), eq(workMembers.userId, userId ?? '')))
    .where(and(eq(chapters.documentId, documentId), isNull(chapters.deletedAt), isNull(works.deletedAt)))
  if (row) return row
  const [ws] = await db
    .select({
      work: works,
      role: workMembers.role,
      chapter: chapters,
      branch: branches,
      proposal: { id: proposals.id, authorId: proposals.authorId, status: proposals.status },
    })
    .from(proposals)
    .innerJoin(chapters, eq(chapters.id, proposals.chapterId))
    .innerJoin(works, eq(works.id, proposals.workId))
    .innerJoin(branches, eq(branches.id, chapters.branchId))
    .leftJoin(workMembers, and(eq(workMembers.workId, works.id), eq(workMembers.userId, userId ?? '')))
    .where(and(eq(proposals.workspaceDocumentId, documentId), isNull(works.deletedAt)))
  return ws ?? null
}

/** Shape a loaded row into the context `can()` expects. */
export function toAccessContext(
  row: WorkAccessRow & {
    branch?: { createdBy: string; isDefault: boolean }
    chapter?: { collaborationMode: (typeof chapters.$inferSelect)['collaborationMode'] }
  },
) {
  return {
    work: {
      ownerId: row.work.ownerId,
      visibility: row.work.visibility,
      participation: row.work.participation,
      collaborationMode: row.work.collaborationMode,
      deleted: row.work.deletedAt !== null,
    },
    role: row.role,
    ...(row.branch ? { branch: { createdBy: row.branch.createdBy, isDefault: row.branch.isDefault } } : {}),
    // A chapter (section) can override the work's collaboration mode (FR-006).
    ...(row.chapter ? { section: { collaborationMode: row.chapter.collaborationMode } } : {}),
  }
}

/** The account's active restriction (FR-031/032), if any: suspended accounts are read-only, muted ones can't post. */
export async function loadRestriction(db: Database, userId: string): Promise<'suspended' | 'muted' | null> {
  const [r] = await db
    .select({ kind: accountRestrictions.kind })
    .from(accountRestrictions)
    .where(
      and(
        eq(accountRestrictions.userId, userId),
        isNull(accountRestrictions.liftedAt),
        or(isNull(accountRestrictions.until), gt(accountRestrictions.until, sql`now()`)),
      ),
    )
    // a suspension outranks a mute
    .orderBy(desc(sql`${accountRestrictions.kind} = 'suspended'`))
    .limit(1)
  return r?.kind ?? null
}

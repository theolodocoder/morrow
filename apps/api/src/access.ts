import { can, capabilitiesFor, documentMode, type Capability } from '@morrow/domain'
import { and, eq, isNull } from 'drizzle-orm'
import { branches, loadDocumentAccess, loadWorkAccess, toAccessContext, type Database } from '@morrow/db'
import { forbidden, notFound } from './problems.ts'

/**
 * Load a work through an access-scoped query and require a capability.
 * Callers who cannot even read it get 404 (no existence leak); readers lacking the capability get 403.
 */
export async function requireWork(db: Database, workId: string, userId: string, capability: Capability) {
  const row = await loadWorkAccess(db, workId, userId)
  if (!row) throw notFound()
  const ctx = toAccessContext(row)
  const actor = { userId }
  if (!can(actor, 'work.read', ctx)) throw notFound()
  if (!can(actor, capability, ctx)) throw forbidden()
  return { ...row, capabilities: capabilitiesFor(actor, ctx) }
}

export async function requireDocument(
  db: Database,
  documentId: string,
  userId: string,
  capability: Capability | 'document.write',
) {
  const row = await loadDocumentAccess(db, documentId, userId)
  if (!row) throw notFound()
  const ctx = toAccessContext(row)
  const actor = { userId }
  const mode = documentMode(actor, ctx, row)
  if (mode === 'none') throw notFound()
  // Writing means: document.edit on the default branch, branch.edit elsewhere, or authoring an open proposal.
  if (capability === 'document.write' && mode !== 'edit') throw forbidden()
  if (capability !== 'document.write' && capability !== 'work.read' && !can(actor, capability, ctx))
    throw forbidden()
  return { ...row, canWrite: mode === 'edit' }
}

/**
 * Load a branch with the caller's access and require a capability evaluated in that branch's context.
 * `branch.write` means: document.edit on the default branch, branch.edit elsewhere.
 */
export async function requireBranch(
  db: Database,
  branchId: string,
  userId: string,
  capability: Capability | 'branch.write',
) {
  const [b] = await db
    .select()
    .from(branches)
    .where(and(eq(branches.id, branchId), isNull(branches.archivedAt)))
  if (!b) throw notFound()
  const row = await loadWorkAccess(db, b.workId, userId)
  if (!row) throw notFound()
  const ctx = toAccessContext({ ...row, branch: { createdBy: b.createdBy, isDefault: b.isDefault } })
  const actor = { userId }
  if (!can(actor, 'work.read', ctx)) throw notFound()
  const needed: Capability =
    capability === 'branch.write' ? (b.isDefault ? 'document.edit' : 'branch.edit') : capability
  if (!can(actor, needed, ctx)) throw forbidden()
  return {
    ...row,
    branch: b,
    capabilities: capabilitiesFor(actor, ctx),
    canWrite: can(actor, b.isDefault ? 'document.edit' : 'branch.edit', ctx),
  }
}

/**
 * The single authorization policy (architecture §11, P-016, PRD §9). The API calls it on every route and the
 * collaboration service calls it on connect. The UI never decides access: it renders `capabilitiesFor`.
 * This module is pure: callers load the context through access-scoped queries.
 */

export const ROLES = ['owner', 'editor', 'collaborator', 'contributor', 'viewer'] as const
export type Role = (typeof ROLES)[number]

export const VISIBILITIES = ['private', 'unlisted', 'public'] as const
export type Visibility = (typeof VISIBILITIES)[number]

export const PARTICIPATION = ['none', 'propose', 'branch', 'propose_and_branch'] as const
export type Participation = (typeof PARTICIPATION)[number]

/**
 * PRD FR-013. Who may write the canonical text (the main branch) directly; everyone else with access proposes.
 * - direct:   editors and collaborators write directly
 * - mixed:    editors write directly; collaborators and contributors propose
 * - proposal: only the owner writes directly; everyone else proposes
 */
export const COLLABORATION_MODES = ['direct', 'mixed', 'proposal'] as const
export type CollaborationMode = (typeof COLLABORATION_MODES)[number]

export const CAPABILITIES = [
  'work.read', // drafts and live content
  'work.read_published',
  'document.edit', // the main branch's chapters, including chapter structure
  'branch.create',
  'branch.edit',
  'proposal.create',
  'proposal.review',
  // Feedback never changes the text, so every member may give it (FR-016/017, P-032); moderating it is owner/editor.
  'comment.create',
  'comment.moderate',
  'reaction.create',
  'work.publish',
  'work.manage_members',
  'work.manage_settings', // visibility, collaboration mode, participation, metadata
  'work.delete',
] as const
export type Capability = (typeof CAPABILITIES)[number]

export interface Actor {
  /** null for signed-out visitors */
  userId: string | null
  suspended?: boolean
}

export interface AccessContext {
  work: {
    ownerId: string
    visibility: Visibility
    participation: Participation
    collaborationMode?: CollaborationMode
    deleted?: boolean
  }
  /** the actor's membership role on this work, or null for non-members */
  role: Role | null
  /** set when the capability concerns a specific branch */
  branch?: { createdBy: string; isDefault: boolean }
  /** set when the capability concerns a specific section/chapter with its own collaboration setting (FR-006) */
  section?: { collaborationMode: CollaborationMode | null }
}

/** Capabilities that do not depend on the collaboration mode. `document.edit` is decided by `writesDirectly`. */
const BASE: Record<Role, ReadonlySet<Capability>> = {
  owner: new Set(CAPABILITIES),
  editor: new Set([
    'work.read',
    'work.read_published',
    'branch.create',
    'branch.edit',
    'proposal.create',
    'proposal.review',
    'comment.create',
    'comment.moderate',
    'reaction.create',
  ]),
  collaborator: new Set([
    'work.read',
    'work.read_published',
    'branch.create',
    'proposal.create',
    'comment.create',
    'reaction.create',
  ]),
  contributor: new Set([
    'work.read',
    'work.read_published',
    'branch.create',
    'proposal.create',
    'comment.create',
    'reaction.create',
  ]),
  viewer: new Set(['work.read', 'work.read_published', 'comment.create', 'reaction.create']),
}

const DIRECT_WRITERS: Record<CollaborationMode, ReadonlySet<Role>> = {
  direct: new Set(['owner', 'editor', 'collaborator']),
  mixed: new Set(['owner', 'editor']),
  proposal: new Set(['owner']),
}

/** The mode in force here: a section's own setting overrides the work's. */
export function effectiveMode(ctx: AccessContext): CollaborationMode {
  return ctx.section?.collaborationMode ?? ctx.work.collaborationMode ?? 'direct'
}

const allowsProposals = (p: Participation) => p === 'propose' || p === 'propose_and_branch'
const allowsBranches = (p: Participation) => p === 'branch' || p === 'propose_and_branch'

export function can(actor: Actor, capability: Capability, ctx: AccessContext): boolean {
  const { work } = ctx
  if (work.deleted) return false
  // The owner relationship is authoritative even if a membership row is missing or stale.
  const role: Role | null = actor.userId !== null && actor.userId === work.ownerId ? 'owner' : ctx.role
  const isPublished = work.visibility !== 'private'

  if (capability === 'work.read_published') return isPublished || role !== null
  if (actor.userId === null || actor.suspended) return false

  if (capability === 'document.edit') return role !== null && DIRECT_WRITERS[effectiveMode(ctx)].has(role)

  if (capability === 'branch.edit' && ctx.branch) {
    if (ctx.branch.isDefault) return can(actor, 'document.edit', ctx)
    // A creator keeps editing their own branch only while they may still create branches (e.g. not after a downgrade).
    if (ctx.branch.createdBy === actor.userId) return can(actor, 'branch.create', { work, role: ctx.role })
    return role === 'owner' || role === 'editor'
  }

  if (role !== null) return BASE[role].has(capability)

  // Non-members: only public works, and only what the owner's participation policy opens up.
  if (work.visibility !== 'public') return false
  if (capability === 'proposal.create') return allowsProposals(work.participation)
  if (capability === 'branch.create') return allowsBranches(work.participation)
  return false
}

export function capabilitiesFor(actor: Actor, ctx: AccessContext): Capability[] {
  return CAPABILITIES.filter((c) => can(actor, c, ctx))
}

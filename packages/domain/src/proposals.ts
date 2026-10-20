/**
 * Proposals (PRD FR-014/015, architecture §9): the lifecycle, who may do what, and block-level classification.
 * Pure: no I/O, no Yjs. Block signatures are computed by the collaboration service and passed in.
 */
import { can, type AccessContext, type Actor } from './access.ts'

// ---- Lifecycle ----
export const PROPOSAL_STATUSES = [
  'draft',
  'submitted',
  'under_review',
  'changes_requested', // PRD: "requires revision"
  'accepted',
  'rejected',
  'withdrawn',
  'superseded',
] as const
export type ProposalStatus = (typeof PROPOSAL_STATUSES)[number]

/** PRD FR-014 contribution types. `edit` changes a chapter; the others are reviewed notes that credit the author. */
export const PROPOSAL_KINDS = ['edit', 'outline', 'character', 'research', 'feedback'] as const
export type ProposalKind = (typeof PROPOSAL_KINDS)[number]

export type ProposalAction =
  | 'edit' // change content, title or explanation
  | 'submit'
  | 'start_review'
  | 'request_changes'
  | 'accept'
  | 'reject'
  | 'withdraw'
  | 'refresh' // bring the latest chapter text into the proposal (reconciliation)
  | 'comment'

const OPEN: ReadonlySet<ProposalStatus> = new Set(['draft', 'submitted', 'under_review', 'changes_requested'])
const IN_REVIEW: ReadonlySet<ProposalStatus> = new Set(['submitted', 'under_review'])
/** The author may change the proposal only before submitting, or after a reviewer asked for changes. */
const AUTHOR_EDITABLE: ReadonlySet<ProposalStatus> = new Set(['draft', 'changes_requested'])

export const isOpen = (s: ProposalStatus) => OPEN.has(s)

/** The status an action leads to, or null when the action is not valid from `from`. */
export function nextStatus(from: ProposalStatus, action: ProposalAction): ProposalStatus | null {
  switch (action) {
    case 'submit':
      return AUTHOR_EDITABLE.has(from) ? 'submitted' : null
    case 'start_review':
      return from === 'submitted' ? 'under_review' : null
    case 'request_changes':
      return IN_REVIEW.has(from) ? 'changes_requested' : null
    case 'accept':
      return IN_REVIEW.has(from) ? 'accepted' : null
    case 'reject':
      return IN_REVIEW.has(from) ? 'rejected' : null
    case 'withdraw':
      return OPEN.has(from) ? 'withdrawn' : null
    case 'edit':
    case 'refresh':
      return AUTHOR_EDITABLE.has(from) ? from : null
    case 'comment':
      // Discussion happens while it's open; a decided proposal is a closed record (auditable as it stood).
      return OPEN.has(from) && from !== 'draft' ? from : null
  }
}

export interface ProposalFacts {
  authorId: string
  status: ProposalStatus
}

const AUTHOR_ACTIONS: ReadonlySet<ProposalAction> = new Set([
  'edit',
  'submit',
  'withdraw',
  'refresh',
  'comment',
])
const REVIEWER_ACTIONS: ReadonlySet<ProposalAction> = new Set([
  'start_review',
  'request_changes',
  'accept',
  'reject',
  'comment',
])

/** Can this actor see the proposal at all? Authors always; reviewers once it has been submitted. */
export function canSeeProposal(actor: Actor, ctx: AccessContext, p: ProposalFacts): boolean {
  // Authors always see their own, including outside contributors to a published work (public participation, M6),
  // who can read only what's published.
  if (actor.userId === p.authorId)
    return can(actor, 'work.read', ctx) || can(actor, 'work.read_published', ctx)
  if (!can(actor, 'work.read', ctx)) return false
  return p.status !== 'draft' && can(actor, 'proposal.review', ctx)
}

/**
 * Whether this person may see the live, unpublished chapter. Outside contributors may not: they work from the
 * published version, and nothing about a proposal (comparison with the chapter, "update from the chapter") may show
 * them text the writer hasn't published.
 */
export const seesDrafts = (actor: Actor, ctx: AccessContext) => can(actor, 'work.read', ctx)

/** Whether `actor` may take `action` now: the right relationship, the right capability, and a valid transition. */
export function canActOnProposal(
  actor: Actor,
  ctx: AccessContext,
  p: ProposalFacts,
  action: ProposalAction,
): boolean {
  if (!canSeeProposal(actor, ctx, p) || nextStatus(p.status, action) === null) return false
  // "Update with the latest chapter text" would pour the unpublished draft into the proposal.
  if (action === 'refresh' && !seesDrafts(actor, ctx)) return false
  const isAuthor = actor.userId === p.authorId
  // Authors keep their own actions only while they may still propose (not after a downgrade to reader).
  if (isAuthor && AUTHOR_ACTIONS.has(action) && (action === 'withdraw' || can(actor, 'proposal.create', ctx)))
    return true
  // Nobody reviews their own proposal: a reviewer who wants a change made can make it directly.
  return !isAuthor && REVIEWER_ACTIONS.has(action) && can(actor, 'proposal.review', ctx)
}

export function proposalActions(actor: Actor, ctx: AccessContext, p: ProposalFacts): ProposalAction[] {
  const all: ProposalAction[] = [
    'edit',
    'submit',
    'start_review',
    'request_changes',
    'accept',
    'reject',
    'withdraw',
    'refresh',
    'comment',
  ]
  return all.filter((a) => canActOnProposal(actor, ctx, p, a))
}

/** Live access to a proposal's private workspace document. */
export function workspaceMode(actor: Actor, ctx: AccessContext, p: ProposalFacts): 'edit' | 'read' | 'none' {
  if (!canSeeProposal(actor, ctx, p)) return 'none'
  return canActOnProposal(actor, ctx, p, 'edit') ? 'edit' : 'read'
}

/**
 * Live access to any document: a chapter (by branch and collaboration mode) or a proposal workspace.
 * Used by the API when it mints collab tickets and by collab on connect and on every periodic re-check.
 */
export function documentMode(
  actor: Actor,
  ctx: AccessContext,
  doc: { branch: { isDefault: boolean }; proposal?: ProposalFacts },
): 'edit' | 'read' | 'none' {
  if (doc.proposal) return workspaceMode(actor, ctx, doc.proposal)
  if (!can(actor, 'work.read', ctx)) return 'none'
  return can(actor, doc.branch.isDefault ? 'document.edit' : 'branch.edit', ctx) ? 'edit' : 'read'
}

// ---- Classification (architecture §9, spike S2) ----
/**
 * A top-level block. `sig` is its CRDT identity (the Yjs items that make up its visible content). Two blocks with
 * equal content can still differ in `sig`, e.g. text deleted and retyped, and concurrent edits anchor to items,
 * so classification compares `sig`, never content (S2 finding 1).
 */
export interface Block {
  id: string
  sig: string
}

export type Classification =
  { kind: 'fast-forward' } | { kind: 'clean' } | { kind: 'conflict'; blockIds: string[]; gaps: string[] }

export interface ChangeSet {
  /** present in base and other, but changed or moved */
  modified: Set<string>
  deleted: Set<string>
  /** where new blocks went, keyed "prevBaseId|nextBaseId" by the stable base blocks around them (^ and $ for edges) */
  insertGaps: Set<string>
  inserted: Set<string>
}

/** Longest common subsequence of ids, used to tell moved blocks from stable ones. */
function lcs(a: string[], b: string[]): Set<string> {
  const dp = Array.from({ length: a.length + 1 }, () => new Array<number>(b.length + 1).fill(0))
  for (let i = a.length - 1; i >= 0; i--)
    for (let j = b.length - 1; j >= 0; j--)
      dp[i]![j] = a[i] === b[j] ? dp[i + 1]![j + 1]! + 1 : Math.max(dp[i + 1]![j]!, dp[i]![j + 1]!)
  const out = new Set<string>()
  let i = 0
  let j = 0
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      out.add(a[i]!)
      i++
      j++
    } else if (dp[i + 1]![j]! >= dp[i]![j + 1]!) i++
    else j++
  }
  return out
}

export function diffBlocks(base: Block[], other: Block[]): ChangeSet {
  const baseById = new Map(base.map((b) => [b.id, b]))
  const otherIds = new Set(other.map((b) => b.id))
  const common = other.filter((b) => baseById.has(b.id)).map((b) => b.id)
  const stable = lcs(
    base.map((b) => b.id).filter((id) => otherIds.has(id)),
    common,
  )
  const cs: ChangeSet = {
    modified: new Set(),
    deleted: new Set(),
    insertGaps: new Set(),
    inserted: new Set(),
  }
  for (const b of base) if (!otherIds.has(b.id)) cs.deleted.add(b.id)
  for (const b of other) {
    const orig = baseById.get(b.id)
    if (orig && (orig.sig !== b.sig || !stable.has(b.id))) cs.modified.add(b.id)
  }
  let prev = '^'
  const pending: string[] = []
  const flush = (next: string) => {
    if (pending.length) {
      cs.insertGaps.add(`${prev}|${next}`)
      pending.length = 0
    }
  }
  for (const b of other) {
    if (baseById.has(b.id) && stable.has(b.id)) {
      flush(b.id)
      prev = b.id
    } else {
      pending.push(b.id)
      if (!baseById.has(b.id)) cs.inserted.add(b.id)
    }
  }
  flush('$')
  return cs
}

const gapEnds = (g: string) => g.split('|') as [string, string]
const hasDuplicateIds = (bs: Block[]) => new Set(bs.map((b) => b.id)).size !== bs.length

/**
 * fast-forward: the chapter hasn't changed since the proposal's base, so it applies as is.
 * clean: both sides changed, but never the same blocks or the same places, so the CRDT merge is safe.
 * conflict: overlapping changes. Never applied automatically: a character-level merge would interleave two
 * rewrites of one sentence into nonsense (S2).
 */
export function classify(base: Block[], head: Block[], proposal: Block[]): Classification {
  if ([base, head, proposal].some(hasDuplicateIds))
    return { kind: 'conflict', blockIds: [], gaps: ['duplicate-block-ids'] }
  const h = diffBlocks(base, head)
  const p = diffBlocks(base, proposal)
  if (h.modified.size + h.deleted.size + h.insertGaps.size === 0) return { kind: 'fast-forward' }

  const touchedH = new Set([...h.modified, ...h.deleted])
  const blockIds = [...p.modified, ...p.deleted].filter((id) => touchedH.has(id))
  // Both sides inserted in the same place: the order is ambiguous.
  const gaps = [...p.insertGaps].filter((g) => h.insertGaps.has(g))
  // An insertion next to a block the other side deleted or rewrote has lost or changed its context.
  for (const g of p.insertGaps)
    for (const end of gapEnds(g)) if (h.deleted.has(end) || h.modified.has(end)) gaps.push(g)
  for (const g of h.insertGaps)
    for (const end of gapEnds(g)) if (p.deleted.has(end) || p.modified.has(end)) gaps.push(g)
  if (blockIds.length || gaps.length) return { kind: 'conflict', blockIds, gaps: [...new Set(gaps)] }
  return { kind: 'clean' }
}

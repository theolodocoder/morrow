/** The API's only way to touch document content (P-013): signed calls to collab's internal HTTP API. */
import { signInternal, INTERNAL_SIGNATURE_HEADER } from '@morrow/domain/signing'
import type { Snapshot } from '@morrow/contracts'

export interface CollabGateway {
  createSnapshot(input: {
    documentId: string
    workId: string
    label: string | null
    createdBy: string
    reason?: 'manual' | 'publish'
  }): Promise<Snapshot>
  /**
   * Close a user's live connections on a work so they reconnect at their current role (or not at all).
   * Best effort: if it fails, collab's periodic access re-check closes them within its interval.
   */
  revokeAccess(input: { workId: string; userId: string; documentId?: string }): Promise<void>
  /** Copy a chapter's live state into a new document, preserving Yjs lineage (architecture §10). Idempotent. */
  forkDocument(input: {
    sourceDocumentId: string
    targetDocumentId: string
    workId: string
    createdBy: string
    /** proposals record their base as `proposal_base` */
    reason?: 'branch_fork' | 'proposal_base'
  }): Promise<{ forkSnapshotId: string | null }>
  /** Start a document from a stored snapshot (a published version), keeping its Yjs lineage. */
  /** `fromWorkId`: the snapshot's own work, when copying a public-domain classic into a retelling (P-063) */
  forkSnapshot(input: {
    snapshotId: string
    targetDocumentId: string
    workId: string
    fromWorkId?: string
  }): Promise<void>
  /** Restore a snapshot as a forward change; returns the snapshot of what was replaced. */
  restoreDocument(input: {
    documentId: string
    snapshotId: string
    workId: string
    createdBy: string
  }): Promise<{ preRestoreSnapshotId: string | null }>
  /** A document's text right now, from collab's live copy (projections lag by the store debounce). */
  liveContent(input: { documentId: string; workId: string; userId: string }): Promise<{ content: unknown }>
  /** Tell readers of a document that its comments or reactions changed. Best effort. */
  notifyFeedback(input: { documentId: string; what: 'comments' | 'reactions' }): Promise<void>
  /** Proposal engine (architecture §9). `classify` compares base, live chapter and workspace. */
  classifyProposal(input: ProposalEngineInput): Promise<{
    classification: ProposalClassificationResult
    base: unknown
    chapter: unknown
    proposal: unknown
  }>
  /** Apply unless it conflicts. Idempotent per proposal id. */
  applyProposal(input: ProposalEngineInput & { resolve?: 'use_proposal' }): Promise<
    | {
        ok: true
        appliedSnapshotId: string | null
        workspaceSnapshotId: string | null
        alreadyApplied: boolean
      }
    | { ok: false; classification: ProposalClassificationResult }
  >
  /** Merge the chapter's newer text into the workspace; returns the new base and contested blocks. */
  refreshProposal(input: ProposalEngineInput): Promise<{
    baseSnapshotId: string
    reference: { blockId: string; chapter: unknown; proposal: unknown }[]
  }>
}

export interface ProposalEngineInput {
  proposalId: string
  workId: string
  targetDocumentId: string
  workspaceDocumentId: string
  baseSnapshotId: string
  userId: string
}
export type ProposalClassificationResult =
  { kind: 'fast-forward' } | { kind: 'clean' } | { kind: 'conflict'; blockIds: string[]; gaps: string[] }

export function httpCollabGateway(baseUrl: string, secret: string, timeoutMs = 5000): CollabGateway {
  async function post<T>(path: string, payload: unknown, accept409 = false): Promise<T> {
    const body = JSON.stringify(payload)
    const res = await fetch(new URL(path, baseUrl), {
      method: 'POST',
      body,
      signal: AbortSignal.timeout(timeoutMs),
      headers: {
        'content-type': 'application/json',
        [INTERNAL_SIGNATURE_HEADER]: signInternal(secret, 'POST', path, body),
      },
    })
    if (!res.ok && !(accept409 && res.status === 409))
      throw new Error(`collab ${path} responded ${res.status}`)
    return (await res.json()) as T
  }
  return {
    createSnapshot: ({ documentId, ...rest }) => post(`/internal/documents/${documentId}/snapshots`, rest),
    revokeAccess: async (input) => {
      await post('/internal/access/revoke', input)
    },
    forkDocument: ({ sourceDocumentId, ...rest }) =>
      post(`/internal/documents/${sourceDocumentId}/fork`, rest),
    restoreDocument: ({ documentId, ...rest }) => post(`/internal/documents/${documentId}/restore`, rest),
    forkSnapshot: async ({ snapshotId, ...rest }) => {
      await post(`/internal/snapshots/${snapshotId}/fork`, rest)
    },
    liveContent: ({ documentId, ...rest }) => post(`/internal/documents/${documentId}/content`, rest),
    notifyFeedback: async ({ documentId, what }) => {
      await post(`/internal/documents/${documentId}/feedback`, { what })
    },
    classifyProposal: (input) => post('/internal/proposals/classify', input),
    applyProposal: async (input) => {
      const r = await post<{
        appliedSnapshotId?: string | null
        workspaceSnapshotId?: string | null
        alreadyApplied?: boolean
        classification?: ProposalClassificationResult
      }>('/internal/proposals/apply', input, true)
      return r.classification && r.alreadyApplied === undefined
        ? { ok: false, classification: r.classification }
        : {
            ok: true,
            appliedSnapshotId: r.appliedSnapshotId ?? null,
            workspaceSnapshotId: r.workspaceSnapshotId ?? null,
            alreadyApplied: r.alreadyApplied ?? false,
          }
    },
    refreshProposal: (input) => post('/internal/proposals/refresh', input),
  }
}

/**
 * DocumentStore (P-025): the only path between collab and document storage, so storage can later move
 * to an append log or shards without touching anything else (architecture §20, stage A here).
 */
import * as Y from 'yjs'
import { createHash } from 'node:crypto'
import { eq, sql } from 'drizzle-orm'
import { documentProjections, documentSnapshots, documentStates, type Database } from '@morrow/db'
import { project } from '@morrow/editor/server'

/** Re-encode through a gc'd doc when stored state grows this far past its last compacted size (spike S1). */
const COMPACT_RATIO = 1.3

const EMPTY = Y.encodeStateAsUpdate(new Y.Doc())

export interface StoreResult {
  revision: number
  byteSize: number
  compacted: boolean
  state: Uint8Array
}

export function createDocumentStore(db: Database) {
  return {
    async load(documentId: string): Promise<Uint8Array | null> {
      const [row] = await db
        .select({ state: documentStates.state })
        .from(documentStates)
        .where(eq(documentStates.documentId, documentId))
      return row?.state ?? null
    },

    /**
     * Merge-on-write: a stale or concurrent writer can never drop another writer's updates
     * (spike S1: plain overwrite lost 20/40 paragraphs with two writers; merge kept 40/40).
     */
    async store(documentId: string, workId: string, incoming: Uint8Array): Promise<StoreResult> {
      return db.transaction(async (tx) => {
        await tx
          .insert(documentStates)
          .values({
            documentId,
            workId,
            state: EMPTY,
            stateVector: Y.encodeStateVectorFromUpdate(EMPTY),
            revision: 0,
            byteSize: EMPTY.byteLength,
            compactedSize: EMPTY.byteLength,
          })
          .onConflictDoNothing()
        const [row] = await tx
          .select()
          .from(documentStates)
          .where(eq(documentStates.documentId, documentId))
          .for('update')
        let state = Y.mergeUpdates([row!.state, incoming])
        let compacted = false
        if (state.byteLength > Math.max(row!.compactedSize, 1024) * COMPACT_RATIO) {
          const doc = new Y.Doc({ gc: true })
          Y.applyUpdate(doc, state)
          state = Y.encodeStateAsUpdate(doc)
          doc.destroy()
          compacted = true
        }
        const revision = row!.revision + 1
        await tx
          .update(documentStates)
          .set({
            state,
            stateVector: Y.encodeStateVectorFromUpdate(state),
            revision,
            byteSize: state.byteLength,
            ...(compacted ? { compactedSize: state.byteLength } : {}),
            updatedAt: sql`now()`,
          })
          .where(eq(documentStates.documentId, documentId))
        return { revision, byteSize: state.byteLength, compacted, state }
      })
    },

    /** Derived read model; never authoritative (P-011). Older revisions never overwrite newer ones. */
    async writeProjection(documentId: string, workId: string, doc: Y.Doc, revision: number) {
      const p = project(doc)
      await db
        .insert(documentProjections)
        .values({
          documentId,
          workId,
          contentJson: p.contentJson,
          plainText: p.plainText,
          wordCount: p.wordCount,
          sourceRevision: revision,
        })
        .onConflictDoUpdate({
          target: documentProjections.documentId,
          set: {
            contentJson: p.contentJson,
            plainText: p.plainText,
            wordCount: p.wordCount,
            sourceRevision: revision,
            projectedAt: sql`now()`,
          },
          where: sql`${documentProjections.sourceRevision} < ${revision}`,
        })
      return p
    },

    async snapshot(
      documentId: string,
      workId: string,
      doc: Y.Doc,
      reason:
        'auto' | 'manual' | 'branch_fork' | 'pre_restore' | 'publish' | 'proposal_base' | 'proposal_applied',
      options: { label?: string | null; createdBy?: string | null } = {},
    ) {
      const p = project(doc)
      const contentHash = createHash('sha256').update(JSON.stringify(p.contentJson)).digest('hex')
      const state = Y.encodeStateAsUpdate(doc)
      return db.transaction(async (tx) => {
        // One snapshot at a time per document, across collab instances: concurrent callers would otherwise all
        // compare against the same latest snapshot and each record a duplicate (load test R3: 56 from one room).
        await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${documentId}, 0))`)
        const [last] = await tx
          .select({ contentHash: documentSnapshots.contentHash })
          .from(documentSnapshots)
          .where(eq(documentSnapshots.documentId, documentId))
          .orderBy(sql`${documentSnapshots.createdAt} desc`)
          .limit(1)
        // Automatic snapshots skip unchanged content; a writer's explicit "save version" always records.
        if (reason === 'auto' && last?.contentHash === contentHash) return null
        const [row] = await tx
          .insert(documentSnapshots)
          .values({
            documentId,
            workId,
            state,
            contentJson: p.contentJson,
            contentHash,
            wordCount: p.wordCount,
            reason,
            label: options.label ?? null,
            createdBy: options.createdBy ?? null,
            // Insert time, not transaction start (spent waiting for the lock): "latest" must follow lock order.
            createdAt: sql`clock_timestamp()`,
          })
          .returning()
        return row!
      })
    },
  }
}
export type DocumentStore = ReturnType<typeof createDocumentStore>

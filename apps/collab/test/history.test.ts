import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { and, eq } from 'drizzle-orm'
import * as Y from 'yjs'
import {
  branches,
  chapters,
  createDb,
  documentProjections,
  documentSnapshots,
  documentStates,
  documents,
} from '@morrow/db'
import { signInternal, INTERNAL_SIGNATURE_HEADER } from '@morrow/domain/signing'
import { SCHEMA_VERSION } from '@morrow/editor'
import { startCollab } from '../src/server.ts'
import { silentLogger } from '../src/logger.ts'
import { connect, env, freshDatabase, port, seedChapter, url, waitFor, writeParagraph } from './setup.ts'

let db: ReturnType<typeof createDb>
const servers: { destroy(): Promise<void> }[] = []
const clients: { close(): void }[] = []
beforeAll(async () => {
  await freshDatabase('history')
  db = createDb(url('history'))
})
afterEach(async () => {
  clients.splice(0).forEach((c) => c.close())
  await Promise.all(servers.splice(0).map((s) => s.destroy()))
})
afterAll(() => db.pool.end())

async function start() {
  const p = port()
  servers.push(await startCollab(env(p, { DATABASE_URL: url('history') }), db.db, silentLogger))
  return p
}
const track = <T extends { close(): void }>(c: T) => {
  clients.push(c)
  return c
}
const internal = (p: number, path: string, payload: unknown) => {
  const body = JSON.stringify(payload)
  return fetch(`http://127.0.0.1:${p}${path}`, {
    method: 'POST',
    body,
    headers: { [INTERNAL_SIGNATURE_HEADER]: signInternal('i'.repeat(40), 'POST', path, body) },
  })
}
const projection = async (documentId: string) =>
  (await db.db.select().from(documentProjections).where(eq(documentProjections.documentId, documentId)))[0]
const text = (doc: Y.Doc) => doc.getXmlFragment('default').toString()

/** A second branch with an empty chapter document to fork into. */
async function branchChapter(workId: string, owner: string, originChapterDoc: string) {
  const [origin] = await db.db.select().from(chapters).where(eq(chapters.documentId, originChapterDoc))
  const [b] = await db.db
    .insert(branches)
    .values({
      workId,
      name: 'The Lighthouse Ending',
      slug: 'lighthouse',
      createdBy: owner,
      parentBranchId: origin!.branchId,
    })
    .returning()
  const [d] = await db.db
    .insert(documents)
    .values({ workId, kind: 'chapter', schemaVersion: SCHEMA_VERSION })
    .returning()
  await db.db.insert(chapters).values({
    workId,
    branchId: b!.id,
    documentId: d!.id,
    title: origin!.title,
    position: origin!.position,
    originChapterId: origin!.id,
  })
  return d!.id
}

describe('fork (branch creation)', () => {
  it('copies content, keeps lineage, and is isolated from the source', async () => {
    const p = await start()
    const s = await seedChapter(db.db)
    const a = track(connect(p, s.documentId, s.users.owner!))
    await waitFor(() => a.provider.isSynced)
    writeParagraph(a.doc, 'She stood at the gate.')
    await waitFor(async () => (await projection(s.documentId))?.wordCount === 5)
    const target = await branchChapter(s.workId, s.users.owner!, s.documentId)

    const res = await internal(p, `/internal/documents/${s.documentId}/fork`, {
      targetDocumentId: target,
      workId: s.workId,
      createdBy: s.users.owner,
    })
    expect(res.status).toBe(200)
    expect(((await res.json()) as { forkSnapshotId: string }).forkSnapshotId).toBeTruthy()
    expect((await projection(target))!.plainText).toBe('She stood at the gate.')

    // Lineage: the copy's state vector covers every client clock in the source (a later merge stays possible).
    const [src] = await db.db.select().from(documentStates).where(eq(documentStates.documentId, s.documentId))
    const [dst] = await db.db.select().from(documentStates).where(eq(documentStates.documentId, target))
    const sv = (u: Uint8Array) => Y.decodeStateVector(Y.encodeStateVectorFromUpdate(u))
    for (const [client, clock] of sv(src!.state))
      expect(sv(dst!.state).get(client) ?? 0).toBeGreaterThanOrEqual(clock)

    // Isolation: writing in the branch never touches the source.
    const b = track(connect(p, target, s.users.owner!))
    await waitFor(() => b.provider.isSynced)
    expect(text(b.doc)).toContain('She stood at the gate.')
    writeParagraph(b.doc, 'The lighthouse keeper waved.')
    await waitFor(async () => (await projection(target))!.plainText.includes('lighthouse'))
    await new Promise((r) => setTimeout(r, 300))
    expect(text(a.doc)).not.toContain('lighthouse')
    expect((await projection(s.documentId))!.plainText).toBe('She stood at the gate.')
  })

  it('is idempotent: forking twice does not duplicate content', async () => {
    const p = await start()
    const s = await seedChapter(db.db)
    const a = track(connect(p, s.documentId, s.users.owner!))
    await waitFor(() => a.provider.isSynced)
    writeParagraph(a.doc, 'Once.')
    await waitFor(async () => (await projection(s.documentId))?.wordCount === 1)
    const target = await branchChapter(s.workId, s.users.owner!, s.documentId)
    const payload = { targetDocumentId: target, workId: s.workId, createdBy: s.users.owner }
    await internal(p, `/internal/documents/${s.documentId}/fork`, payload)
    await internal(p, `/internal/documents/${s.documentId}/fork`, payload)
    expect((await projection(target))!.plainText).toBe('Once.')
  })
})

describe('restore', () => {
  it('turns the chapter back into an earlier version as a new change, keeping what it replaced', async () => {
    const p = await start()
    const s = await seedChapter(db.db)
    const a = track(connect(p, s.documentId, s.users.owner!))
    await waitFor(() => a.provider.isSynced)
    writeParagraph(a.doc, 'First draft.')
    const snap = (await (
      await internal(p, `/internal/documents/${s.documentId}/snapshots`, {
        workId: s.workId,
        label: 'First',
        createdBy: s.users.owner,
      })
    ).json()) as { id: string }
    a.doc.transact(() => {
      const f = a.doc.getXmlFragment('default')
      f.delete(0, f.length)
    })
    writeParagraph(a.doc, 'A completely different second draft.')
    await waitFor(() => !text(a.doc).includes('First draft.'))

    const res = await internal(p, `/internal/documents/${s.documentId}/restore`, {
      snapshotId: snap.id,
      workId: s.workId,
      createdBy: s.users.owner,
    })
    expect(res.status).toBe(200)
    await waitFor(
      () => text(a.doc).includes('First draft.') && !text(a.doc).includes('second draft'),
      3000,
      'connected client receives the restore',
    )
    const pre = await db.db
      .select()
      .from(documentSnapshots)
      .where(and(eq(documentSnapshots.documentId, s.documentId), eq(documentSnapshots.reason, 'pre_restore')))
    expect(pre).toHaveLength(1)
    expect(JSON.stringify(pre[0]!.contentJson)).toContain('second draft')
  })

  it('refuses a snapshot from another document', async () => {
    const p = await start()
    const s = await seedChapter(db.db)
    const other = await seedChapter(db.db)
    const a = track(connect(p, other.documentId, other.users.owner!))
    await waitFor(() => a.provider.isSynced)
    writeParagraph(a.doc, 'Elsewhere.')
    const snap = (await (
      await internal(p, `/internal/documents/${other.documentId}/snapshots`, {
        workId: other.workId,
        createdBy: other.users.owner,
      })
    ).json()) as { id: string }
    const res = await internal(p, `/internal/documents/${s.documentId}/restore`, {
      snapshotId: snap.id,
      workId: s.workId,
      createdBy: s.users.owner,
    })
    expect(res.status).toBe(404)
  })
})

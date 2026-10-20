import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import type * as Y from 'yjs'
import { chapters, createDb, documents, proposals } from '@morrow/db'
import { signInternal, INTERNAL_SIGNATURE_HEADER } from '@morrow/domain/signing'
import { SCHEMA_VERSION } from '@morrow/editor'
import { startCollab } from '../src/server.ts'
import { silentLogger } from '../src/logger.ts'
import { connect, env, freshDatabase, port, seedChapter, url, waitFor, writeParagraph } from './setup.ts'

let db: ReturnType<typeof createDb>
const servers: { destroy(): Promise<void> }[] = []
const clients: { close(): void }[] = []
beforeAll(async () => {
  await freshDatabase('proposals')
  db = createDb(url('proposals'))
})
afterEach(async () => {
  clients.splice(0).forEach((c) => c.close())
  await Promise.all(servers.splice(0).map((s) => s.destroy()))
})
afterAll(() => db.pool.end())

async function start() {
  const p = port()
  servers.push(await startCollab(env(p, { DATABASE_URL: url('proposals') }), db.db, silentLogger))
  return p
}
const track = <T extends { close(): void }>(c: T) => (clients.push(c), c)
const internal = (p: number, path: string, payload: unknown) => {
  const body = JSON.stringify(payload)
  return fetch(`http://127.0.0.1:${p}${path}`, {
    method: 'POST',
    body,
    headers: { [INTERNAL_SIGNATURE_HEADER]: signInternal('i'.repeat(40), 'POST', path, body) },
  })
}
const paragraphs = (d: Y.Doc) =>
  d
    .getXmlFragment('default')
    .toArray()
    .map((n) => ((n as Y.XmlElement).get(0) as Y.XmlText | undefined)?.toString() ?? '')
const rewrite = (d: Y.Doc, i: number, s: string) =>
  d.transact(() => {
    const t = (d.getXmlFragment('default').get(i) as Y.XmlElement).get(0) as Y.XmlText
    t.delete(0, t.length)
    t.insert(0, s)
  })

/** A chapter with two paragraphs, an author (contributor) and a reviewer (editor), plus a forked proposal. */
async function setupProposal(p: number) {
  const s = await seedChapter(db.db, { contributor: '', editor: '' })
  const owner = track(connect(p, s.documentId, s.users.owner!))
  await waitFor(() => owner.provider.isSynced)
  owner.doc.getXmlFragment('default').delete(0, owner.doc.getXmlFragment('default').length)
  writeParagraph(owner.doc, 'The salt had come up through the roots again.', 'a')
  writeParagraph(owner.doc, 'Ama walked the rows with her palms open.', 'b')
  await waitFor(() => paragraphs(owner.doc).length === 2)
  await new Promise((r) => setTimeout(r, 300)) // let the server receive and store it
  const [chapter] = await db.db.select().from(chapters).where(eq(chapters.documentId, s.documentId))
  const [ws] = await db.db
    .insert(documents)
    .values({ workId: s.workId, kind: 'proposal', schemaVersion: SCHEMA_VERSION })
    .returning()
  const forked = (await (
    await internal(p, `/internal/documents/${s.documentId}/fork`, {
      targetDocumentId: ws!.id,
      workId: s.workId,
      createdBy: s.users.contributor,
      reason: 'proposal_base',
    })
  ).json()) as { forkSnapshotId: string }
  const [prop] = await db.db
    .insert(proposals)
    .values({
      workId: s.workId,
      kind: 'edit',
      authorId: s.users.contributor!,
      title: 'A gentler line',
      chapterId: chapter!.id,
      workspaceDocumentId: ws!.id,
      baseSnapshotId: forked.forkSnapshotId,
    })
    .returning()
  const call = (action: 'classify' | 'apply' | 'refresh', userId = s.users.editor!) =>
    internal(p, `/internal/proposals/${action}`, {
      proposalId: prop!.id,
      workId: s.workId,
      targetDocumentId: s.documentId,
      workspaceDocumentId: ws!.id,
      baseSnapshotId: prop!.baseSnapshotId,
      userId,
    })
  return { s, owner, ws: ws!.id, prop: prop!, call }
}

describe('proposals on live documents', () => {
  it('only the author can open a draft workspace, and it holds the chapter’s text with its history', async () => {
    const p = await start()
    const { s, ws } = await setupProposal(p)
    const author = track(connect(p, ws, s.users.contributor!))
    await waitFor(() => author.provider.isSynced, 5000, 'author sync')
    expect(paragraphs(author.doc)).toEqual([
      'The salt had come up through the roots again.',
      'Ama walked the rows with her palms open.',
    ])
    const reviewer = track(connect(p, ws, s.users.editor!))
    await waitFor(() => reviewer.events.authFailed.length > 0, 5000, 'reviewer refused')
    expect(reviewer.events.authFailed).toEqual(['access_denied'])
  })

  it('accepting applies the proposal live, alongside the owner’s concurrent edit elsewhere, exactly once', async () => {
    const p = await start()
    const { s, owner, ws, call } = await setupProposal(p)
    const author = track(connect(p, ws, s.users.contributor!))
    await waitFor(() => author.provider.isSynced)
    rewrite(author.doc, 1, 'Ama walked the rows slowly, palms open to the salt.')
    await new Promise((r) => setTimeout(r, 300))
    rewrite(owner.doc, 0, 'That spring the salt came up through the roots.') // owner, a different paragraph
    await new Promise((r) => setTimeout(r, 300))

    const c = (await (await call('classify')).json()) as { classification: { kind: string } }
    expect(c.classification.kind).toBe('clean')
    const res = await call('apply')
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ alreadyApplied: false })
    await waitFor(
      () => paragraphs(owner.doc)[1] === 'Ama walked the rows slowly, palms open to the salt.',
      5000,
      'owner sees it live',
    )
    expect(paragraphs(owner.doc)).toEqual([
      'That spring the salt came up through the roots.',
      'Ama walked the rows slowly, palms open to the salt.',
    ])
    expect(await (await call('apply')).json()).toMatchObject({ alreadyApplied: true })
    expect(paragraphs(owner.doc)).toHaveLength(2)
  })

  it('a conflicting proposal is refused with 409; refresh reconciles it so it can be accepted', async () => {
    const p = await start()
    const { s, owner, ws, prop, call } = await setupProposal(p)
    const author = track(connect(p, ws, s.users.contributor!))
    await waitFor(() => author.provider.isSynced)
    rewrite(author.doc, 1, 'Ama ran.')
    rewrite(owner.doc, 1, 'Ama stood still.')
    await new Promise((r) => setTimeout(r, 300))
    const refused = await call('apply')
    expect(refused.status).toBe(409)
    expect(await refused.json()).toMatchObject({ classification: { kind: 'conflict', blockIds: ['b'] } })
    expect(paragraphs(owner.doc)[1]).toBe('Ama stood still.')

    const r = (await (await call('refresh', s.users.contributor!)).json()) as {
      baseSnapshotId: string
      reference: { blockId: string }[]
    }
    expect(r.reference.map((x) => x.blockId)).toEqual(['b'])
    await waitFor(() => paragraphs(author.doc)[1] === 'Ama ran.', 5000, 'author keeps own version')
    await db.db.update(proposals).set({ baseSnapshotId: r.baseSnapshotId }).where(eq(proposals.id, prop.id))
    const apply = await internal(p, '/internal/proposals/apply', {
      proposalId: prop.id,
      workId: s.workId,
      targetDocumentId: s.documentId,
      workspaceDocumentId: ws,
      baseSnapshotId: r.baseSnapshotId,
      userId: s.users.editor,
    })
    expect(apply.status).toBe(200)
    await waitFor(() => paragraphs(owner.doc)[1] === 'Ama ran.', 5000, 'accepted after reconciling')
  })
})

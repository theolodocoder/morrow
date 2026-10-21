import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import WebSocket from 'ws'
import { createDb, documentProjections, documentSnapshots, workMembers } from '@morrow/db'
import { mintTicket, signInternal, INTERNAL_SIGNATURE_HEADER } from '@morrow/domain/signing'
import * as Y from 'yjs'
import { SCHEMA_VERSION } from '@morrow/editor'
import { startCollab } from '../src/server.ts'
import { createDocumentStore } from '../src/document-store.ts'
import { createLogger, silentLogger } from '../src/logger.ts'
import { connect, env, freshDatabase, port, seedChapter, url, waitFor, writeParagraph } from './setup.ts'

let db: ReturnType<typeof createDb>
const servers: { destroy(): Promise<void> }[] = []
const clients: { close(): void }[] = []
beforeAll(async () => {
  await freshDatabase()
  db = createDb(url())
})
afterEach(async () => {
  clients.splice(0).forEach((c) => c.close())
  await Promise.all(servers.splice(0).map((s) => s.destroy()))
})
afterAll(() => db.pool.end())

async function start(over: Record<string, string> = {}) {
  const p = port()
  servers.push(
    await startCollab(
      env(p, over),
      db.db,
      process.env.DEBUG_LOG ? createLogger('collab-test') : silentLogger,
    ),
  )
  return p
}
const track = <T extends { close(): void }>(c: T) => {
  clients.push(c)
  return c
}
const projection = async (documentId: string) =>
  (await db.db.select().from(documentProjections).where(eq(documentProjections.documentId, documentId)))[0]

describe('editing and persistence', () => {
  it('an editor syncs, and the content is persisted with a projection', async () => {
    const p = await start()
    const s = await seedChapter(db.db)
    const a = track(connect(p, s.documentId, s.users.owner!))
    await waitFor(() => a.provider.isSynced, 5000, 'sync')
    writeParagraph(a.doc, 'The salt had come up through the roots again.')
    await waitFor(async () => (await projection(s.documentId))?.wordCount === 9, 5000, 'projection')
    expect((await projection(s.documentId))!.plainText).toBe('The salt had come up through the roots again.')
  })

  it('a new chapter starts as exactly one empty paragraph, even when two collab instances seed it', async () => {
    const pA = await start()
    const pB = await start()
    const s = await seedChapter(db.db)
    const a = track(connect(pA, s.documentId, s.users.owner!))
    const b = track(connect(pB, s.documentId, s.users.owner!))
    await waitFor(() => a.provider.isSynced && b.provider.isSynced)
    writeParagraph(a.doc, 'From A.')
    writeParagraph(b.doc, 'From B.')
    await waitFor(async () => (await projection(s.documentId))?.wordCount === 4, 5000, 'both persisted')
    const blocks = ((await projection(s.documentId))!.contentJson as { content: { content?: unknown[] }[] })
      .content
    expect(blocks.filter((x) => !x.content?.length)).toHaveLength(1) // the single seeded paragraph
  })

  it('a second client loads what was persisted', async () => {
    const p = await start()
    const s = await seedChapter(db.db)
    const a = track(connect(p, s.documentId, s.users.owner!))
    await waitFor(() => a.provider.isSynced)
    writeParagraph(a.doc, 'Persisted line.')
    await waitFor(async () => (await projection(s.documentId))?.wordCount === 2)
    a.close()
    await Promise.all(servers.splice(0).map((x) => x.destroy()))
    const p2 = await start()
    const b = track(connect(p2, s.documentId, s.users.owner!))
    await waitFor(() => b.provider.isSynced)
    expect(b.doc.getXmlFragment('default').toString()).toContain('Persisted line.')
  })

  it('repairs duplicate block ids with a forward edit', async () => {
    const p = await start()
    const s = await seedChapter(db.db)
    const a = track(connect(p, s.documentId, s.users.owner!))
    await waitFor(() => a.provider.isSynced)
    writeParagraph(a.doc, 'One.', 'dup')
    writeParagraph(a.doc, 'Two.', 'dup')
    await waitFor(
      () => {
        const ids = a.doc
          .getXmlFragment('default')
          .toArray()
          .map((n) => (n as Y.XmlElement).getAttribute('id'))
        return new Set(ids).size === 2
      },
      5000,
      'repair reaches the client',
    )
  })
})

describe('authorization (ticket + database re-check, enforced on the server)', () => {
  it('a viewer connects read-only: their edits are neither persisted nor broadcast', async () => {
    const p = await start()
    const s = await seedChapter(db.db, { viewer: 'x' })
    const owner = track(connect(p, s.documentId, s.users.owner!))
    const viewer = track(connect(p, s.documentId, s.users.viewer!))
    await waitFor(() => owner.provider.isSynced && viewer.provider.isSynced)
    writeParagraph(viewer.doc, 'Viewer tries to write.')
    writeParagraph(owner.doc, 'Owner writes.')
    await waitFor(
      async () => (await projection(s.documentId))?.plainText === 'Owner writes.',
      5000,
      'owner persisted',
    )
    await new Promise((r) => setTimeout(r, 300))
    expect(owner.doc.getXmlFragment('default').toString()).not.toContain('Viewer tries')
    expect((await projection(s.documentId))!.plainText).not.toContain('Viewer tries')
  })

  it('an edit ticket for a viewer still yields read-only (the database decides, not the ticket)', async () => {
    const p = await start()
    const s = await seedChapter(db.db, { viewer: 'x' })
    const viewer = track(connect(p, s.documentId, s.users.viewer!, { mode: 'edit' }))
    await waitFor(() => viewer.provider.isSynced)
    writeParagraph(viewer.doc, 'Should not land.')
    await new Promise((r) => setTimeout(r, 400))
    expect(await projection(s.documentId)).toBeUndefined()
  })

  it.each([
    ['a forged ticket', () => 'forged.ticket'],
    [
      'a genuine ticket minted for another document',
      (other: string, owner: string) =>
        mintTicket('t'.repeat(40), { userId: owner, documentId: other, mode: 'edit' }).ticket,
    ],
  ])('rejects %s with access_denied', async (_label, makeTicket) => {
    const p = await start()
    const s = await seedChapter(db.db)
    const other = await seedChapter(db.db)
    const c = track(
      connect(p, s.documentId, s.users.owner!, { ticket: makeTicket(other.documentId, s.users.owner!) }),
    )
    await waitFor(() => c.events.authFailed.length > 0)
    expect(c.events.authFailed[0]).toBe('access_denied')
  })

  it('rejects a valid ticket once the membership is gone', async () => {
    const p = await start()
    const s = await seedChapter(db.db, { editor: 'x' })
    await db.db.delete(workMembers).where(eq(workMembers.userId, s.users.editor!))
    const c = track(connect(p, s.documentId, s.users.editor!))
    await waitFor(() => c.events.authFailed.length > 0)
    expect(c.events.authFailed[0]).toBe('access_denied')
  })

  it('refuses an older editor schema with reload_required', async () => {
    const p = await start()
    const s = await seedChapter(db.db)
    const c = track(connect(p, s.documentId, s.users.owner!, { schemaVersion: SCHEMA_VERSION - 1 }))
    await waitFor(() => c.events.authFailed.length > 0)
    expect(c.events.authFailed[0]).toBe(`reload_required:${SCHEMA_VERSION}`)
  })

  it('rejects WebSocket upgrades from origins that are not allowed, without crashing', async () => {
    const p = await start()
    const status = await new Promise<number>((resolve) => {
      const ws = new WebSocket(`ws://127.0.0.1:${p}`, { headers: { origin: 'https://evil.example' } })
      ws.on('unexpected-response', (_req, res) => resolve(res.statusCode ?? 0))
      ws.on('error', () => {})
    })
    expect(status).toBe(403)
    expect((await fetch(`http://127.0.0.1:${p}/healthz`)).status).toBe(200) // still alive
  })

  it('caps connections per document', async () => {
    const p = await start({ ROOM_MAX_CONNECTIONS: '1' })
    const s = await seedChapter(db.db)
    const a = track(connect(p, s.documentId, s.users.owner!))
    await waitFor(() => a.provider.isSynced)
    const b = track(connect(p, s.documentId, s.users.owner!))
    await waitFor(() => b.events.authFailed.length > 0)
    expect(b.events.authFailed[0]).toBe('room_full')
  })

  it('admits exactly the cap when a burst arrives at a room nobody has open yet', async () => {
    const p = await start({ ROOM_MAX_CONNECTIONS: '5' })
    const s = await seedChapter(db.db)
    // Hold the room's first load (a big chapter, a slow database) while the whole burst authenticates.
    const blocker = await db.pool.connect()
    await blocker.query('begin; lock table document_states in access exclusive mode')
    const burst = Array.from({ length: 12 }, () => track(connect(p, s.documentId, s.users.owner!)))
    await new Promise((r) => setTimeout(r, 1000))
    await blocker.query('commit')
    blocker.release()
    await waitFor(() => burst.every((c) => c.provider.isSynced || c.events.authFailed.length > 0), 10_000)
    expect(burst.filter((c) => c.provider.isSynced)).toHaveLength(5)
    expect(burst.flatMap((c) => c.events.authFailed)).toEqual(Array(7).fill('room_full'))
  })

  it('frees a place when a connection leaves', async () => {
    const p = await start({ ROOM_MAX_CONNECTIONS: '1' })
    const s = await seedChapter(db.db)
    const a = connect(p, s.documentId, s.users.owner!)
    await waitFor(() => a.provider.isSynced)
    a.close()
    const b = track(connect(p, s.documentId, s.users.owner!))
    await waitFor(() => b.provider.isSynced || b.events.authFailed.length > 0)
    expect(b.events.authFailed).toEqual([])
  })
})

describe('snapshots', () => {
  it('takes an automatic snapshot when the last editor leaves', async () => {
    const p = await start()
    const s = await seedChapter(db.db)
    const a = connect(p, s.documentId, s.users.owner!)
    await waitFor(() => a.provider.isSynced)
    writeParagraph(a.doc, 'Before leaving.')
    await waitFor(async () => (await projection(s.documentId))?.wordCount === 2)
    a.close()
    await waitFor(
      async () =>
        (await db.db.select().from(documentSnapshots).where(eq(documentSnapshots.documentId, s.documentId)))
          .length === 1,
      5000,
      'auto snapshot',
    )
  })

  it('takes one automatic snapshot when everyone leaves at once', async () => {
    // Re-checking access on every message keeps each connection mid-message (awaiting the database) as it closes,
    // like a busy room: then every disconnect sees an empty room.
    const p = await start({ ACCESS_RECHECK_MS: '0' })
    const s = await seedChapter(db.db)
    const room = Array.from({ length: 30 }, () => connect(p, s.documentId, s.users.owner!))
    await waitFor(() => room.every((c) => c.provider.isSynced), 10_000)
    room.forEach((c) => writeParagraph(c.doc, 'Before leaving.'))
    await waitFor(async () => (await projection(s.documentId))?.wordCount === 60)
    room.forEach((c) => {
      c.provider.setAwarenessField('cursor', { at: 1 })
      c.close()
    })
    const snapshots = () =>
      db.db.select().from(documentSnapshots).where(eq(documentSnapshots.documentId, s.documentId))
    await waitFor(async () => (await snapshots()).length > 0, 5000, 'auto snapshot')
    await new Promise((r) => setTimeout(r, 1000)) // every disconnect has run its hook by now
    expect(await snapshots()).toHaveLength(1)
  })

  it('records one automatic snapshot per state, even when asked concurrently', async () => {
    const s = await seedChapter(db.db)
    const doc = new Y.Doc()
    writeParagraph(doc, 'Same words, many callers.')
    const store = createDocumentStore(db.db)
    const rows = await Promise.all(
      Array.from({ length: 20 }, () => store.snapshot(s.documentId, s.workId, doc, 'auto')),
    )
    expect(rows.filter(Boolean)).toHaveLength(1)
    const stored = await db.db
      .select()
      .from(documentSnapshots)
      .where(eq(documentSnapshots.documentId, s.documentId))
    expect(stored).toHaveLength(1)
  })

  it('creates a manual snapshot through the signed internal API, and refuses unsigned calls', async () => {
    const p = await start()
    const s = await seedChapter(db.db)
    const a = track(connect(p, s.documentId, s.users.owner!))
    await waitFor(() => a.provider.isSynced)
    writeParagraph(a.doc, 'Worth keeping.')
    const path = `/internal/documents/${s.documentId}/snapshots`
    const body = JSON.stringify({ workId: s.workId, label: 'First draft', createdBy: s.users.owner })
    const unsigned = await fetch(`http://127.0.0.1:${p}${path}`, { method: 'POST', body })
    expect(unsigned.status).toBe(401)
    const res = await fetch(`http://127.0.0.1:${p}${path}`, {
      method: 'POST',
      body,
      headers: { [INTERNAL_SIGNATURE_HEADER]: signInternal('i'.repeat(40), 'POST', path, body) },
    })
    expect(res.status).toBe(201)
    const snap = (await res.json()) as { label: string; wordCount: number; reason: string }
    expect(snap).toMatchObject({ label: 'First draft', wordCount: 2, reason: 'manual' })
    await waitFor(() => a.events.stateless.includes('snapshot_created'), 3000, 'snapshot event')
  })
})

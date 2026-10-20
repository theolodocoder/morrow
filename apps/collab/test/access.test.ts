import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { and, eq } from 'drizzle-orm'
import { createDb, documentProjections, editSessions, workMembers } from '@morrow/db'
import { signInternal, INTERNAL_SIGNATURE_HEADER } from '@morrow/domain/signing'
import { startCollab } from '../src/server.ts'
import { silentLogger } from '../src/logger.ts'
import { connect, env, freshDatabase, port, seedChapter, url, waitFor, writeParagraph } from './setup.ts'

let db: ReturnType<typeof createDb>
const servers: { destroy(): Promise<void> }[] = []
const clients: { close(): void }[] = []
beforeAll(async () => {
  await freshDatabase('access')
  db = createDb(url('access'))
})
afterEach(async () => {
  clients.splice(0).forEach((c) => c.close())
  await Promise.all(servers.splice(0).map((s) => s.destroy()))
})
afterAll(() => db.pool.end())

async function start(over: Record<string, string> = {}) {
  const p = port()
  servers.push(await startCollab(env(p, { DATABASE_URL: url('access'), ...over }), db.db, silentLogger))
  return p
}
const track = <T extends { close(): void }>(c: T) => {
  clients.push(c)
  return c
}
const revoke = (p: number, workId: string, userId: string) => {
  const path = '/internal/access/revoke',
    body = JSON.stringify({ workId, userId })
  return fetch(`http://127.0.0.1:${p}${path}`, {
    method: 'POST',
    body,
    headers: { [INTERNAL_SIGNATURE_HEADER]: signInternal('i'.repeat(40), 'POST', path, body) },
  })
}

describe('revocation', () => {
  it('removing a member closes their live connection and tells them why', async () => {
    const p = await start()
    const s = await seedChapter(db.db, { editor: 'x' })
    const editor = track(connect(p, s.documentId, s.users.editor!))
    await waitFor(() => editor.provider.isSynced)
    await db.db
      .delete(workMembers)
      .where(and(eq(workMembers.workId, s.workId), eq(workMembers.userId, s.users.editor!)))
    const t0 = Date.now()
    const res = await revoke(p, s.workId, s.users.editor!)
    expect(await res.json()).toEqual({ closed: 1 })
    await waitFor(() => editor.events.stateless.includes('access_changed'), 2000, 'access_changed event')
    expect(Date.now() - t0).toBeLessThan(1000)
  })

  it('an unsigned revoke is refused', async () => {
    const p = await start()
    expect(
      (await fetch(`http://127.0.0.1:${p}/internal/access/revoke`, { method: 'POST', body: '{}' })).status,
    ).toBe(401)
  })

  it('backstop: if the revoke call is lost, the next message after the re-check interval is refused', async () => {
    const p = await start({ ACCESS_RECHECK_MS: '100' })
    const s = await seedChapter(db.db, { editor: 'x' })
    const owner = track(connect(p, s.documentId, s.users.owner!))
    const editor = track(connect(p, s.documentId, s.users.editor!))
    await waitFor(() => owner.provider.isSynced && editor.provider.isSynced)
    writeParagraph(editor.doc, 'Before removal.')
    await waitFor(
      async () =>
        (
          await db.db
            .select()
            .from(documentProjections)
            .where(eq(documentProjections.documentId, s.documentId))
        )[0]?.wordCount === 2,
    )
    await db.db
      .delete(workMembers)
      .where(and(eq(workMembers.workId, s.workId), eq(workMembers.userId, s.users.editor!))) // no revoke call
    await new Promise((r) => setTimeout(r, 200))
    writeParagraph(editor.doc, 'After removal, should not land.')
    await waitFor(() => editor.events.stateless.includes('access_changed'), 3000, 'closed by re-check')
    await new Promise((r) => setTimeout(r, 300))
    expect(owner.doc.getXmlFragment('default').toString()).not.toContain('should not land')
  })
})

describe('edit sessions', () => {
  it('records who edited a chapter and how much, when they leave', async () => {
    const p = await start()
    const s = await seedChapter(db.db)
    const a = connect(p, s.documentId, s.users.owner!)
    await waitFor(() => a.provider.isSynced)
    writeParagraph(a.doc, 'One.')
    writeParagraph(a.doc, 'Two.')
    await new Promise((r) => setTimeout(r, 200))
    a.close()
    await waitFor(
      async () =>
        (await db.db.select().from(editSessions).where(eq(editSessions.documentId, s.documentId))).length ===
        1,
      4000,
      'edit session row',
    )
    const [row] = await db.db.select().from(editSessions).where(eq(editSessions.documentId, s.documentId))
    expect(row).toMatchObject({ userId: s.users.owner, workId: s.workId })
    expect(row!.updateCount).toBeGreaterThanOrEqual(2)
  })
})

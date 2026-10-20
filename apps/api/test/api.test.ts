import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import { workMembers, works } from '@morrow/db'
import { verifyTicket } from '@morrow/domain/signing'
import { ORIGIN, env, setup, signUp } from './setup.ts'

let ctx: Awaited<ReturnType<typeof setup>>
beforeAll(async () => {
  ctx = await setup('core')
})
afterAll(async () => {
  await ctx.app.close()
  await ctx.db.pool.end()
})

const createWork = async (u: Awaited<ReturnType<typeof signUp>>, title = 'The Salt Orchard') => {
  const res = await u.call('POST', '/api/v1/works', { title })
  expect(res.statusCode).toBe(201)
  return res.json() as {
    id: string
    version: number
    defaultBranchId: string
    visibility: string
    capabilities: string[]
  }
}
const chaptersOf = async (u: Awaited<ReturnType<typeof signUp>>, workId: string) =>
  (
    (await u.call('GET', `/api/v1/works/${workId}/chapters`)).json() as {
      items: { id: string; title: string; documentId: string }[]
    }
  ).items

describe('sessions and CSRF', () => {
  it('sign-up sets an HttpOnly, SameSite=Lax cookie and never returns the session token in the body', async () => {
    const u = await signUp(ctx.app)
    const cookie = String([u.signUpResponse.headers['set-cookie']].flat()[0])
    expect(cookie).toMatch(/HttpOnly/i)
    expect(cookie).toMatch(/SameSite=Lax/i)
    expect(u.signUpResponse.json()).not.toHaveProperty('token')
    expect((await u.call('GET', '/api/v1/me')).json()).toMatchObject({ id: u.id, email: u.email })
  })
  it('rejects state-changing requests from a foreign or missing Origin — including auth endpoints', async () => {
    const u = await signUp(ctx.app)
    expect(
      (await u.call('POST', '/api/v1/works', { title: 'x' }, { origin: 'https://evil.example' })).statusCode,
    ).toBe(403)
    expect(
      (
        await ctx.app.inject({
          method: 'POST',
          url: '/api/v1/works',
          headers: { cookie: u.cookie },
          payload: { title: 'x' },
        })
      ).statusCode,
    ).toBe(403)
    const evilSignUp = await ctx.app.inject({
      method: 'POST',
      url: '/api/auth/sign-up/email',
      headers: { origin: 'https://evil.example' },
      payload: { name: 'x', email: 'e@example.test', password: 'correct horse battery' },
    })
    expect(evilSignUp.statusCode).toBe(403)
  })
  it('requires a session for /api/v1', async () => {
    const res = await ctx.app.inject({ method: 'GET', url: '/api/v1/works' })
    expect(res.statusCode).toBe(401)
    expect(res.headers['content-type']).toContain('application/problem+json')
  })
})

describe('works', () => {
  it('creates a private work with a default branch and a first chapter', async () => {
    const u = await signUp(ctx.app)
    const w = await createWork(u)
    expect(w.visibility).toBe('private')
    expect(w.capabilities).toContain('work.manage_settings')
    expect(await chaptersOf(u, w.id)).toEqual([expect.objectContaining({ title: 'Chapter 1' })])
  })
  it('ignores attempts to set visibility on create (private by default)', async () => {
    const u = await signUp(ctx.app)
    const res = await u.call('POST', '/api/v1/works', { title: 'Sneaky', visibility: 'public' })
    expect((res.json() as { visibility: string }).visibility).toBe('private')
  })
  it('Idempotency-Key replays the same response; reuse with a different body is a conflict', async () => {
    const u = await signUp(ctx.app)
    const a = await u.call('POST', '/api/v1/works', { title: 'Once' }, { 'idempotency-key': 'k1' })
    const b = await u.call('POST', '/api/v1/works', { title: 'Once' }, { 'idempotency-key': 'k1' })
    expect(b.json().id).toBe(a.json().id)
    expect(b.headers['idempotent-replay']).toBe('true')
    expect(
      (await u.call('POST', '/api/v1/works', { title: 'Different' }, { 'idempotency-key': 'k1' })).statusCode,
    ).toBe(409)
    const library = (await u.call('GET', '/api/v1/works')).json() as { items: unknown[] }
    expect(library.items).toHaveLength(1)
  })
  it("another user's work is invisible: 404 for read, update and delete (no existence leak)", async () => {
    const owner = await signUp(ctx.app)
    const stranger = await signUp(ctx.app, 'Stranger')
    const w = await createWork(owner)
    for (const [m, p] of [
      ['GET', `/api/v1/works/${w.id}`],
      ['PATCH', `/api/v1/works/${w.id}`],
      ['DELETE', `/api/v1/works/${w.id}`],
      ['GET', `/api/v1/works/${w.id}/chapters`],
    ] as const)
      expect((await stranger.call(m, p, m === 'PATCH' ? { title: 'Mine now' } : undefined)).statusCode).toBe(
        404,
      )
    expect(((await stranger.call('GET', '/api/v1/works')).json() as { items: unknown[] }).items).toHaveLength(
      0,
    )
    expect((await stranger.call('GET', `/api/v1/works/${crypto.randomUUID()}`)).body).toBe(
      (await stranger.call('GET', `/api/v1/works/${w.id}`)).body,
    )
  })
  it('a viewer can read but not change settings (403, since they already know it exists)', async () => {
    const owner = await signUp(ctx.app)
    const viewer = await signUp(ctx.app, 'Viewer')
    const w = await createWork(owner)
    await ctx.db.db
      .insert(workMembers)
      .values({ workId: w.id, userId: viewer.id, role: 'viewer', grantedBy: owner.id })
    expect((await viewer.call('GET', `/api/v1/works/${w.id}`)).statusCode).toBe(200)
    expect((await viewer.call('PATCH', `/api/v1/works/${w.id}`, { title: 'x' })).statusCode).toBe(403)
    expect((await viewer.call('POST', `/api/v1/works/${w.id}/chapters`, {})).statusCode).toBe(403)
  })
  it('optimistic concurrency: a stale If-Match is rejected with 412', async () => {
    const u = await signUp(ctx.app)
    const w = await createWork(u)
    const ok = await u.call(
      'PATCH',
      `/api/v1/works/${w.id}`,
      { title: 'Renamed' },
      { 'if-match': `"v${w.version}"` },
    )
    expect(ok.statusCode).toBe(200)
    expect(ok.headers.etag).toBe(`"v${w.version + 1}"`)
    expect(
      (await u.call('PATCH', `/api/v1/works/${w.id}`, { title: 'Again' }, { 'if-match': `"v${w.version}"` }))
        .statusCode,
    ).toBe(412)
  })
  it('validation errors are problem documents with field detail', async () => {
    const u = await signUp(ctx.app)
    const res = await u.call('POST', '/api/v1/works', { title: '' })
    expect(res.statusCode).toBe(400)
    expect(res.json()).toMatchObject({ type: expect.stringContaining('validation'), status: 400 })
  })
  it('a deleted work disappears', async () => {
    const u = await signUp(ctx.app)
    const w = await createWork(u)
    expect((await u.call('DELETE', `/api/v1/works/${w.id}`)).statusCode).toBe(204)
    expect((await u.call('GET', `/api/v1/works/${w.id}`)).statusCode).toBe(404)
    const [row] = await ctx.db.db.select().from(works).where(eq(works.id, w.id))
    expect(row!.deletedAt).not.toBeNull() // soft delete, recoverable
  })
})

describe('chapters', () => {
  it('appends, inserts after, and moves to the start using fractional positions', async () => {
    const u = await signUp(ctx.app)
    const w = await createWork(u)
    const [first] = await chaptersOf(u, w.id)
    const c3 = (await u.call('POST', `/api/v1/works/${w.id}/chapters`, { title: 'Three' })).json() as {
      id: string
    }
    await u.call('POST', `/api/v1/works/${w.id}/chapters`, { title: 'Two', afterChapterId: first!.id })
    expect((await chaptersOf(u, w.id)).map((c) => c.title)).toEqual(['Chapter 1', 'Two', 'Three'])
    await u.call('PATCH', `/api/v1/chapters/${c3.id}`, { moveAfterChapterId: null })
    expect((await chaptersOf(u, w.id)).map((c) => c.title)).toEqual(['Three', 'Chapter 1', 'Two'])
  })
  it('refuses to delete the last chapter', async () => {
    const u = await signUp(ctx.app)
    const w = await createWork(u)
    const [only] = await chaptersOf(u, w.id)
    expect((await u.call('DELETE', `/api/v1/chapters/${only!.id}`)).statusCode).toBe(409)
  })
})

describe('collab tickets and versions', () => {
  it('issues an edit ticket to the owner that collab can verify', async () => {
    const u = await signUp(ctx.app)
    const w = await createWork(u)
    const [c] = await chaptersOf(u, w.id)
    const res = await u.call('POST', '/api/v1/collab/tickets', { documentId: c!.documentId })
    const t = res.json() as { ticket: string; mode: string; schemaVersion: number }
    expect(t.mode).toBe('edit')
    const v = verifyTicket(env.TICKET_SECRET, t.ticket, c!.documentId)
    expect(v.ok && v.claims.userId).toBe(u.id)
  })
  it('viewers get read tickets; strangers get 404', async () => {
    const owner = await signUp(ctx.app)
    const viewer = await signUp(ctx.app)
    const stranger = await signUp(ctx.app)
    const w = await createWork(owner)
    const [c] = await chaptersOf(owner, w.id)
    await ctx.db.db
      .insert(workMembers)
      .values({ workId: w.id, userId: viewer.id, role: 'viewer', grantedBy: owner.id })
    expect(
      (await viewer.call('POST', '/api/v1/collab/tickets', { documentId: c!.documentId })).json().mode,
    ).toBe('read')
    expect(
      (await stranger.call('POST', '/api/v1/collab/tickets', { documentId: c!.documentId })).statusCode,
    ).toBe(404)
  })
  it('"save version" goes through collab; viewers cannot, strangers see nothing', async () => {
    const owner = await signUp(ctx.app)
    const viewer = await signUp(ctx.app)
    const stranger = await signUp(ctx.app)
    const w = await createWork(owner)
    const [c] = await chaptersOf(owner, w.id)
    await ctx.db.db
      .insert(workMembers)
      .values({ workId: w.id, userId: viewer.id, role: 'viewer', grantedBy: owner.id })
    const res = await owner.call('POST', `/api/v1/documents/${c!.documentId}/snapshots`, {
      label: 'First draft',
    })
    expect(res.statusCode).toBe(201)
    expect(ctx.snapshots.at(-1)).toMatchObject({
      documentId: c!.documentId,
      workId: w.id,
      label: 'First draft',
      createdBy: owner.id,
    })
    expect((await viewer.call('POST', `/api/v1/documents/${c!.documentId}/snapshots`, {})).statusCode).toBe(
      403,
    )
    expect((await stranger.call('GET', `/api/v1/documents/${c!.documentId}/snapshots`)).statusCode).toBe(404)
  })
})

it('uses the configured web origin', () => expect(env.WEB_ORIGIN).toBe(ORIGIN))

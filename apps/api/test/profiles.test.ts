import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { eq, sql } from 'drizzle-orm'
import { works } from '@morrow/db'
import { setup, signUp } from './setup.ts'

let ctx: Awaited<ReturnType<typeof setup>>
beforeAll(async () => {
  ctx = await setup('profiles')
})
afterAll(async () => {
  await ctx.app.close()
  await ctx.db.pool.end()
})
const pub = (path: string) => ctx.app.inject({ method: 'GET', url: `/api/v1/public${path}` })

describe('profiles and onboarding (PRD FR-002/003)', () => {
  it('every account gets a private handle at sign-up; onboarding confirms it and makes the profile public', async () => {
    const u = await signUp(ctx.app, 'Ama Owusu')
    const suggested = (await u.call('GET', '/api/v1/me/profile')).json() as {
      username: string
      onboarded: boolean
    }
    expect(suggested).toMatchObject({ username: 'ama_owusu', onboarded: false })
    // Mentionable from the start (invitees never see onboarding), but no public page until onboarding.
    expect((await u.call('GET', '/api/v1/me')).json()).toMatchObject({
      username: 'ama_owusu',
      onboarded: false,
    })
    expect(
      (await ctx.app.inject({ method: 'GET', url: '/api/v1/public/authors/ama_owusu' })).statusCode,
    ).toBe(404)
    const saved = (
      await u.call('PUT', '/api/v1/me/profile', {
        username: 'ama_writes',
        bio: 'Salt and orchards.',
        interests: ['write', 'collaborate'],
        genres: ['Literary', 'literary'],
        onboarded: true,
      })
    ).json()
    expect(saved).toMatchObject({
      username: 'ama_writes',
      interests: ['write', 'collaborate'],
      genres: ['literary'],
      onboarded: true,
    })
    expect((await u.call('GET', '/api/v1/me')).json()).toMatchObject({
      username: 'ama_writes',
      onboarded: true,
    })
  })

  it('skipping onboarding still gives a usable username', async () => {
    const u = await signUp(ctx.app, 'Ama Owusu')
    const saved = (await u.call('PUT', '/api/v1/me/profile', { onboarded: true })).json() as {
      username: string
    }
    expect(saved.username).toMatch(/^ama_owusu\d*$/)
  })

  it('usernames are unique, validated and not reserved', async () => {
    const a = await signUp(ctx.app, 'Tolu')
    const b = await signUp(ctx.app, 'Tolu')
    await a.call('PUT', '/api/v1/me/profile', { username: 'tolu_ade' })
    expect((await b.call('PUT', '/api/v1/me/profile', { username: 'tolu_ade' })).statusCode).toBe(409)
    expect((await b.call('GET', '/api/v1/usernames/tolu_ade/availability')).json()).toMatchObject({
      available: false,
    })
    expect((await a.call('GET', '/api/v1/usernames/tolu_ade/availability')).json()).toMatchObject({
      available: true,
    }) // your own
    expect((await b.call('GET', '/api/v1/usernames/admin/availability')).json()).toMatchObject({
      available: false,
      reason: 'That username is reserved.',
    })
    expect((await b.call('GET', '/api/v1/usernames/No%20Spaces/availability')).json().available).toBe(false)
    expect((await b.call('PUT', '/api/v1/me/profile', { username: 'settings' })).statusCode).toBe(400)
  })

  it('links must be http(s)', async () => {
    const u = await signUp(ctx.app)
    expect(
      (await u.call('PUT', '/api/v1/me/profile', { links: [{ label: 'x', url: 'javascript:alert(1)' }] }))
        .statusCode,
    ).toBe(400)
    expect(
      (await u.call('PUT', '/api/v1/me/profile', { links: [{ label: 'Site', url: 'https://example.com' }] }))
        .statusCode,
    ).toBe(200)
  })
})

describe('public author page', () => {
  it('shows only what the author chose, and only published public works', async () => {
    const u = await signUp(ctx.app, 'Mara')
    await u.call('PUT', '/api/v1/me/profile', {
      username: 'mara_k',
      bio: 'Hidden bio',
      showBio: false,
      links: [{ label: 'Site', url: 'https://example.com' }],
      onboarded: true,
    })
    const draft = (await u.call('POST', '/api/v1/works', { title: 'Draft' })).json() as { id: string }
    const privatePublished = (
      await u.call('POST', '/api/v1/works', { title: 'Private but published' })
    ).json() as { id: string }
    const live = (await u.call('POST', '/api/v1/works', { title: 'Live work' })).json() as { id: string }
    await ctx.db.db
      .update(works)
      .set({ visibility: 'public', publishedAt: sql`now()` })
      .where(eq(works.id, live.id))
    await ctx.db.db
      .update(works)
      .set({ publishedAt: sql`now()` })
      .where(eq(works.id, privatePublished.id))
    await ctx.db.db.update(works).set({ visibility: 'public' }).where(eq(works.id, draft.id)) // public but never published
    const res = await pub('/authors/MARA_K')
    expect(res.statusCode).toBe(200)
    const a = res.json() as { bio: string | null; links: unknown[] | null; works: { title: string }[] }
    expect(a.bio).toBeNull()
    expect(a.links).toEqual([{ label: 'Site', url: 'https://example.com' }])
    expect(a.works.map((w) => w.title)).toEqual(['Live work'])
  })

  it('a private profile is not found', async () => {
    const u = await signUp(ctx.app)
    await u.call('PUT', '/api/v1/me/profile', { username: 'quiet_one', isPublic: false })
    expect((await pub('/authors/quiet_one')).statusCode).toBe(404)
    expect((await pub('/authors/nobody_here')).statusCode).toBe(404)
  })

  it('same-name writers skipping onboarding at the same moment all get distinct suggested usernames', async () => {
    const people = await Promise.all([1, 2, 3, 4, 5].map(() => signUp(ctx.app, 'Ngozi Eze')))
    const results = await Promise.all(
      people.map((u) => u.call('PUT', '/api/v1/me/profile', { onboarded: true })),
    )
    expect(results.map((r) => r.statusCode)).toEqual([200, 200, 200, 200, 200])
    const names = results.map((r) => (r.json() as { username: string }).username)
    expect(new Set(names).size).toBe(5)
  })
})

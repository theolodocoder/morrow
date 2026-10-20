import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { eq, sql } from 'drizzle-orm'
import { invitations, subscriptions } from '@morrow/db'
import { setup, signUp } from './setup.ts'

let ctx: Awaited<ReturnType<typeof setup>>
beforeAll(async () => {
  ctx = await setup('members')
})
afterAll(async () => {
  await ctx.app.close()
  await ctx.db.pool.end()
})

type User = Awaited<ReturnType<typeof signUp>>
async function workOf(owner: User) {
  return (await owner.call('POST', '/api/v1/works', { title: 'The Salt Orchard' })).json() as { id: string }
}
async function invite(owner: User, workId: string, email: string, role = 'editor') {
  const res = await owner.call('POST', `/api/v1/works/${workId}/invitations`, { email, role })
  expect(res.statusCode).toBe(201)
  const body = res.json() as { id: string; inviteUrl: string }
  return { ...body, token: body.inviteUrl.split('/invite/')[1]! }
}

describe('invitations', () => {
  it('owner invites by email; the invitee previews signed out, then accepts and becomes a member', async () => {
    const owner = await signUp(ctx.app, 'Ama')
    const w = await workOf(owner)
    const tolu = await signUp(ctx.app, 'Tolu')
    const inv = await invite(owner, w.id, tolu.email)
    expect(ctx.email.outbox.at(-1)).toMatchObject({ to: tolu.email })
    expect(ctx.email.outbox.at(-1)!.text).toContain(inv.inviteUrl)

    const preview = await ctx.app.inject({ method: 'GET', url: `/api/v1/public/invitations/${inv.token}` })
    expect(preview.json()).toMatchObject({
      workTitle: 'The Salt Orchard',
      invitedByName: 'Ama',
      role: 'editor',
      status: 'pending',
    })
    expect(preview.json().emailHint).not.toContain(tolu.email.split('@')[0]!.slice(1)) // masked

    expect((await tolu.call('GET', `/api/v1/works/${w.id}`)).statusCode).toBe(404) // not yet
    const accepted = await tolu.call('POST', `/api/v1/invitations/${inv.token}/accept`, {})
    expect(accepted.json()).toEqual({ workId: w.id })
    const work = (await tolu.call('GET', `/api/v1/works/${w.id}`)).json() as { capabilities: string[] }
    expect(work.capabilities).toContain('document.edit')
    expect(work.capabilities).not.toContain('work.manage_members')
  })

  it('tokens are single-use, stored only as hashes, and bound to the invited address', async () => {
    const owner = await signUp(ctx.app)
    const w = await workOf(owner)
    const invitee = await signUp(ctx.app)
    const other = await signUp(ctx.app)
    const inv = await invite(owner, w.id, invitee.email)
    const [row] = await ctx.db.db.select().from(invitations).where(eq(invitations.id, inv.id))
    expect(row!.tokenHash).not.toContain(inv.token)
    const forwarded = await other.call('POST', `/api/v1/invitations/${inv.token}/accept`, {})
    expect(forwarded.statusCode).toBe(403)
    expect((await invitee.call('POST', `/api/v1/invitations/${inv.token}/accept`, {})).statusCode).toBe(200)
    expect((await invitee.call('POST', `/api/v1/invitations/${inv.token}/accept`, {})).statusCode).toBe(410)
  })

  it('expired, revoked and replaced invitations cannot be used', async () => {
    const owner = await signUp(ctx.app)
    const w = await workOf(owner)
    const invitee = await signUp(ctx.app)
    const first = await invite(owner, w.id, invitee.email)
    const second = await invite(owner, w.id, invitee.email) // replaces the first link
    expect((await invitee.call('POST', `/api/v1/invitations/${first.token}/accept`, {})).statusCode).toBe(410)
    await ctx.db.db
      .update(invitations)
      .set({ expiresAt: sql`now() - interval '1 minute'` })
      .where(eq(invitations.id, second.id))
    expect((await invitee.call('POST', `/api/v1/invitations/${second.token}/accept`, {})).statusCode).toBe(
      410,
    )
    const third = await invite(owner, w.id, invitee.email)
    expect((await owner.call('DELETE', `/api/v1/invitations/${third.id}`)).statusCode).toBe(204)
    expect((await invitee.call('POST', `/api/v1/invitations/${third.token}/accept`, {})).statusCode).toBe(410)
    expect(
      (await ctx.app.inject({ method: 'GET', url: `/api/v1/public/invitations/${third.token}` })).json()
        .status,
    ).toBe('revoked')
  })

  it('only the owner can invite; members cannot; strangers get 404', async () => {
    const owner = await signUp(ctx.app)
    const w = await workOf(owner)
    const editor = await signUp(ctx.app)
    const stranger = await signUp(ctx.app)
    await editor.call(
      'POST',
      `/api/v1/invitations/${(await invite(owner, w.id, editor.email)).token}/accept`,
      {},
    )
    expect(
      (
        await editor.call('POST', `/api/v1/works/${w.id}/invitations`, {
          email: 'x@example.test',
          role: 'viewer',
        })
      ).statusCode,
    ).toBe(403)
    expect(
      (
        await stranger.call('POST', `/api/v1/works/${w.id}/invitations`, {
          email: 'x@example.test',
          role: 'viewer',
        })
      ).statusCode,
    ).toBe(404)
    expect(
      (await owner.call('POST', `/api/v1/works/${w.id}/invitations`, { email: editor.email, role: 'viewer' }))
        .statusCode,
    ).toBe(409) // already a member
  })
})

describe('membership changes revoke live access', () => {
  async function team() {
    const owner = await signUp(ctx.app, 'Ama')
    const w = await workOf(owner)
    const editor = await signUp(ctx.app, 'Tolu')
    await editor.call(
      'POST',
      `/api/v1/invitations/${(await invite(owner, w.id, editor.email)).token}/accept`,
      {},
    )
    return { owner, editor, w }
  }

  it('members see names; only the owner sees emails', async () => {
    const { owner, editor, w } = await team()
    const asOwner = (await owner.call('GET', `/api/v1/works/${w.id}/members`)).json() as {
      items: { email: string | null; role: string }[]
    }
    expect(asOwner.items.map((m) => m.role)).toEqual(['owner', 'editor'])
    expect(asOwner.items.every((m) => m.email)).toBe(true)
    const asEditor = (await editor.call('GET', `/api/v1/works/${w.id}/members`)).json() as {
      items: { email: string | null }[]
    }
    expect(asEditor.items.every((m) => m.email === null)).toBe(true)
  })

  it('downgrading a member updates their capabilities and tells collab to reconnect them', async () => {
    const { owner, editor, w } = await team()
    ctx.revocations.length = 0
    expect(
      (await owner.call('PATCH', `/api/v1/works/${w.id}/members/${editor.id}`, { role: 'viewer' }))
        .statusCode,
    ).toBe(200)
    expect(ctx.revocations).toEqual([{ workId: w.id, userId: editor.id }])
    const caps = ((await editor.call('GET', `/api/v1/works/${w.id}`)).json() as { capabilities: string[] })
      .capabilities
    expect(caps).not.toContain('document.edit')
  })

  it('removing a member hides the work from them and revokes collab access', async () => {
    const { owner, editor, w } = await team()
    ctx.revocations.length = 0
    expect((await owner.call('DELETE', `/api/v1/works/${w.id}/members/${editor.id}`)).statusCode).toBe(204)
    expect(ctx.revocations).toEqual([{ workId: w.id, userId: editor.id }])
    expect((await editor.call('GET', `/api/v1/works/${w.id}`)).statusCode).toBe(404)
  })

  it('a member can leave; nobody can remove or re-role the owner', async () => {
    const { owner, editor, w } = await team()
    expect((await owner.call('DELETE', `/api/v1/works/${w.id}/members/${owner.id}`)).statusCode).toBe(409)
    expect(
      (await owner.call('PATCH', `/api/v1/works/${w.id}/members/${owner.id}`, { role: 'viewer' })).statusCode,
    ).toBe(409)
    expect((await editor.call('DELETE', `/api/v1/works/${w.id}/members/${owner.id}`)).statusCode).toBe(403)
    expect((await editor.call('DELETE', `/api/v1/works/${w.id}/members/${editor.id}`)).statusCode).toBe(204)
  })
})

describe('rate limits are per user, not per IP', () => {
  it('one person hitting the invitation limit does not block another on the same network', async () => {
    const a = await signUp(ctx.app)
    const b = await signUp(ctx.app)
    // An unlimited plan, so this test meets the rate limit, not the people-per-work plan limit.
    await ctx.db.db
      .insert(subscriptions)
      .values({ userId: a.id, planKey: 'organization', status: 'comped', source: 'comp' })
    const wa = await workOf(a)
    const wb = await workOf(b)
    for (let i = 0; i < 30; i++)
      expect(
        (
          await a.call('POST', `/api/v1/works/${wa.id}/invitations`, {
            email: `x${i}@example.test`,
            role: 'viewer',
          })
        ).statusCode,
      ).toBe(201)
    const limited = await a.call('POST', `/api/v1/works/${wa.id}/invitations`, {
      email: 'over@example.test',
      role: 'viewer',
    })
    expect(limited.statusCode).toBe(429)
    expect(limited.json()).toMatchObject({ type: expect.stringContaining('rate-limited') })
    expect(
      (
        await b.call('POST', `/api/v1/works/${wb.id}/invitations`, {
          email: 'fine@example.test',
          role: 'viewer',
        })
      ).statusCode,
    ).toBe(201)
  })
})

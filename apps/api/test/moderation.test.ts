import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import { moderationActions, staff, user, workMembers } from '@morrow/db'
import { processOutbox } from '../src/notifications.ts'
import { setup, signUp } from './setup.ts'

let ctx: Awaited<ReturnType<typeof setup>>
beforeAll(async () => {
  ctx = await setup('moderation')
})
afterAll(async () => {
  await ctx.app.close()
  await ctx.db.pool.end()
})
type User = Awaited<ReturnType<typeof signUp>>
const anchor = {
  start: { item: { client: 1, clock: 1 }, assoc: 0 },
  end: { item: { client: 1, clock: 5 }, assoc: -1 },
  quote: 'gate',
  blockId: 'a',
}
const pub = (path: string) => ctx.app.inject({ method: 'GET', url: `/api/v1/public${path}` })

async function person(name: string) {
  const u = await signUp(ctx.app, name)
  await u.call('PUT', '/api/v1/me/profile', { onboarded: true })
  const username = ((await u.call('GET', '/api/v1/me/profile')).json() as { username: string }).username
  return Object.assign(u, { username })
}
async function moderator(name = 'Mod') {
  const m = await person(name)
  await ctx.db.db.insert(staff).values({ userId: m.id, role: 'moderator' })
  await ctx.db.db.update(user).set({ twoFactorEnabled: true }).where(eq(user.id, m.id)) // staff must have 2FA
  return m
}
async function publicWork(owner: User, title = 'The Orchard') {
  const w = (await owner.call('POST', '/api/v1/works', { title, category: 'novel' })).json() as { id: string }
  const p = (await owner.call('POST', `/api/v1/works/${w.id}/publish`, { visibility: 'public' })).json() as {
    publicPath: string
  }
  const [c] = (
    (await owner.call('GET', `/api/v1/works/${w.id}/chapters`)).json() as { items: { documentId: string }[] }
  ).items
  return { id: w.id, publicPath: p.publicPath, documentId: c!.documentId }
}
const report = (u: User, target: object, category = 'spam') =>
  u.call('POST', '/api/v1/reports', { target, category, details: 'Look at this.' })
type Q = { id: string; status: string; snapshot: Record<string, unknown>; subject: { id: string } | null }
const queue = async (m: User, status = 'open') =>
  ((await m.call('GET', `/api/v1/moderation/reports?status=${status}`)).json() as { items: Q[] }).items

describe('reporting (FR-031)', () => {
  it('report what you can see: once per person, never your own, never private work you can’t read', async () => {
    const owner = await person('Ama')
    const w = await publicWork(owner)
    const reader = await person('Bisi')
    const first = await report(reader, { type: 'work', publicPath: w.publicPath })
    expect(first.statusCode).toBe(201)
    expect((await report(reader, { type: 'work', publicPath: w.publicPath })).statusCode).toBe(200) // same open report
    expect((await report(owner, { type: 'work', publicPath: w.publicPath })).statusCode).toBe(409)
    const secret = (
      await owner.call('POST', '/api/v1/works', { title: 'Private', category: 'novel' })
    ).json() as { id: string }
    expect((await report(reader, { type: 'work', workId: secret.id })).statusCode).toBe(404)
    const anon = await ctx.app.inject({
      method: 'POST',
      url: '/api/v1/reports',
      headers: { origin: 'http://localhost:3000' },
      payload: { target: { type: 'work', publicPath: w.publicPath }, category: 'spam' },
    })
    expect(anon.statusCode).toBe(401)
    expect(
      (
        (await reader.call('GET', '/api/v1/me/reports')).json() as {
          items: { status: string; summary: string }[]
        }
      ).items[0],
    ).toMatchObject({ status: 'open', summary: 'The Orchard' })
  })

  it('a comment in a private work is reported as a snapshot: moderators see that, not the work', async () => {
    const owner = await person('Ama')
    const w = (
      await owner.call('POST', '/api/v1/works', { title: 'Private Orchard', category: 'novel' })
    ).json() as { id: string }
    const [c] = (
      (await owner.call('GET', `/api/v1/works/${w.id}/chapters`)).json() as {
        items: { documentId: string }[]
      }
    ).items
    const member = await person('Kemi')
    await ctx.db.db
      .insert(workMembers)
      .values({ workId: w.id, userId: member.id, role: 'viewer', grantedBy: owner.id })
    const t = (
      await owner.call('POST', `/api/v1/documents/${c!.documentId}/comments`, {
        body: 'Something nasty',
        anchor,
      })
    ).json() as { id: string }
    expect((await report(member, { type: 'comment', commentId: t.id }, 'harassment')).statusCode).toBe(201)
    const outsider = await person('Out')
    expect((await report(outsider, { type: 'comment', commentId: t.id })).statusCode).toBe(404)
    const mod = await moderator()
    const item = (await queue(mod)).find((q) => q.snapshot.body === 'Something nasty')
    expect(item?.snapshot).toMatchObject({ body: 'Something nasty', work: 'Private Orchard', quote: 'gate' })
    // The moderator still can't open the private work itself.
    expect((await mod.call('GET', `/api/v1/works/${w.id}`)).statusCode).toBe(404)
    const nobody = await person('Nobody')
    expect((await nobody.call('GET', '/api/v1/moderation/reports')).statusCode).toBe(404) // the console isn't advertised
  })
})

describe('moderation actions (FR-031)', () => {
  it('hiding a work removes it everywhere public; reporter sees the outcome; the author appeals; another moderator overturns', async () => {
    const owner = await person('Ama')
    const w = await publicWork(owner, 'Spam Orchard')
    const reader = await person('Bisi')
    await report(reader, { type: 'work', publicPath: w.publicPath })
    const mod = await moderator('Mod One')
    const r = (await queue(mod)).find((q) => q.snapshot.title === 'Spam Orchard')!
    await mod.call('POST', `/api/v1/moderation/reports/${r.id}/claim`, {})
    expect(
      (
        await mod.call('POST', `/api/v1/moderation/reports/${r.id}/resolve`, {
          action: 'hide_work',
          reason: 'Commercial spam',
          resolution: 'We removed it. Thank you.',
        })
      ).statusCode,
    ).toBe(204)
    expect((await pub(`/works/${w.publicPath}`)).statusCode).toBe(404)
    expect(((await pub('/search?q=spam')).json() as { works: unknown[] }).works).toEqual([])
    expect((await owner.call('POST', `/api/v1/works/${w.id}/publish`, {})).statusCode).toBe(409)
    expect(
      ((await reader.call('GET', '/api/v1/me/reports')).json() as { items: object[] }).items[0],
    ).toMatchObject({ status: 'actioned', resolution: 'We removed it. Thank you.' })

    const mine = (await owner.call('GET', '/api/v1/me/moderation')).json() as {
      actions: { id: string; action: string; moderator: string }[]
    }
    expect(mine.actions[0]).toMatchObject({ action: 'hide_work', moderator: 'A moderator' }) // moderators stay anonymous to subjects
    expect(
      (
        await owner.call('POST', '/api/v1/me/appeals', {
          actionId: mine.actions[0]!.id,
          message: 'It is a real novel, not an ad.',
        })
      ).statusCode,
    ).toBe(201)
    expect(
      (
        await owner.call('POST', '/api/v1/me/appeals', {
          actionId: mine.actions[0]!.id,
          message: 'Again, please look.',
        })
      ).statusCode,
    ).toBe(409)
    const appeals = (
      (await mod.call('GET', '/api/v1/moderation/appeals')).json() as { items: { id: string }[] }
    ).items
    expect(
      (
        await mod.call('POST', `/api/v1/moderation/appeals/${appeals[0]!.id}/decide`, {
          decision: 'overturned',
          note: 'Fair.',
        })
      ).statusCode,
    ).toBe(403) // not their own decision
    const mod2 = await moderator('Mod Two')
    await mod2.call('POST', `/api/v1/moderation/appeals/${appeals[0]!.id}/decide`, {
      decision: 'overturned',
      note: 'It is a novel. Restored.',
    })
    expect((await pub(`/works/${w.publicPath}`)).statusCode).toBe(200)
    const log = await ctx.db.db.select().from(moderationActions).where(eq(moderationActions.targetId, w.id))
    expect(log.map((a) => a.action).sort()).toEqual(['hide_work', 'restore_work']) // audit history kept
  })

  it('moderators can’t act on their own content or their own reports', async () => {
    const mod = await moderator('Mod Self')
    const w = await publicWork(mod, 'Mod Orchard')
    const reader = await person('Bisi')
    await report(reader, { type: 'work', publicPath: w.publicPath })
    const r = (await queue(mod)).find((q) => q.snapshot.title === 'Mod Orchard')!
    expect(
      (
        await mod.call('POST', `/api/v1/moderation/reports/${r.id}/resolve`, {
          action: 'dismiss',
          reason: 'Mine',
        })
      ).statusCode,
    ).toBe(403)
  })

  it('suspension makes an account read-only everywhere; mute stops posting; lifting restores', async () => {
    const owner = await person('Ama')
    const w = await publicWork(owner, 'Troll Orchard')
    const troll = await person('Troll')
    await report(owner, { type: 'user', username: troll.username }, 'harassment')
    const mod = await moderator('Mod Three')
    const r = (await queue(mod)).find((q) => q.subject?.id === troll.id)!
    await mod.call('POST', `/api/v1/moderation/reports/${r.id}/resolve`, {
      action: 'restrict_account',
      reason: 'Harassment',
      restriction: { kind: 'suspended', days: 7 },
    })
    const tw = await troll.call('POST', '/api/v1/works', { title: 'x', category: 'novel' })
    expect(tw.statusCode).toBe(403)
    expect((await troll.call('GET', '/api/v1/works')).statusCode).toBe(200) // reading still works
    expect(
      ((await troll.call('GET', '/api/v1/me/moderation')).json() as { restriction: { kind: string } })
        .restriction,
    ).toMatchObject({ kind: 'suspended' })
    const action = (
      (await mod.call('GET', `/api/v1/moderation/actions?subjectUserId=${troll.id}`)).json() as {
        items: { id: string; action: string }[]
      }
    ).items.find((a) => a.action === 'restrict_account')!
    await mod.call('POST', `/api/v1/moderation/actions/${action.id}/reverse`, { reason: 'Served enough' })
    expect((await troll.call('POST', '/api/v1/works', { title: 'x', category: 'novel' })).statusCode).toBe(
      201,
    )

    // Mute: comments blocked, other writes fine.
    const member = await person('Muted')
    await ctx.db.db
      .insert(workMembers)
      .values({ workId: w.id, userId: member.id, role: 'viewer', grantedBy: owner.id })
    await report(owner, { type: 'user', username: member.username }, 'spam')
    const r2 = (await queue(mod)).find((q) => q.subject?.id === member.id)!
    await mod.call('POST', `/api/v1/moderation/reports/${r2.id}/resolve`, {
      action: 'restrict_account',
      reason: 'Spam comments',
      restriction: { kind: 'muted', days: null },
    })
    expect(
      (await member.call('POST', `/api/v1/documents/${w.documentId}/comments`, { body: 'buy now', anchor }))
        .statusCode,
    ).toBe(403)
    expect(
      (await member.call('POST', '/api/v1/works', { title: 'Mine', category: 'novel' })).statusCode,
    ).toBe(201)
  })
})

describe('blocking and abuse limits (FR-032)', () => {
  it('blocking ends follows, prevents following, mentions, invitations and notifications', async () => {
    const ama = await person('Ama')
    const w = await publicWork(ama, 'Block Orchard')
    const pest = await person('Pest')
    await pest.call('PUT', '/api/v1/me/follows', { type: 'author', username: ama.username })
    await ctx.db.db
      .insert(workMembers)
      .values({ workId: w.id, userId: pest.id, role: 'viewer', grantedBy: ama.id })
    expect((await ama.call('PUT', '/api/v1/me/blocks', { username: pest.username })).statusCode).toBe(204)
    expect(
      ((await pest.call('GET', '/api/v1/me/reading-list')).json() as { authors: unknown[] }).authors,
    ).toEqual([])
    expect(
      (await pest.call('PUT', '/api/v1/me/follows', { type: 'author', username: ama.username })).statusCode,
    ).toBe(404)
    const t = (
      await pest.call('POST', `/api/v1/documents/${w.documentId}/comments`, {
        body: `@${ama.username} hey`,
        anchor,
      })
    ).json() as { comments: { mentions: unknown[] }[] }
    expect(t.comments[0]!.mentions).toEqual([]) // the mention doesn't reach her
    await processOutbox(ctx.db.db)
    const items = (
      (await ama.call('GET', '/api/v1/me/notifications')).json() as { items: { title: string }[] }
    ).items
    expect(items.some((i) => i.title.startsWith('Pest'))).toBe(false)
    expect(
      (await ama.call('POST', `/api/v1/works/${w.id}/invitations`, { email: pest.email, role: 'viewer' }))
        .statusCode,
    ).toBe(409)
    expect(
      ((await ama.call('GET', '/api/v1/me/blocks')).json() as { items: { username: string }[] }).items.map(
        (b) => b.username,
      ),
    ).toEqual([pest.username])
    await ama.call('DELETE', '/api/v1/me/blocks', { username: pest.username })
    expect(
      (await pest.call('PUT', '/api/v1/me/follows', { type: 'author', username: ama.username })).statusCode,
    ).toBe(204)
  })

  it('link-stuffed and repeated comments are refused', async () => {
    const ama = await person('Ama')
    const w = await publicWork(ama, 'Spam Limits')
    const body = 'see https://a.example https://b.example https://c.example https://d.example'
    expect(
      (await ama.call('POST', `/api/v1/documents/${w.documentId}/comments`, { body, anchor })).statusCode,
    ).toBe(422)
    const same = 'This exact sentence again and again.'
    expect(
      (await ama.call('POST', `/api/v1/documents/${w.documentId}/comments`, { body: same, anchor }))
        .statusCode,
    ).toBe(201)
    expect(
      (await ama.call('POST', `/api/v1/documents/${w.documentId}/comments`, { body: same, anchor }))
        .statusCode,
    ).toBe(429)
    expect(
      (await ama.call('POST', `/api/v1/documents/${w.documentId}/comments`, { body: 'Thanks!', anchor }))
        .statusCode,
    ).toBe(201)
    expect(
      (await ama.call('POST', `/api/v1/documents/${w.documentId}/comments`, { body: 'Thanks!', anchor }))
        .statusCode,
    ).toBe(201) // short replies repeat naturally
  })
})

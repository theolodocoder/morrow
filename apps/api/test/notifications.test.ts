import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import { notifications, user, workMembers } from '@morrow/db'
import { deliverEmails, inQuietHours, processOutbox } from '../src/notifications.ts'
import { setup, signUp } from './setup.ts'

let ctx: Awaited<ReturnType<typeof setup>>
beforeAll(async () => {
  ctx = await setup('notifications')
})
afterAll(async () => {
  await ctx.app.close()
  await ctx.db.pool.end()
})

type User = Awaited<ReturnType<typeof signUp>>
type Item = { title: string; category: string; url: string; read: boolean; body: string }
// Badges (FR-025) are announced in the same list; these tests are about everything else.
const inbox = async (u: User) => {
  const r = (await u.call('GET', '/api/v1/me/notifications')).json() as { items: Item[]; unread: number }
  return { ...r, items: r.items.filter((i) => !i.title.startsWith('You earned a badge')) }
}
const run = () => processOutbox(ctx.db.db)
const anchor = {
  start: { item: { client: 1, clock: 1 }, assoc: 0 },
  end: { item: { client: 1, clock: 5 }, assoc: -1 },
  quote: 'gate',
  blockId: 'a',
}

async function scene() {
  const owner = await signUp(ctx.app, 'Ama')
  const w = (
    await owner.call('POST', '/api/v1/works', { title: 'The Orchard', category: 'novel' })
  ).json() as { id: string }
  const [c] = (
    (await owner.call('GET', `/api/v1/works/${w.id}/chapters`)).json() as {
      items: { id: string; documentId: string }[]
    }
  ).items
  const member = async (role: 'editor' | 'contributor' | 'viewer', name: string) => {
    const u = await signUp(ctx.app, name)
    await ctx.db.db.insert(workMembers).values({ workId: w.id, userId: u.id, role, grantedBy: owner.id })
    return u
  }
  await run() // clear set-up events
  return { owner, workId: w.id, chapter: c!, member }
}

describe('notifications (PRD FR-030)', () => {
  it('proposal: reviewers hear about a submission, the author about the decision; nobody about their own action', async () => {
    const s = await scene()
    const tolu = await s.member('contributor', 'Tolu')
    const editor = await s.member('editor', 'Kemi')
    const p = (
      await tolu.call('POST', `/api/v1/works/${s.workId}/proposals`, {
        kind: 'character',
        title: 'The ferryman',
        body: 'Old, quiet.',
      })
    ).json() as { id: string }
    await tolu.call('POST', `/api/v1/proposals/${p.id}/submit`, {})
    await run()
    expect((await inbox(s.owner)).items[0]).toMatchObject({
      category: 'activity',
      title: 'Tolu submitted a proposal: “The ferryman”',
      url: `/app/works/${s.workId}/proposals/${p.id}`,
    })
    expect((await inbox(editor)).items[0]?.title).toBe('Tolu submitted a proposal: “The ferryman”')
    expect((await inbox(tolu)).items).toHaveLength(0)
    await s.owner.call('POST', `/api/v1/proposals/${p.id}/accept`, { note: 'Lovely.' })
    await run()
    expect((await inbox(tolu)).items[0]).toMatchObject({
      category: 'proposals',
      title: 'Ama accepted your proposal “The ferryman”',
      body: 'Lovely.',
      read: false,
    })
  })

  it('a reply that also mentions you arrives once, as a mention; thread participants hear about replies', async () => {
    const s = await scene()
    const kemi = await s.member('editor', 'Kemi')
    const bisi = await s.member('viewer', 'Bisi')
    const handle = ((await bisi.call('GET', '/api/v1/me/profile')).json() as { username: string }).username
    const t = (
      await bisi.call('POST', `/api/v1/documents/${s.chapter.documentId}/comments`, {
        body: 'Is this the gate?',
        anchor,
      })
    ).json() as { id: string }
    await run()
    expect((await inbox(s.owner)).items[0]).toMatchObject({
      category: 'comments',
      title: 'Bisi commented on “Chapter 1”',
    })
    expect((await inbox(s.owner)).items[0]!.url).toContain('?feedback=1')
    await kemi.call('POST', `/api/v1/comments/${t.id}/replies`, { body: `Yes @${handle}, the old one.` })
    await run()
    const b = (await inbox(bisi)).items
    expect(b).toHaveLength(1)
    expect(b[0]).toMatchObject({ category: 'mentions', title: 'Kemi mentioned you on “Chapter 1”' })
  })

  it('someone who has lost access hears nothing more about the work', async () => {
    const s = await scene()
    const gone = await s.member('viewer', 'Gone')
    const handle = ((await gone.call('GET', '/api/v1/me/profile')).json() as { username: string }).username
    await ctx.db.db.delete(workMembers).where(eq(workMembers.userId, gone.id))
    await ctx.db.db
      .insert(workMembers)
      .values({ workId: s.workId, userId: gone.id, role: 'viewer', grantedBy: s.owner.id })
    await s.owner.call('POST', `/api/v1/documents/${s.chapter.documentId}/comments`, {
      body: `@${handle} look`,
      anchor,
    })
    await ctx.db.db.delete(workMembers).where(eq(workMembers.userId, gone.id)) // removed before the worker runs
    await run()
    expect((await inbox(gone)).items).toHaveLength(0)
  })

  it('preferences: categories can be switched off; email waits out quiet hours', async () => {
    const s = await scene()
    const bisi = await s.member('viewer', 'Bisi')
    const handle = ((await bisi.call('GET', '/api/v1/me/profile')).json() as { username: string }).username
    const prefs = await bisi.call('PUT', '/api/v1/me/notification-preferences', {
      categories: { mentions: { inApp: true, email: true } },
      quietStart: 22 * 60,
      quietEnd: 7 * 60,
      timeZone: 'Africa/Lagos',
    })
    expect(prefs.json()).toMatchObject({
      quietStart: 1320,
      quietEnd: 420,
      timeZone: 'Africa/Lagos',
      categories: { comments: { inApp: true, email: false } },
    })
    await s.owner.call('PUT', '/api/v1/me/notification-preferences', {
      categories: { comments: { inApp: false, email: false } },
    })
    await bisi.call('POST', `/api/v1/documents/${s.chapter.documentId}/comments`, {
      body: 'Quiet note',
      anchor,
    })
    await s.owner.call('POST', `/api/v1/documents/${s.chapter.documentId}/comments`, {
      body: `@${handle} read this`,
      anchor,
    })
    await run()
    expect((await inbox(s.owner)).items).toHaveLength(0) // comments off
    const [n] = await ctx.db.db.select().from(notifications).where(eq(notifications.userId, bisi.id))
    expect(n).toMatchObject({ emailState: 'pending' })
    // notification emails only (sign-up also sends an address confirmation)
    const toBisi = () =>
      ctx.email.outbox.filter((m) => m.to === bisi.email && !m.subject.startsWith('Confirm your email'))
        .length
    await deliverEmails(ctx.db.db, ctx.email, 'http://localhost:3000', {
      now: new Date('2026-10-19T23:30:00Z'),
    }) // 00:30 in Lagos: Bisi's quiet hours (others' mail still goes)
    expect(toBisi()).toBe(0)
    expect(
      (await ctx.db.db.select().from(notifications).where(eq(notifications.id, n!.id)))[0],
    ).toMatchObject({ emailState: 'pending' })
    await deliverEmails(ctx.db.db, ctx.email, 'http://localhost:3000', {
      now: new Date('2026-10-20T08:00:00Z'),
    }) // 09:00
    expect(ctx.email.outbox.at(-1)).toMatchObject({
      to: bisi.email,
      subject: 'Ama mentioned you on “Chapter 1”',
    })
    expect(ctx.email.outbox.at(-1)!.text).toContain('http://localhost:3000/app/works/')
    expect(
      inQuietHours(new Date('2026-10-19T12:00:00Z'), {
        quietStart: 1320,
        quietEnd: 420,
        timeZone: 'Africa/Lagos',
      }),
    ).toBe(false)
    expect(
      (await bisi.call('PUT', '/api/v1/me/notification-preferences', { timeZone: 'Mars/Olympus' }))
        .statusCode,
    ).toBe(400)
  })

  it('invitations reach the app only for verified addresses, and the inbox accepts them', async () => {
    const s = await scene()
    const unverified = await signUp(ctx.app, 'Una')
    await s.owner.call('POST', `/api/v1/works/${s.workId}/invitations`, {
      email: unverified.email,
      role: 'editor',
    })
    await run()
    expect((await inbox(unverified)).items).toHaveLength(0)
    expect((await unverified.call('GET', '/api/v1/me/invitations')).json()).toEqual({
      items: [],
      verified: false,
    })

    const verified = await signUp(ctx.app, 'Vee')
    await ctx.db.db.update(user).set({ emailVerified: true }).where(eq(user.id, verified.id))
    await s.owner.call('POST', `/api/v1/works/${s.workId}/invitations`, {
      email: verified.email,
      role: 'editor',
    })
    await run()
    expect((await inbox(verified)).items[0]).toMatchObject({
      category: 'invitations',
      title: 'Ama invited you to “The Orchard”',
      url: '/app/invitations',
    })
    const list = (await verified.call('GET', '/api/v1/me/invitations')).json() as { items: { id: string }[] }
    expect(
      (await unverified.call('POST', `/api/v1/me/invitations/${list.items[0]!.id}/accept`, {})).statusCode,
    ).toBe(404) // not yours
    expect(
      (await verified.call('POST', `/api/v1/me/invitations/${list.items[0]!.id}/accept`, {})).json(),
    ).toEqual({ workId: s.workId })
  })

  it('read state, unread count, and no duplicates even when two workers run at once', async () => {
    const s = await scene()
    const bisi = await s.member('viewer', 'Bisi')
    for (let i = 0; i < 3; i++)
      await bisi.call('POST', `/api/v1/documents/${s.chapter.documentId}/comments`, {
        body: `Note ${i}`,
        anchor,
      })
    await Promise.all([run(), run(), run()])
    const box = await inbox(s.owner)
    expect(box.items).toHaveLength(3)
    expect(box.unread).toBe(3)
    expect((await s.owner.call('POST', '/api/v1/me/notifications/read', { all: true })).json()).toEqual({
      count: 0,
    })
    expect((await inbox(s.owner)).items.every((i) => i.read)).toBe(true)
  })
})

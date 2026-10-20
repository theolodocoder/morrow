import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { and, eq } from 'drizzle-orm'
import { activityEvents, profiles, workMembers } from '@morrow/db'
import { setup, signUp } from './setup.ts'

let ctx: Awaited<ReturnType<typeof setup>>
beforeAll(async () => {
  ctx = await setup('feedback')
})
afterAll(async () => {
  await ctx.app.close()
  await ctx.db.pool.end()
})

type User = Awaited<ReturnType<typeof signUp>>
type Thread = {
  id: string
  resolved: unknown
  canResolve: boolean
  comments: {
    id: string
    body: string
    deleted: boolean
    canEdit: boolean
    canDelete: boolean
    mentions: { username: string }[]
  }[]
}
const anchor = {
  start: { type: { client: 1, clock: 0 }, tname: null, item: { client: 7, clock: 3 }, assoc: 0 },
  end: { type: { client: 1, clock: 0 }, tname: null, item: { client: 7, clock: 12 }, assoc: -1 },
  quote: 'palms open',
  blockId: 'b1',
}

async function scene() {
  const owner = await signUp(ctx.app, 'Ama')
  const w = (
    await owner.call('POST', '/api/v1/works', { title: 'The Orchard', category: 'novel' })
  ).json() as { id: string }
  const [c] = (
    (await owner.call('GET', `/api/v1/works/${w.id}/chapters`)).json() as { items: { documentId: string }[] }
  ).items
  const member = async (role: 'editor' | 'contributor' | 'viewer', name: string, username?: string) => {
    const u = await signUp(ctx.app, name)
    await ctx.db.db.insert(workMembers).values({ workId: w.id, userId: u.id, role, grantedBy: owner.id })
    if (username) await ctx.db.db.update(profiles).set({ username }).where(eq(profiles.userId, u.id))
    return u
  }
  return { owner, workId: w.id, doc: c!.documentId, member }
}
const comment = (u: User, doc: string, body: string, a: object = anchor) =>
  u.call('POST', `/api/v1/documents/${doc}/comments`, { body, anchor: a })
const list = async (u: User, doc: string) =>
  ((await u.call('GET', `/api/v1/documents/${doc}/comments`)).json() as { items: Thread[] }).items

describe('inline comments (PRD FR-016)', () => {
  it('readers comment on a passage; replies thread; readers of the document are told to refresh', async () => {
    const s = await scene()
    const reader = await s.member('viewer', 'Beta Reader')
    const res = await comment(reader, s.doc, 'Lovely line.')
    expect(res.statusCode).toBe(201)
    const t = res.json() as Thread
    expect(ctx.feedback.at(-1)).toEqual({ documentId: s.doc, what: 'comments' })
    const replied = (
      await s.owner.call('POST', `/api/v1/comments/${t.id}/replies`, { body: 'Thank you!' })
    ).json() as Thread
    expect(replied.comments.map((c) => c.body)).toEqual(['Lovely line.', 'Thank you!'])
    expect((await list(s.owner, s.doc))[0]).toMatchObject({ anchor: { quote: 'palms open', blockId: 'b1' } })
  })

  it('people without access can’t read or write comments; malformed anchors are refused', async () => {
    const s = await scene()
    await comment(s.owner, s.doc, 'Private note.')
    const stranger = await signUp(ctx.app, 'Stranger')
    expect((await stranger.call('GET', `/api/v1/documents/${s.doc}/comments`)).statusCode).toBe(404)
    expect((await comment(stranger, s.doc, 'hi')).statusCode).toBe(404)
    expect((await comment(s.owner, s.doc, 'x', { ...anchor, start: { evil: '<script>' } })).statusCode).toBe(
      400,
    )
  })

  it('mentions resolve only to people who can read the work', async () => {
    const s = await scene()
    await s.member('editor', 'Kemi', 'kemi')
    const outsider = await signUp(ctx.app, 'Out')
    await ctx.db.db.update(profiles).set({ username: 'outsider' }).where(eq(profiles.userId, outsider.id))
    const t = (await comment(s.owner, s.doc, 'What do you think, @kemi? And @outsider?')).json() as Thread
    expect(t.comments[0]!.mentions.map((m) => m.username)).toEqual(['kemi'])
    const [ev] = await ctx.db.db
      .select()
      .from(activityEvents)
      .where(and(eq(activityEvents.type, 'comment.created'), eq(activityEvents.subjectId, t.id)))
    expect((ev!.data as { mentions: string[] }).mentions).toHaveLength(1)
  })

  it('authors edit and delete their own; editors moderate; only the thread author or a moderator resolves', async () => {
    const s = await scene()
    const contributor = await s.member('contributor', 'Tolu')
    const other = await s.member('contributor', 'Femi')
    const editor = await s.member('editor', 'Kemi')
    const t = (await comment(contributor, s.doc, 'Typo here.')).json() as Thread
    expect(t.comments[0]).toMatchObject({ canEdit: true, canDelete: true })
    expect((await other.call('PATCH', `/api/v1/comments/${t.id}`, { body: 'hijack' })).statusCode).toBe(403)
    expect((await other.call('DELETE', `/api/v1/comments/${t.id}`)).statusCode).toBe(403)
    expect((await other.call('POST', `/api/v1/comments/${t.id}/resolve`)).statusCode).toBe(403)
    expect(
      (await contributor.call('PATCH', `/api/v1/comments/${t.id}`, { body: 'Typo here: “palms”.' })).json(),
    ).toMatchObject({ comments: [{ body: 'Typo here: “palms”.' }] })

    const resolved = (await editor.call('POST', `/api/v1/comments/${t.id}/resolve`)).json() as Thread
    expect(resolved.resolved).toMatchObject({ by: { name: 'Kemi' } })
    // a reply reopens the conversation
    const reopened = (
      await other.call('POST', `/api/v1/comments/${t.id}/replies`, { body: 'Still there in ch. 2.' })
    ).json() as Thread
    expect(reopened.resolved).toBeNull()

    await other.call('POST', `/api/v1/comments/${t.id}/replies`, { body: 'spam' })
    const spam = (await list(s.owner, s.doc))[0]!.comments.at(-1)!
    expect((await editor.call('DELETE', `/api/v1/comments/${spam.id}`)).statusCode).toBe(204)
    const [mod] = await ctx.db.db
      .select()
      .from(activityEvents)
      .where(eq(activityEvents.type, 'comment.moderated'))
    expect(mod).toMatchObject({ actorId: editor.id, subjectId: spam.id })

    // Deleting the first comment keeps the thread (it has replies) but hides the text.
    await contributor.call('DELETE', `/api/v1/comments/${t.id}`)
    const after = (await list(s.owner, s.doc))[0]!
    expect(after.comments[0]).toMatchObject({ deleted: true, body: '' })
  })

  it('a deleted comment with no replies disappears', async () => {
    const s = await scene()
    const t = (await comment(s.owner, s.doc, 'Oops.')).json() as Thread
    await s.owner.call('DELETE', `/api/v1/comments/${t.id}`)
    expect(await list(s.owner, s.doc)).toEqual([])
  })
})

describe('passage reactions (PRD FR-017)', () => {
  it('members react to a paragraph, once per kind; counts aggregate; reactions can be removed', async () => {
    const s = await scene()
    const a = await s.member('viewer', 'A')
    const b = await s.member('viewer', 'B')
    const react = (u: User, kind: string, method: 'PUT' | 'DELETE' = 'PUT') =>
      u.call(method, `/api/v1/documents/${s.doc}/reactions`, { blockId: 'b1', kind })
    await react(a, 'beautiful_line')
    await react(a, 'beautiful_line') // twice is still once
    await react(a, 'plot_twist')
    const r = (await react(b, 'beautiful_line')).json()
    expect(r).toMatchObject({
      counts: { b1: { beautiful_line: 2, plot_twist: 1 } },
      mine: { b1: ['beautiful_line'] },
      canReact: true,
    })
    expect((await react(a, 'plot_twist', 'DELETE')).json()).toMatchObject({
      counts: { b1: { beautiful_line: 2 } },
      mine: { b1: ['beautiful_line'] },
    })
    expect(ctx.feedback.at(-1)).toEqual({ documentId: s.doc, what: 'reactions' })
  })

  it('the owner chooses the vocabulary; turning reactions off hides them and refuses new ones', async () => {
    const s = await scene()
    const a = await s.member('viewer', 'A')
    await s.owner.call('PATCH', `/api/v1/works/${s.workId}`, { reactionKinds: ['moved_me'] })
    expect(
      (await a.call('PUT', `/api/v1/documents/${s.doc}/reactions`, { blockId: 'b1', kind: 'plot_twist' }))
        .statusCode,
    ).toBe(409)
    await a.call('PUT', `/api/v1/documents/${s.doc}/reactions`, { blockId: 'b1', kind: 'moved_me' })
    await s.owner.call('PATCH', `/api/v1/works/${s.workId}`, { reactionKinds: [] })
    expect((await a.call('GET', `/api/v1/documents/${s.doc}/reactions`)).json()).toEqual({
      kinds: [],
      canReact: false,
      counts: {},
      mine: {},
    })
    const stranger = await signUp(ctx.app, 'S')
    expect((await stranger.call('GET', `/api/v1/documents/${s.doc}/reactions`)).statusCode).toBe(404)
  })
})

describe('new-feedback signal and mention suggestions', () => {
  const unread = async (u: User, doc: string) =>
    (await u.call('GET', `/api/v1/documents/${doc}/feedback/unread`)).json() as {
      comments: number
      reactions: number
    }

  it('the owner hears about every new comment and reaction; others only about their threads and mentions', async () => {
    const s = await scene()
    const a = await s.member('contributor', 'Tolu', 'tolu_fb')
    const b = await s.member('viewer', 'Bisi', 'bisi_fb')
    const t = (await comment(a, s.doc, 'First thought.')).json() as Thread
    await b.call('PUT', `/api/v1/documents/${s.doc}/reactions`, { blockId: 'b1', kind: 'plot_twist' })
    expect(await unread(s.owner, s.doc)).toEqual({ comments: 1, reactions: 1 })
    expect(await unread(b, s.doc)).toEqual({ comments: 0, reactions: 0 }) // not their thread
    expect(await unread(a, s.doc)).toEqual({ comments: 0, reactions: 0 }) // their own comment isn't news to them

    await s.owner.call('POST', `/api/v1/comments/${t.id}/replies`, { body: 'Good point.' })
    await comment(s.owner, s.doc, 'What do you think, @bisi_fb?')
    expect(await unread(a, s.doc)).toEqual({ comments: 1, reactions: 0 }) // a reply in their thread
    expect(await unread(b, s.doc)).toEqual({ comments: 1, reactions: 0 }) // mentioned

    // Opening the panel marks it seen.
    expect((await s.owner.call('POST', `/api/v1/documents/${s.doc}/feedback/seen`)).statusCode).toBe(204)
    expect(await unread(s.owner, s.doc)).toEqual({ comments: 0, reactions: 0 })
    await comment(a, s.doc, 'Another.')
    expect(await unread(s.owner, s.doc)).toEqual({ comments: 1, reactions: 0 })
    const stranger = await signUp(ctx.app, 'S')
    expect((await stranger.call('GET', `/api/v1/documents/${s.doc}/feedback/unread`)).statusCode).toBe(404)
  })

  it('suggests only people who can read the work, by username or name, never yourself', async () => {
    const s = await scene()
    await s.member('editor', 'Kemi Adeyemi', 'kemi_a')
    const reader = await s.member('viewer', 'Kelechi', 'kelechi')
    const outsider = await signUp(ctx.app, 'Kenny Outside')
    await ctx.db.db.update(profiles).set({ username: 'kenny_out' }).where(eq(profiles.userId, outsider.id))
    const list = async (u: User, q: string) =>
      (
        (await u.call('GET', `/api/v1/works/${s.workId}/mentionable?q=${q}`)).json() as {
          items: { username: string }[]
        }
      ).items.map((x) => x.username)
    expect(await list(reader, 'ke')).toEqual(['kemi_a'])
    expect(await list(s.owner, 'ke')).toEqual(['kelechi', 'kemi_a'])
    expect(await list(s.owner, 'adey')).toEqual(['kemi_a']) // by name too
    expect((await outsider.call('GET', `/api/v1/works/${s.workId}/mentionable?q=k`)).statusCode).toBe(404)
  })
})

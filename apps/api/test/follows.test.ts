import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import { workMembers } from '@morrow/db'
import { processOutbox } from '../src/notifications.ts'
import { setup, signUp } from './setup.ts'

let ctx: Awaited<ReturnType<typeof setup>>
beforeAll(async () => {
  ctx = await setup('follows')
})
afterAll(async () => {
  await ctx.app.close()
  await ctx.db.pool.end()
})
type User = Awaited<ReturnType<typeof signUp>>

async function author(name = 'Ama') {
  const u = await signUp(ctx.app, name)
  await u.call('PUT', '/api/v1/me/profile', { onboarded: true }) // public profile
  const username = ((await u.call('GET', '/api/v1/me/profile')).json() as { username: string }).username
  return { u, username }
}
async function publishedWork(owner: User, visibility: 'public' | 'unlisted' = 'public') {
  const w = (
    await owner.call('POST', '/api/v1/works', { title: 'The Orchard', category: 'novel' })
  ).json() as { id: string }
  const pub = (await owner.call('POST', `/api/v1/works/${w.id}/publish`, { visibility })).json() as {
    publicPath: string
  }
  return { id: w.id, publicPath: pub.publicPath }
}
const list = async (u: User) =>
  (await u.call('GET', '/api/v1/me/reading-list')).json() as {
    bookmarks: { title: string; publicPath: string | null; appWorkId: string | null }[]
    works: unknown[]
    authors: { username: string }[]
  }

describe('following and bookmarks (PRD FR-022)', () => {
  it('follow authors and works, bookmark, unfollow; state persists in the reading list', async () => {
    const a = await author('Ama')
    const w = await publishedWork(a.u)
    const reader = await signUp(ctx.app, 'Bisi')
    expect(
      (await reader.call('PUT', '/api/v1/me/follows', { type: 'author', username: a.username })).statusCode,
    ).toBe(204)
    await reader.call('PUT', '/api/v1/me/follows', { type: 'author', username: a.username }) // idempotent
    await reader.call('PUT', '/api/v1/me/follows', { type: 'work', publicPath: w.publicPath })
    await reader.call('PUT', '/api/v1/me/bookmarks', { publicPath: w.publicPath })
    expect(
      (await reader.call('GET', `/api/v1/me/follow-state?author=${a.username}&work=${w.publicPath}`)).json(),
    ).toEqual({ followingAuthor: true, followingWork: true, bookmarked: true, liked: false, isMe: false })
    const l = await list(reader)
    expect(l.bookmarks).toMatchObject([{ title: 'The Orchard', publicPath: w.publicPath }])
    expect(l.authors.map((x) => x.username)).toEqual([a.username])
    const page = (
      await ctx.app.inject({ method: 'GET', url: `/api/v1/public/authors/${a.username}` })
    ).json() as { followers: number | null }
    expect(page.followers).toBe(1)

    await reader.call('DELETE', '/api/v1/me/follows', { type: 'author', username: a.username })
    await reader.call('DELETE', '/api/v1/me/bookmarks', { publicPath: w.publicPath })
    expect(await list(reader)).toMatchObject({ bookmarks: [], authors: [] })
  })

  it('you can’t follow what you can’t see, or yourself; follow counts can be private', async () => {
    const a = await author('Ama')
    const reader = await signUp(ctx.app, 'Bisi')
    const draft = (
      await a.u.call('POST', '/api/v1/works', { title: 'Secret', category: 'novel' })
    ).json() as { id: string; publicPath: string }
    expect(
      (await reader.call('PUT', '/api/v1/me/follows', { type: 'work', publicPath: draft.publicPath }))
        .statusCode,
    ).toBe(404)
    expect(
      (await reader.call('PUT', '/api/v1/me/bookmarks', { publicPath: draft.publicPath })).statusCode,
    ).toBe(404)
    expect(
      (await a.u.call('PUT', '/api/v1/me/follows', { type: 'author', username: a.username })).statusCode,
    ).toBe(409)
    const unboarded = await signUp(ctx.app, 'Hidden') // profile not public until onboarding
    const handle = ((await unboarded.call('GET', '/api/v1/me/profile')).json() as { username: string })
      .username
    expect(
      (await reader.call('PUT', '/api/v1/me/follows', { type: 'author', username: handle })).statusCode,
    ).toBe(404)
    await a.u.call('PUT', '/api/v1/me/profile', { showFollows: false })
    expect(
      (
        (await ctx.app.inject({ method: 'GET', url: `/api/v1/public/authors/${a.username}` })).json() as {
          followers: unknown
        }
      ).followers,
    ).toBeNull()
  })

  it('a bookmarked work that goes private leaves the list, unless you’re a member', async () => {
    const a = await author('Ama')
    const w = await publishedWork(a.u)
    const reader = await signUp(ctx.app, 'Bisi')
    const member = await signUp(ctx.app, 'Kemi')
    await ctx.db.db
      .insert(workMembers)
      .values({ workId: w.id, userId: member.id, role: 'viewer', grantedBy: a.u.id })
    for (const u of [reader, member])
      await u.call('PUT', '/api/v1/me/bookmarks', { publicPath: w.publicPath })
    await a.u.call('PATCH', `/api/v1/works/${w.id}`, { visibility: 'private' })
    expect((await list(reader)).bookmarks).toEqual([])
    expect((await list(member)).bookmarks).toMatchObject([
      { title: 'The Orchard', publicPath: null, appWorkId: w.id },
    ])
    await ctx.db.db.delete(workMembers).where(eq(workMembers.userId, member.id))
    expect((await list(member)).bookmarks).toEqual([])
  })

  it('followers hear when a public work is published; link-only works don’t tell the author’s followers', async () => {
    const a = await author('Ama')
    const fan = await signUp(ctx.app, 'Fan')
    await fan.call('PUT', '/api/v1/me/follows', { type: 'author', username: a.username })
    await processOutbox(ctx.db.db)
    const w = await publishedWork(a.u, 'unlisted')
    await processOutbox(ctx.db.db)
    const inbox = async () =>
      (
        (await fan.call('GET', '/api/v1/me/notifications')).json() as {
          items: { title: string; url: string }[]
        }
      ).items
    expect(await inbox()).toEqual([])
    await a.u.call('POST', `/api/v1/works/${w.id}/publish`, { visibility: 'public' })
    await processOutbox(ctx.db.db)
    expect((await inbox())[0]).toMatchObject({
      title: 'Ama published “The Orchard”',
      url: `/works/${w.publicPath}`,
    })
  })
})

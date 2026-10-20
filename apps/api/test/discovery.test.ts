import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { eq, sql } from 'drizzle-orm'
import { featuredWorks, workMembers, works } from '@morrow/db'
import { setup, signUp } from './setup.ts'

let ctx: Awaited<ReturnType<typeof setup>>
beforeAll(async () => {
  ctx = await setup('discovery')
})
afterAll(async () => {
  await ctx.app.close()
  await ctx.db.pool.end()
})
type User = Awaited<ReturnType<typeof signUp>>
type W = { title: string; publicPath: string; note?: string; collaborators: number }
const pub = (path: string) => ctx.app.inject({ method: 'GET', url: `/api/v1/public${path}` })
const titles = (ws: W[]) => ws.map((w) => w.title)

async function work(
  owner: User,
  title: string,
  opts: {
    category?: string
    description?: string
    tags?: string[]
    visibility?: 'public' | 'unlisted' | null
  } = {},
) {
  const w = (
    await owner.call('POST', '/api/v1/works', { title, category: opts.category ?? 'novel' })
  ).json() as { id: string }
  if (opts.description || opts.tags)
    await owner.call('PATCH', `/api/v1/works/${w.id}`, { description: opts.description, tags: opts.tags })
  const visibility = opts.visibility === undefined ? 'public' : opts.visibility
  const p = visibility
    ? ((await owner.call('POST', `/api/v1/works/${w.id}/publish`, { visibility })).json() as {
        publicPath: string
      })
    : null
  return { id: w.id, publicPath: p?.publicPath ?? '' }
}

let owner: User
let ids: Record<string, { id: string; publicPath: string }>
beforeAll(async () => {
  owner = await signUp(ctx.app, 'Ama Owusu')
  await owner.call('PUT', '/api/v1/me/profile', { onboarded: true })
  ids = {
    orchard: await work(owner, 'The Salt Orchard', {
      description: 'Grief grows in the roots.',
      tags: ['grief', 'family'],
    }),
    poems: await work(owner, 'Tidewater Poems', { category: 'poetry', tags: ['sea'] }),
    linkOnly: await work(owner, 'Unlisted Orchard Notes', { visibility: 'unlisted' }),
    draft: await work(owner, 'Orchard Draft', { visibility: null }),
    hidden: await work(owner, 'Hidden Orchard'),
    deleted: await work(owner, 'Deleted Orchard'),
  }
  await ctx.db.db
    .update(works)
    .set({ hiddenAt: sql`now()` })
    .where(eq(works.id, ids.hidden!.id))
  await owner.call('DELETE', `/api/v1/works/${ids.deleted!.id}`)
})

describe('discovery (PRD FR-020)', () => {
  it('shows only works anyone may find: never unlisted, private, unpublished, hidden or deleted', async () => {
    const d = (await pub('/discover')).json() as { recent: W[]; topics: { tag: string }[] }
    expect(titles(d.recent).sort()).toEqual(['The Salt Orchard', 'Tidewater Poems'])
    expect(d.topics.map((t) => t.tag).sort()).toEqual(['family', 'grief', 'sea'])
  })

  it('filters by category and by tag', async () => {
    expect(titles(((await pub('/discover?category=poetry')).json() as { recent: W[] }).recent)).toEqual([
      'Tidewater Poems',
    ])
    expect(titles(((await pub('/discover?tag=grief')).json() as { recent: W[] }).recent)).toEqual([
      'The Salt Orchard',
    ])
  })

  it('keeps editorial picks and algorithmic ranking apart', async () => {
    await ctx.db.db
      .insert(featuredWorks)
      .values({ workId: ids.poems!.id, note: 'Read it aloud.', featuredBy: owner.id })
      .onConflictDoNothing()
    const fan = await signUp(ctx.app, 'Fan')
    await fan.call('PUT', '/api/v1/me/follows', { type: 'work', publicPath: ids.orchard!.publicPath })
    const d = (await pub('/discover')).json() as { featured: W[]; popular: W[] }
    expect(d.featured).toMatchObject([{ title: 'Tidewater Poems', note: 'Read it aloud.' }])
    expect(titles(d.popular)).toEqual(['The Salt Orchard'])
  })

  it('collaborative projects are works with more than one person', async () => {
    const kemi = await signUp(ctx.app, 'Kemi')
    await ctx.db.db
      .insert(workMembers)
      .values({ workId: ids.orchard!.id, userId: kemi.id, role: 'editor', grantedBy: owner.id })
    const d = (await pub('/discover')).json() as { collaborative: W[] }
    expect(d.collaborative).toMatchObject([{ title: 'The Salt Orchard', collaborators: 2 }])
  })

  it('the following feed shows releases from followed writers', async () => {
    const reader = await signUp(ctx.app, 'Reader')
    const handle = ((await owner.call('GET', '/api/v1/me/profile')).json() as { username: string }).username
    await reader.call('PUT', '/api/v1/me/follows', { type: 'author', username: handle })
    const feed = (await reader.call('GET', '/api/v1/me/feed')).json() as { items: W[] }
    expect(titles(feed.items).sort()).toEqual(['The Salt Orchard', 'Tidewater Poems'])
  })
})

describe('search (PRD FR-021)', () => {
  const search = async (q: string) =>
    (await pub(`/search?${q}`)).json() as { works: W[]; authors: { displayName: string }[]; hasMore: boolean }

  it('finds titles, descriptions and tags; never what isn’t findable', async () => {
    expect(titles((await search('q=orchard')).works)).toEqual(['The Salt Orchard'])
    expect(titles((await search('q=roots')).works)).toEqual(['The Salt Orchard']) // description
    expect(titles((await search('q=sea')).works)).toEqual(['Tidewater Poems']) // tag
    expect(titles((await search('q=orchard&category=poetry')).works)).toEqual([])
  })

  it('finds authors by name; handles anything a person might type', async () => {
    expect((await search('q=ama')).authors.map((a) => a.displayName)).toEqual(['Ama Owusu'])
    for (const q of ['"unterminated', '-(', 'or or', ':*&|!', '%', '_', "'; drop table works; --"]) {
      const res = await pub(`/search?q=${encodeURIComponent(q)}`)
      expect(res.statusCode).toBe(200)
    }
    expect((await search(`q=${encodeURIComponent('%')}`)).authors).toEqual([]) // wildcards are literal
  })

  it('sorts and paginates', async () => {
    const r = await search('sort=recent')
    expect(titles(r.works)).toEqual(['Tidewater Poems', 'The Salt Orchard'])
    expect(r.hasMore).toBe(false)
    expect((await pub('/search?page=51')).statusCode).toBe(400)
  })
})

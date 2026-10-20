import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { workViews } from '@morrow/db'
import { setup, signUp } from './setup.ts'

let ctx: Awaited<ReturnType<typeof setup>>
beforeAll(async () => {
  ctx = await setup('dashboard')
})
afterAll(async () => {
  await ctx.app.close()
  await ctx.db.pool.end()
})

type User = Awaited<ReturnType<typeof signUp>>
type Metric = { current: number; previous: number }
type Dash = {
  days: number
  profile: { username: string; followers: number; following: number; publishedWorks: number }
  totals: Record<'reads' | 'likes' | 'comments' | 'followers' | 'saves' | 'profileViews', Metric>
  daily: { day: string; reads: number; likes: number; followers: number; profileViews: number }[]
  works: {
    title: string
    readsInPeriod: number
    likes: number
    comments: number
    saves: number
    workFollowers: number
  }[]
  activity: {
    kind: string
    person: { displayName: string }
    work: { title: string } | null
    followingBack: boolean | null
  }[]
}

async function person(name: string) {
  const u = await signUp(ctx.app, name)
  await u.call('PUT', '/api/v1/me/profile', { onboarded: true })
  const username = ((await u.call('GET', '/api/v1/me/profile')).json() as { username: string }).username
  return Object.assign(u, { username })
}
async function publish(owner: User, title: string) {
  const w = (await owner.call('POST', '/api/v1/works', { title, category: 'essay' })).json() as { id: string }
  const p = (await owner.call('POST', `/api/v1/works/${w.id}/publish`, { visibility: 'public' })).json() as {
    publicPath: string
  }
  return { id: w.id, publicPath: p.publicPath }
}
const view = (path: string, ip: string, cookie?: string) =>
  ctx.app.inject({
    method: 'POST',
    url: `/api/v1/public${path}`,
    headers: {
      'user-agent': 'Mozilla/5.0',
      'x-forwarded-for': ip,
      origin: 'http://localhost:3000',
      ...(cookie ? { cookie } : {}),
    },
  })

describe('the writer’s dashboard', () => {
  it('counts reads, likes, comments, follows, saves and profile views; compares with the period before', async () => {
    const ama = await person('Ama Dash')
    const bo = await person('Bo Reader')
    const pest = await person('Pest Reader')
    const big = await publish(ama, 'The Big Essay')
    const small = await publish(ama, 'The Small Essay')

    // This week
    await bo.call('PUT', `/api/v1/reading/${big.publicPath}/like`)
    await ama.call('PUT', `/api/v1/reading/${big.publicPath}/like`) // your own like doesn't count
    await bo.call('POST', `/api/v1/reading/${big.publicPath}/comments`, { body: 'This changed my mind.' })
    await bo.call('PUT', '/api/v1/me/follows', { type: 'author', username: ama.username })
    await bo.call('PUT', '/api/v1/me/follows', { type: 'work', publicPath: small.publicPath })
    await bo.call('PUT', '/api/v1/me/bookmarks', { publicPath: big.publicPath })
    await view(`/reading/${big.publicPath}/view`, '203.0.113.1')
    await view(`/reading/${big.publicPath}/view`, '203.0.113.2')
    await view(`/reading/${small.publicPath}/view`, '203.0.113.1')
    await view(`/authors/${ama.username}/view`, '203.0.113.3')
    await view(`/authors/${ama.username}/view`, '203.0.113.3') // same visitor, same day
    await ama.call('POST', `/api/v1/public/authors/${ama.username}/view`) // your own visit doesn't count
    // Last week: three reads of the big essay
    const lastWeek = new Date(Date.now() - 9 * 86400_000).toISOString().slice(0, 10)
    await ctx.db.db
      .insert(workViews)
      .values(['x1', 'x2', 'x3'].map((viewer) => ({ workId: big.id, viewer, day: lastWeek })))
    // Someone Ama blocks: their activity counts, but they don't appear by name
    await pest.call('PUT', `/api/v1/reading/${small.publicPath}/like`)
    await ama.call('PUT', '/api/v1/me/blocks', { username: pest.username })

    const res = await ama.call('GET', '/api/v1/me/dashboard?days=7')
    expect(res.statusCode).toBe(200)
    const d = res.json() as Dash
    expect(d.profile).toMatchObject({ username: ama.username, followers: 1, publishedWorks: 2 })
    expect(d.totals.reads).toEqual({ current: 3, previous: 3 })
    expect(d.totals.likes.current).toBe(2) // Bo and the blocked person; never Ama's own
    expect(d.totals.comments.current).toBe(1)
    expect(d.totals.followers.current).toBe(1)
    expect(d.totals.saves.current).toBe(1)
    expect(d.totals.profileViews.current).toBe(1)
    expect(d.daily).toHaveLength(7)
    expect(d.daily.at(-1)).toMatchObject({ reads: 3, followers: 1, profileViews: 1 })

    expect(d.works.map((w) => w.title)).toEqual(['The Big Essay', 'The Small Essay'])
    expect(d.works[0]).toMatchObject({ readsInPeriod: 2, likes: 2, comments: 1, saves: 1 })
    expect(d.works[1]).toMatchObject({ workFollowers: 1 })

    const kinds = d.activity.map((a) => `${a.kind}:${a.person.displayName}`)
    expect(kinds).toEqual(
      expect.arrayContaining([
        'like:Bo Reader',
        'comment:Bo Reader',
        'follow:Bo Reader',
        'work_follow:Bo Reader',
      ]),
    )
    expect(kinds.some((k) => k.includes('Pest'))).toBe(false)
    expect(kinds.some((k) => k.includes('Ama'))).toBe(false)
    expect(d.activity.find((a) => a.kind === 'follow')?.followingBack).toBe(false)
  })

  it('only 7, 30 or 90 days; signed in only', async () => {
    const ama = await person('Ama Period')
    expect((await ama.call('GET', '/api/v1/me/dashboard?days=12')).statusCode).toBe(400)
    expect(((await ama.call('GET', '/api/v1/me/dashboard')).json() as Dash).daily).toHaveLength(30)
    expect((await ctx.app.inject({ method: 'GET', url: '/api/v1/me/dashboard' })).statusCode).toBe(401)
  })
})

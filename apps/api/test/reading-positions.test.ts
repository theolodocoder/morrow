import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { ORIGIN, setup, signUp } from './setup.ts'

let ctx: Awaited<ReturnType<typeof setup>>
beforeAll(async () => {
  ctx = await setup('reading_positions')
})
afterAll(async () => {
  await ctx.app.close()
  await ctx.db.pool.end()
})

type User = Awaited<ReturnType<typeof signUp>>
type Page = { chapters: { slug: string }[]; versions: { chapters: { slug: string }[] }[] }

/** A published three-chapter story, as readers see it. */
async function published() {
  const owner = await signUp(ctx.app, 'Ama Owner')
  const w = (await owner.call('POST', '/api/v1/works', { title: 'The Salt Orchard' })).json() as {
    id: string
    defaultBranchId: string
  }
  await owner.call('POST', `/api/v1/works/${w.id}/chapters`, { title: 'Chapter 2' })
  await owner.call('POST', `/api/v1/works/${w.id}/chapters`, { title: 'Chapter 3' })
  const pub = await owner.call('POST', `/api/v1/works/${w.id}/publish`, { visibility: 'public' })
  expect(pub.statusCode).toBe(200)
  const path = (pub.json() as { publicPath: string }).publicPath
  const page = (await ctx.app.inject({ method: 'GET', url: `/api/v1/public/works/${path}` })).json() as Page
  return { owner, w, path, slugs: page.chapters.map((c) => c.slug) }
}

const url = (path: string) => `/api/v1/me/reading/${path}/positions`
const save = (u: User, path: string, items: object[]) => u.call('PUT', url(path), { items })
const load = async (u: User, path: string) => {
  const res = await u.call('GET', url(path))
  expect(res.statusCode).toBe(200)
  return res.json() as {
    items: { chapterSlug: string; blockId: string | null; percent: number }[]
    last: string
  }
}

describe('reading positions', () => {
  it('saves and returns them, with the chapter read last', async () => {
    const s = await published()
    const reader = await signUp(ctx.app, 'Reader')
    expect(
      (
        await save(reader, s.path, [
          { chapterSlug: s.slugs[0], blockId: 'p-9', percent: 100 },
          { chapterSlug: s.slugs[1], blockId: 'p-3', percent: 40 },
        ])
      ).statusCode,
    ).toBe(204)
    expect(await load(reader, s.path)).toEqual({
      items: [
        { chapterSlug: s.slugs[0], blockId: 'p-9', percent: 100 },
        { chapterSlug: s.slugs[1], blockId: 'p-3', percent: 40 },
      ],
      last: s.slugs[1],
    })
    // going back to chapter one makes it the one to continue
    await save(reader, s.path, [{ chapterSlug: s.slugs[0], blockId: 'p-1', percent: 5 }])
    expect((await load(reader, s.path)).last).toBe(s.slugs[0])
  })

  it('a lower percent does not overwrite a higher one; a higher one moves the paragraph on', async () => {
    const s = await published()
    const reader = await signUp(ctx.app, 'Reader')
    await save(reader, s.path, [{ chapterSlug: s.slugs[0], blockId: 'p-7', percent: 70 }])
    await save(reader, s.path, [{ chapterSlug: s.slugs[0], blockId: 'p-2', percent: 20 }])
    expect((await load(reader, s.path)).items).toEqual([
      { chapterSlug: s.slugs[0], blockId: 'p-7', percent: 70 },
    ])
    // the same chapter twice in one save: the furthest counts
    await save(reader, s.path, [
      { chapterSlug: s.slugs[0], blockId: 'p-9', percent: 90 },
      { chapterSlug: s.slugs[0], blockId: 'p-8', percent: 80 },
    ])
    expect((await load(reader, s.path)).items).toEqual([
      { chapterSlug: s.slugs[0], blockId: 'p-9', percent: 90 },
    ])
  })

  it('a tie without a paragraph keeps the stored one', async () => {
    const s = await published()
    const reader = await signUp(ctx.app, 'Reader')
    await save(reader, s.path, [{ chapterSlug: s.slugs[0], blockId: 'p-5', percent: 40 }])
    await save(reader, s.path, [{ chapterSlug: s.slugs[0], blockId: null, percent: 40 }])
    expect((await load(reader, s.path)).items).toEqual([
      { chapterSlug: s.slugs[0], blockId: 'p-5', percent: 40 },
    ])
  })

  it('each reader sees only their own', async () => {
    const s = await published()
    const a = await signUp(ctx.app, 'Reader A')
    const b = await signUp(ctx.app, 'Reader B')
    await save(a, s.path, [{ chapterSlug: s.slugs[2], blockId: 'p-4', percent: 50 }])
    expect(await load(b, s.path)).toEqual({ items: [], last: null })
    await save(b, s.path, [{ chapterSlug: s.slugs[2], blockId: 'p-1', percent: 10 }])
    expect((await load(a, s.path)).items).toEqual([{ chapterSlug: s.slugs[2], blockId: 'p-4', percent: 50 }])
    expect((await load(b, s.path)).items).toEqual([{ chapterSlug: s.slugs[2], blockId: 'p-1', percent: 10 }])
  })

  it('ignores chapters it does not know, keeping the rest', async () => {
    const s = await published()
    const reader = await signUp(ctx.app, 'Reader')
    const res = await save(reader, s.path, [
      { chapterSlug: 'a-removed-chapter-zzzzzz', blockId: 'p-1', percent: 90 },
      { chapterSlug: 'abc', blockId: null, percent: 90 },
      { chapterSlug: s.slugs[0], blockId: null, percent: 30 },
    ])
    expect(res.statusCode).toBe(204)
    expect((await load(reader, s.path)).items).toEqual([
      { chapterSlug: s.slugs[0], blockId: null, percent: 30 },
    ])
  })

  it('remembers a chapter of an alternate version', async () => {
    const s = await published()
    const main = (await s.owner.call('GET', `/api/v1/works/${s.w.id}/chapters`)).json().items as {
      id: string
    }[]
    const b = (
      await s.owner.call('POST', `/api/v1/works/${s.w.id}/branches`, {
        name: 'If She Stayed',
        description: 'What if Ama stays?',
        fromBranchId: s.w.defaultBranchId,
        divergesAtChapterId: main[2]!.id,
      })
    ).json() as { id: string }
    expect(
      (await s.owner.call('POST', `/api/v1/works/${s.w.id}/branches/${b.id}/publish-alternate`, {}))
        .statusCode,
    ).toBe(200)
    const page = (
      await ctx.app.inject({ method: 'GET', url: `/api/v1/public/works/${s.path}` })
    ).json() as Page
    const alt = page.versions[0]!.chapters[0]!.slug
    const reader = await signUp(ctx.app, 'Reader')
    await save(reader, s.path, [{ chapterSlug: alt, blockId: 'p-2', percent: 25 }])
    expect(await load(reader, s.path)).toEqual({
      items: [{ chapterSlug: alt, blockId: 'p-2', percent: 25 }],
      last: alt,
    })
  })

  it('rejects bad input and works readers cannot open', async () => {
    const s = await published()
    const reader = await signUp(ctx.app, 'Reader')
    const many = Array.from({ length: 51 }, () => ({ chapterSlug: s.slugs[0], blockId: null, percent: 1 }))
    expect((await save(reader, s.path, many)).statusCode).toBe(400)
    expect(
      (await save(reader, s.path, [{ chapterSlug: s.slugs[0], blockId: null, percent: 101 }])).statusCode,
    ).toBe(400)
    expect((await reader.call('GET', url('no-such-work-0123456789'))).statusCode).toBe(404)
    await s.owner.call('PATCH', `/api/v1/works/${s.w.id}`, { visibility: 'private' })
    expect((await reader.call('GET', url(s.path))).statusCode).toBe(404)
  })

  it('signed out → 401', async () => {
    const s = await published()
    const get = await ctx.app.inject({ method: 'GET', url: url(s.path) })
    expect(get.statusCode).toBe(401)
    const put = await ctx.app.inject({
      method: 'PUT',
      url: url(s.path),
      headers: { origin: ORIGIN },
      payload: { items: [{ chapterSlug: s.slugs[0], blockId: null, percent: 10 }] },
    })
    expect(put.statusCode).toBe(401)
  })
})

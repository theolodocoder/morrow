import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import { documentProjections } from '@morrow/db'
import { processOutbox } from '../src/notifications.ts'
import { setup, signUp } from './setup.ts'

let ctx: Awaited<ReturnType<typeof setup>>
beforeAll(async () => {
  ctx = await setup('participation')
})
afterAll(async () => {
  await ctx.app.close()
  await ctx.db.pool.end()
})
type User = Awaited<ReturnType<typeof signUp>>
const para = (id: string, text: string) => ({
  type: 'paragraph',
  attrs: { id },
  content: [{ type: 'text', text }],
})
async function write(documentId: string, workId: string, text: string) {
  const v = {
    documentId,
    workId,
    contentJson: { type: 'doc', content: [para('a', text)] },
    plainText: text,
    wordCount: 4,
    sourceRevision: Date.now(),
  }
  await ctx.db.db
    .insert(documentProjections)
    .values(v)
    .onConflictDoUpdate({ target: documentProjections.documentId, set: v })
}

/** A public work, published, then drafted further (the draft must never reach outsiders). */
async function openWork(participation: 'none' | 'propose' = 'propose') {
  const owner = await signUp(ctx.app, 'Ama')
  await owner.call('PUT', '/api/v1/me/profile', { onboarded: true })
  const w = (
    await owner.call('POST', '/api/v1/works', { title: 'The Orchard', category: 'novel' })
  ).json() as { id: string }
  const [c] = (
    (await owner.call('GET', `/api/v1/works/${w.id}/chapters`)).json() as {
      items: { id: string; documentId: string }[]
    }
  ).items
  await owner.call('PATCH', `/api/v1/chapters/${c!.id}`, { title: 'First Frost' })
  await write(c!.documentId, w.id, 'Published words here.')
  const pub = (
    await owner.call('POST', `/api/v1/works/${w.id}/publish`, { visibility: 'public' })
  ).json() as { publicPath: string }
  await owner.call('PATCH', `/api/v1/works/${w.id}`, { participation })
  await write(c!.documentId, w.id, 'SECRET DRAFT words.')
  await owner.call('PATCH', `/api/v1/chapters/${c!.id}`, { title: 'Spoiler Title' })
  const page = (
    await ctx.app.inject({ method: 'GET', url: `/api/v1/public/works/${pub.publicPath}` })
  ).json() as { chapters: { slug: string }[]; openToSuggestions: boolean }
  return {
    owner,
    workId: w.id,
    chapter: c!,
    publicPath: pub.publicPath,
    slug: page.chapters[0]!.slug,
    open: page.openToSuggestions,
  }
}
const suggest = (u: User, s: { publicPath: string; slug: string }) =>
  u.call('POST', '/api/v1/suggestions', {
    publicPath: s.publicPath,
    chapterSlug: s.slug,
    title: 'A kinder line',
    explanation: 'Gentler.',
  })
type D = {
  id: string
  viewerSeesDrafts: boolean
  actions: string[]
  workspaceDocumentId: string
  chapter: { title: string }
  review: { classification: unknown; chapterVersions: object; changes: unknown[] }
}

describe('public participation (M6)', () => {
  it('anyone signed in suggests from the published text; nothing unpublished ever reaches them', async () => {
    const s = await openWork()
    expect(s.open).toBe(true)
    const stranger = await signUp(ctx.app, 'Tolu')
    const res = await suggest(stranger, s)
    expect(res.statusCode).toBe(201)
    const d = res.json() as D
    expect(d).toMatchObject({
      viewerSeesDrafts: false,
      actions: ['edit', 'submit', 'withdraw'],
      chapter: { title: 'First Frost' },
    })
    expect(d.review).toMatchObject({ classification: null, chapterVersions: {} })
    const [ws] = await ctx.db.db
      .select()
      .from(documentProjections)
      .where(eq(documentProjections.documentId, d.workspaceDocumentId))
    expect(JSON.stringify(ws!.contentJson)).toContain('Published words here.')
    expect(JSON.stringify(res.json())).not.toMatch(/SECRET|Spoiler/)
    expect(
      (
        (
          await stranger.call('POST', '/api/v1/collab/tickets', { documentId: d.workspaceDocumentId })
        ).json() as { mode: string }
      ).mode,
    ).toBe('edit')
    expect((await stranger.call('POST', `/api/v1/proposals/${d.id}/refresh`, {})).statusCode).toBe(403) // would pour the draft in
    expect((await stranger.call('GET', `/api/v1/works/${s.workId}/chapters`)).statusCode).toBe(404)
    const mine = (await stranger.call('GET', '/api/v1/me/proposals')).json() as {
      items: { chapter: { title: string } }[]
    }
    expect(mine.items[0]!.chapter.title).toBe('First Frost')
  })

  it('only where the owner invites it, on public works, never by the owner, never across a block', async () => {
    const closed = await openWork('none')
    const stranger = await signUp(ctx.app, 'Tolu')
    expect((await suggest(stranger, closed)).statusCode).toBe(403)
    const s = await openWork()
    expect((await suggest(s.owner, s)).statusCode).toBe(409)
    await s.owner.call('PUT', '/api/v1/me/blocks', {
      username: ((await stranger.call('GET', '/api/v1/me/profile')).json() as { username: string }).username,
    })
    expect((await suggest(stranger, s)).statusCode).toBe(403)
    await s.owner.call('PATCH', `/api/v1/works/${s.workId}`, { visibility: 'unlisted' })
    const other = await signUp(ctx.app, 'Kemi')
    expect((await suggest(other, s)).statusCode).toBe(403) // link-only works aren't open to strangers
    await s.owner.call('PATCH', `/api/v1/works/${s.workId}`, { visibility: 'private' })
    expect((await suggest(other, s)).statusCode).toBe(404)
  })

  it('the owner reviews with the live comparison, accepts, and the outsider is told and credited', async () => {
    const s = await openWork()
    const stranger = await signUp(ctx.app, 'Tolu')
    const d = (await suggest(stranger, s)).json() as D
    await stranger.call('POST', `/api/v1/proposals/${d.id}/submit`, {})
    const ownerView = (await s.owner.call('GET', `/api/v1/proposals/${d.id}`)).json() as D
    expect(ownerView).toMatchObject({ viewerSeesDrafts: true, review: { classification: { kind: 'clean' } } })
    await s.owner.call('POST', `/api/v1/proposals/${d.id}/accept`, { note: 'Thank you!' })
    await processOutbox(ctx.db.db)
    const inbox = (await stranger.call('GET', '/api/v1/me/notifications')).json() as {
      items: { title: string }[]
    }
    expect(inbox.items.find((n) => !n.title.startsWith('You earned a badge'))!.title).toBe(
      'Ama accepted your proposal “A kinder line”',
    )
    await s.owner.call('POST', `/api/v1/works/${s.workId}/publish`, {})
    const page = (
      await ctx.app.inject({ method: 'GET', url: `/api/v1/public/works/${s.publicPath}` })
    ).json() as { contributors: { displayName: string }[] }
    expect(page.contributors.map((c) => c.displayName)).toContain('Tolu')
  })

  it('after the owner closes participation, the outsider can still see and withdraw theirs', async () => {
    const s = await openWork()
    const stranger = await signUp(ctx.app, 'Tolu')
    const d = (await suggest(stranger, s)).json() as D
    await s.owner.call('PATCH', `/api/v1/works/${s.workId}`, { participation: 'none' })
    expect(((await stranger.call('GET', `/api/v1/proposals/${d.id}`)).json() as D).actions).toEqual([
      'withdraw',
    ])
    expect((await stranger.call('POST', `/api/v1/proposals/${d.id}/withdraw`, {})).statusCode).toBe(200)
  })

  it('a conflicting outside suggestion can still be accepted, explicitly, using its wording where both changed', async () => {
    const s = await openWork()
    const stranger = await signUp(ctx.app, 'Tolu')
    const d = (await suggest(stranger, s)).json() as D
    await stranger.call('POST', `/api/v1/proposals/${d.id}/submit`, {})
    ctx.engine.classification = { kind: 'conflict', blockIds: ['a'], gaps: [] }
    expect((await s.owner.call('POST', `/api/v1/proposals/${d.id}/accept`, {})).statusCode).toBe(409) // never silently
    const r = await s.owner.call('POST', `/api/v1/proposals/${d.id}/accept`, {
      resolve: 'use_proposal',
      note: 'Taking your wording.',
    })
    expect(r.json()).toMatchObject({ status: 'accepted' })
    ctx.engine.classification = { kind: 'clean' }
  })
})

describe('story chains (P-061)', () => {
  it('a reader offers the next chapter; accepted, it joins the work as a new chapter, credited to them', async () => {
    const s = await openWork('propose')
    const tolu = await signUp(ctx.app, 'Tolu Chain')
    const res = await tolu.call('POST', '/api/v1/suggestions', {
      publicPath: s.publicPath,
      kind: 'chapter',
      title: 'Second Frost',
      explanation: 'Where it goes next.',
      body: 'The orchard woke white.\n\nNobody spoke of the salt.',
    })
    expect(res.statusCode).toBe(201)
    const p = res.json() as { id: string; kind: string; actions: string[] }
    expect(p.kind).toBe('chapter')
    // a chapter needs its text
    expect(
      (
        await tolu.call('POST', '/api/v1/suggestions', {
          publicPath: s.publicPath,
          kind: 'chapter',
          title: 'Empty',
        })
      ).statusCode,
    ).toBe(400)
    expect((await tolu.call('POST', `/api/v1/proposals/${p.id}/submit`, {})).statusCode).toBe(200)
    const accepted = await s.owner.call(
      'POST',
      `/api/v1/proposals/${p.id}/accept`,
      { note: 'Yes!' },
      { 'idempotency-key': crypto.randomUUID() },
    )
    expect(accepted.statusCode).toBe(200)
    const chapters = (
      (await s.owner.call('GET', `/api/v1/works/${s.workId}/chapters`)).json() as {
        items: { title: string; documentId: string }[]
      }
    ).items
    expect(chapters.map((c) => c.title)).toEqual(['Spoiler Title', 'Second Frost'])
    const [proj] = await ctx.db.db
      .select()
      .from(documentProjections)
      .where(eq(documentProjections.documentId, chapters[1]!.documentId))
    expect(JSON.stringify(proj?.contentJson)).toContain('Nobody spoke of the salt.')
  })
})

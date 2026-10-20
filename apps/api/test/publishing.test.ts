import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import { activityEvents, documentProjections, editSessions, profiles, workMembers } from '@morrow/db'
import { setup, signUp } from './setup.ts'

let ctx: Awaited<ReturnType<typeof setup>>
beforeAll(async () => {
  ctx = await setup('publishing')
})
afterAll(async () => {
  await ctx.app.close()
  await ctx.db.pool.end()
})

type User = Awaited<ReturnType<typeof signUp>>
type Work = { id: string; publicPath: string }
const work = async (owner: User) =>
  (await owner.call('POST', '/api/v1/works', { title: 'The Orchard', category: 'novel' })).json() as Work
const chaptersOf = async (u: User, workId: string) =>
  (
    (await u.call('GET', `/api/v1/works/${workId}/chapters`)).json() as {
      items: { id: string; documentId: string; title: string }[]
    }
  ).items
const paragraph = (text: string) => ({
  type: 'doc',
  content: [{ type: 'paragraph', content: [{ type: 'text', text }] }],
})
/** Stand-in for collab writing a projection after an edit. */
async function write(documentId: string, workId: string, text: string) {
  const v = {
    documentId,
    workId,
    contentJson: paragraph(text),
    plainText: text,
    wordCount: text.split(/\s+/).length,
    sourceRevision: Date.now(),
  }
  await ctx.db.db
    .insert(documentProjections)
    .values(v)
    .onConflictDoUpdate({ target: documentProjections.documentId, set: v })
}
const anon = (path: string) => ctx.app.inject({ method: 'GET', url: `/api/v1/public${path}` })

describe('publishing and public reading (PRD FR-023)', () => {
  it('a private work cannot be published, and nothing about it is readable', async () => {
    const owner = await signUp(ctx.app)
    const w = await work(owner)
    expect((await owner.call('POST', `/api/v1/works/${w.id}/publish`, {})).statusCode).toBe(409)
    expect((await anon(`/works/${w.publicPath}`)).statusCode).toBe(404)
  })

  it('readers see the published snapshot, never later edits, renames or new chapters', async () => {
    const owner = await signUp(ctx.app)
    const w = await work(owner)
    const [c] = await chaptersOf(owner, w.id)
    await owner.call('PATCH', `/api/v1/chapters/${c!.id}`, { title: 'First Frost' })
    await write(c!.documentId, w.id, 'The first frost came early that year.')
    const pub = await owner.call('POST', `/api/v1/works/${w.id}/publish`, { visibility: 'public' })
    expect(pub.json()).toMatchObject({ published: true, visibility: 'public', chapterCount: 1 })

    // keep drafting after publishing
    await write(c!.documentId, w.id, 'SECRET DRAFT that must not leak.')
    await owner.call('PATCH', `/api/v1/chapters/${c!.id}`, { title: 'Spoiler Title' })
    await owner.call('POST', `/api/v1/works/${w.id}/chapters`, { title: 'Unreleased' })

    const page = (await anon(`/works/${w.publicPath}`)).json() as {
      chapters: { title: string; slug: string }[]
      indexable: boolean
      author: { displayName: string }
    }
    expect(page.chapters.map((x) => x.title)).toEqual(['First Frost'])
    expect(page.indexable).toBe(true)
    expect(page.author.displayName).toBe('Ama')
    const read = await anon(`/works/${w.publicPath}/chapters/${page.chapters[0]!.slug}`)
    expect(read.statusCode).toBe(200)
    expect(JSON.stringify(read.json())).toContain('first frost came early')
    expect(JSON.stringify(read.json())).not.toContain('SECRET')
    expect(read.body).not.toContain('Spoiler')

    // republishing releases the new state
    await owner.call('POST', `/api/v1/works/${w.id}/publish`, {})
    const again = (await anon(`/works/${w.publicPath}`)).json() as {
      chapters: { title: string; slug: string }[]
    }
    expect(again.chapters.map((x) => x.title)).toEqual(['Spoiler Title', 'Unreleased'])
    // the old chapter link still resolves after the rename (the id suffix is stable)
    expect((await anon(`/works/${w.publicPath}/chapters/${page.chapters[0]!.slug}`)).json()).toMatchObject({
      title: 'Spoiler Title',
      next: { title: 'Unreleased' },
    })
  })

  it('unpublishing and switching back to private both hide the work; deleted chapters return 404', async () => {
    const owner = await signUp(ctx.app)
    const w = await work(owner)
    await owner.call('POST', `/api/v1/works/${w.id}/publish`, { visibility: 'unlisted' })
    const page = (await anon(`/works/${w.publicPath}`)).json() as {
      indexable: boolean
      chapters: { slug: string }[]
    }
    expect(page.indexable).toBe(false) // unlisted: link-only, noindex
    expect((await anon(`/works/${w.publicPath}/chapters/nope-zzzzzz`)).statusCode).toBe(404)

    await owner.call('PATCH', `/api/v1/works/${w.id}`, { visibility: 'private' })
    expect((await anon(`/works/${w.publicPath}`)).statusCode).toBe(404)
    expect((await anon(`/works/${w.publicPath}/chapters/${page.chapters[0]!.slug}`)).statusCode).toBe(404)

    await owner.call('PATCH', `/api/v1/works/${w.id}`, { visibility: 'unlisted' })
    expect((await anon(`/works/${w.publicPath}`)).statusCode).toBe(200)
    const off = await owner.call('POST', `/api/v1/works/${w.id}/unpublish`, {})
    expect(off.json()).toMatchObject({ published: false })
    expect((await anon(`/works/${w.publicPath}`)).statusCode).toBe(404)
    const types = (
      await ctx.db.db
        .select({ t: activityEvents.type })
        .from(activityEvents)
        .where(eq(activityEvents.workId, w.id))
    ).map((r) => r.t)
    expect(types).toEqual(expect.arrayContaining(['work.published', 'work.unpublished']))
  })

  it('only the owner can publish; contributors are credited from server-side edit sessions', async () => {
    const owner = await signUp(ctx.app)
    const w = await work(owner)
    const editor = await signUp(ctx.app, 'Tolu')
    await ctx.db.db
      .insert(workMembers)
      .values({ workId: w.id, userId: editor.id, role: 'editor', grantedBy: owner.id })
    expect(
      (await editor.call('POST', `/api/v1/works/${w.id}/publish`, { visibility: 'public' })).statusCode,
    ).toBe(403)
    const [c] = await chaptersOf(owner, w.id)
    await ctx.db.db.insert(editSessions).values({
      documentId: c!.documentId,
      workId: w.id,
      userId: editor.id,
      startedAt: new Date(),
      endedAt: new Date(),
      updateCount: 3,
    })
    await ctx.db.db
      .insert(profiles)
      .values({ userId: editor.id, username: 'tolu', isPublic: true })
      .onConflictDoUpdate({ target: profiles.userId, set: { username: 'tolu', isPublic: true } })
    await owner.call('POST', `/api/v1/works/${w.id}/publish`, { visibility: 'public' })
    const page = (await anon(`/works/${w.publicPath}`)).json() as { contributors: unknown[] }
    expect(page.contributors).toMatchObject([{ displayName: 'Tolu', username: 'tolu' }])
    expect((await editor.call('GET', `/api/v1/works/${w.id}/publication`)).json()).toMatchObject({
      published: true,
      chapterCount: 1,
    })
  })

  it('a malformed or unknown public path is a plain 404', async () => {
    expect((await anon('/works/whatever')).statusCode).toBe(404)
    expect((await anon('/works/the-orchard-0000000000')).statusCode).toBe(404)
  })
})

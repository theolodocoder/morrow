import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { and, eq, isNull } from 'drizzle-orm'
import { alternatePublications, chapters, documentProjections, publications, workMembers } from '@morrow/db'
import { liveAlternates } from '../src/routes/alternates.ts'
import { setup, signUp } from './setup.ts'

let ctx: Awaited<ReturnType<typeof setup>>
beforeAll(async () => {
  ctx = await setup('alternates')
})
afterAll(async () => {
  await ctx.app.close()
  await ctx.db.pool.end()
})

type User = Awaited<ReturnType<typeof signUp>>
type Ch = { id: string; title: string; documentId: string }

/** A published three-chapter novel. */
async function published(owner: User) {
  const w = (await owner.call('POST', '/api/v1/works', { title: 'The Salt Orchard' })).json() as {
    id: string
    defaultBranchId: string
  }
  await owner.call('POST', `/api/v1/works/${w.id}/chapters`, { title: 'Chapter 2' })
  await owner.call('POST', `/api/v1/works/${w.id}/chapters`, { title: 'Chapter 3' })
  const main = (await owner.call('GET', `/api/v1/works/${w.id}/chapters`)).json().items as Ch[]
  expect(
    (await owner.call('POST', `/api/v1/works/${w.id}/publish`, { visibility: 'public' })).statusCode,
  ).toBe(200)
  return { ...w, main }
}
async function branch(
  u: User,
  w: { id: string },
  from: string,
  divergesAtChapterId?: string,
  name = 'If She Stayed',
) {
  const res = await u.call('POST', `/api/v1/works/${w.id}/branches`, {
    name,
    description: 'What if Ama stays?',
    fromBranchId: from,
    ...(divergesAtChapterId ? { divergesAtChapterId } : {}),
  })
  expect(res.statusCode).toBe(201)
  return res.json() as { id: string; name: string }
}
async function member(owner: User, workId: string, role: 'editor' | 'collaborator' | 'contributor') {
  const u = await signUp(ctx.app, role)
  await ctx.db.db.insert(workMembers).values({ workId, userId: u.id, role, grantedBy: owner.id })
  return u
}
const publishAlt = (u: User, workId: string, branchId: string, body: object = {}) =>
  u.call('POST', `/api/v1/works/${workId}/branches/${branchId}/publish-alternate`, body)
const unpublishAlt = (u: User, workId: string, branchId: string) =>
  u.call('POST', `/api/v1/works/${workId}/branches/${branchId}/unpublish-alternate`, {})
const liveRows = (branchId: string) =>
  ctx.db.db
    .select()
    .from(alternatePublications)
    .where(and(eq(alternatePublications.branchId, branchId), isNull(alternatePublications.supersededAt)))
const liveMain = (workId: string) =>
  ctx.db.db
    .select()
    .from(publications)
    .where(and(eq(publications.workId, workId), isNull(publications.supersededAt)))

describe('publishing alternate versions', () => {
  it('owner publishes alternate: only the chapters from the divergence on are pinned, main is untouched', async () => {
    const owner = await signUp(ctx.app)
    const w = await published(owner)
    const mainBefore = await liveMain(w.id)
    const b = await branch(owner, w, w.defaultBranchId, w.main[1]!.id)
    await owner.call('POST', `/api/v1/branches/${b.id}/chapters`, { title: 'Epilogue' })
    ctx.snapshots.length = 0

    const res = await publishAlt(owner, w.id, b.id)
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ branchId: b.id, name: 'If She Stayed', published: true, chapterCount: 3 })

    const own = await ctx.db.db.select().from(chapters).where(eq(chapters.branchId, b.id))
    const rows = (await liveAlternates(ctx.db.db, w.id)).get(b.id)!
    expect(rows.map((r) => r.title)).toEqual(['Chapter 2', 'Chapter 3', 'Epilogue'])
    // pinned from the branch's own documents, never main's
    const branchDocs = new Set(own.map((c) => c.documentId))
    expect(ctx.snapshots.map((s) => s.documentId).every((d) => branchDocs.has(d))).toBe(true)
    expect(ctx.snapshots).toHaveLength(3)
    expect(rows.every((r) => own.some((c) => c.id === r.chapterId))).toBe(true)
    // pick-a-path sits at the end of main's chapter before the divergence
    const mainCh1 = mainBefore.find((p) => p.chapterId === w.main[0]!.id)!
    expect(rows.every((r) => r.afterPosition === mainCh1.position)).toBe(true)
    expect(rows.every((r) => Array.isArray(r.credits))).toBe(true)

    expect((await liveMain(w.id)).map((p) => p.id).sort()).toEqual(mainBefore.map((p) => p.id).sort())
    expect((await owner.call('GET', `/api/v1/works/${w.id}/alternates`)).json()).toEqual({
      items: [{ branchId: b.id, name: 'If She Stayed', published: true, chapterCount: 3 }],
    })
  })

  it('a member without work.publish (collaborator) is refused; non-members see nothing', async () => {
    const owner = await signUp(ctx.app)
    const w = await published(owner)
    const b = await branch(owner, w, w.defaultBranchId, w.main[1]!.id)
    const collaborator = await member(owner, w.id, 'collaborator')
    const stranger = await signUp(ctx.app)
    expect((await publishAlt(collaborator, w.id, b.id)).statusCode).toBe(403)
    expect((await unpublishAlt(collaborator, w.id, b.id)).statusCode).toBe(403)
    expect((await collaborator.call('GET', `/api/v1/works/${w.id}/alternates`)).statusCode).toBe(403)
    expect((await publishAlt(stranger, w.id, b.id)).statusCode).toBe(404)
    expect((await stranger.call('GET', `/api/v1/works/${w.id}/alternates`)).statusCode).toBe(404)
    expect(await liveRows(b.id)).toEqual([])
  })

  it('a branch author who is not the owner cannot publish their own version', async () => {
    const owner = await signUp(ctx.app)
    const w = await published(owner)
    const contributor = await member(owner, w.id, 'contributor')
    const b = await branch(contributor, w, w.defaultBranchId, w.main[1]!.id)
    expect((await publishAlt(contributor, w.id, b.id)).statusCode).toBe(403)
    expect(await liveRows(b.id)).toEqual([])
    // ...but the owner can publish it
    expect((await publishAlt(owner, w.id, b.id)).statusCode).toBe(200)
  })

  it('refuses an alternate that doesn’t branch from the published main story', async () => {
    const owner = await signUp(ctx.app)
    const w = await published(owner)
    // an alternate of an alternate
    const b = await branch(owner, w, w.defaultBranchId, w.main[1]!.id)
    const bChapters = (await owner.call('GET', `/api/v1/branches/${b.id}/chapters`)).json().items as Ch[]
    const grandchild = await branch(owner, w, b.id, bChapters[2]!.id, 'Deeper')
    expect((await publishAlt(owner, w.id, grandchild.id)).statusCode).toBe(409)
    // diverging at a main chapter that isn't published yet
    const draft = (
      await owner.call('POST', `/api/v1/works/${w.id}/chapters`, { title: 'Chapter 4' })
    ).json() as Ch
    const late = await branch(owner, w, w.defaultBranchId, draft.id, 'Late')
    expect((await publishAlt(owner, w.id, late.id)).statusCode).toBe(409)
    // diverging at the very first chapter: there is no shared chapter to end on a choice
    const first = await branch(owner, w, w.defaultBranchId, w.main[0]!.id, 'From the start')
    expect((await publishAlt(owner, w.id, first.id)).statusCode).toBe(409)
    // another work's branch
    const other = await published(owner)
    expect((await publishAlt(owner, other.id, b.id)).statusCode).toBe(404)
    // the work itself must be published
    await owner.call('POST', `/api/v1/works/${w.id}/unpublish`, {})
    expect((await publishAlt(owner, w.id, b.id)).statusCode).toBe(409)
    for (const x of [grandchild, late, first, b]) expect(await liveRows(x.id)).toEqual([])
  })

  it('without a recorded divergence point, the owner picks it when publishing', async () => {
    const owner = await signUp(ctx.app)
    const w = await published(owner)
    const b = await branch(owner, w, w.defaultBranchId)
    expect((await publishAlt(owner, w.id, b.id)).statusCode).toBe(409)
    const res = await publishAlt(owner, w.id, b.id, { divergesAtChapterId: w.main[2]!.id })
    expect(res.json()).toMatchObject({ published: true, chapterCount: 1 })
    // remembered, so republishing needs no choice
    expect((await publishAlt(owner, w.id, b.id)).json()).toMatchObject({ chapterCount: 1 })
  })

  it('republishing main keeps alternates live', async () => {
    const owner = await signUp(ctx.app)
    const w = await published(owner)
    const b = await branch(owner, w, w.defaultBranchId, w.main[1]!.id)
    expect((await publishAlt(owner, w.id, b.id)).statusCode).toBe(200)
    const before = (await liveRows(b.id)).map((r) => r.id).sort()
    await owner.call('POST', `/api/v1/works/${w.id}/chapters`, { title: 'Chapter 4' })
    expect((await owner.call('POST', `/api/v1/works/${w.id}/publish`, {})).statusCode).toBe(200)
    expect((await liveRows(b.id)).map((r) => r.id).sort()).toEqual(before)
  })

  it('unpublishing the work takes alternates down', async () => {
    const owner = await signUp(ctx.app)
    const w = await published(owner)
    const b = await branch(owner, w, w.defaultBranchId, w.main[1]!.id)
    expect((await publishAlt(owner, w.id, b.id)).statusCode).toBe(200)
    await owner.call('POST', `/api/v1/works/${w.id}/unpublish`, {})
    expect(await liveRows(b.id)).toEqual([])
    expect((await liveAlternates(ctx.db.db, w.id)).size).toBe(0)
  })

  it('archiving the branch takes its alternate down', async () => {
    const owner = await signUp(ctx.app)
    const w = await published(owner)
    const b = await branch(owner, w, w.defaultBranchId, w.main[1]!.id)
    expect((await publishAlt(owner, w.id, b.id)).statusCode).toBe(200)
    expect((await owner.call('DELETE', `/api/v1/branches/${b.id}`)).statusCode).toBe(204)
    expect(await liveRows(b.id)).toEqual([])
  })

  it('republishing an alternate supersedes its previous rows only; unpublishing takes just that one down', async () => {
    const owner = await signUp(ctx.app)
    const w = await published(owner)
    const a = await branch(owner, w, w.defaultBranchId, w.main[1]!.id, 'A')
    const b = await branch(owner, w, w.defaultBranchId, w.main[2]!.id, 'B')
    expect((await publishAlt(owner, w.id, a.id)).statusCode).toBe(200)
    expect((await publishAlt(owner, w.id, b.id)).statusCode).toBe(200)
    const aBefore = (await liveRows(a.id)).map((r) => r.id)
    const bBefore = (await liveRows(b.id)).map((r) => r.id).sort()

    expect((await publishAlt(owner, w.id, a.id)).statusCode).toBe(200)
    const aAfter = (await liveRows(a.id)).map((r) => r.id)
    expect(aAfter).toHaveLength(aBefore.length)
    expect(aAfter.some((id) => aBefore.includes(id))).toBe(false)
    expect((await liveRows(b.id)).map((r) => r.id).sort()).toEqual(bBefore)

    const off = await unpublishAlt(owner, w.id, a.id)
    expect(off.json()).toEqual({ branchId: a.id, name: 'A', published: false, chapterCount: 0 })
    expect(await liveRows(a.id)).toEqual([])
    expect((await liveRows(b.id)).map((r) => r.id).sort()).toEqual(bBefore)
  })
})

/** Stand-in for collab writing a projection after an edit. */
async function write(documentId: string, workId: string, text: string) {
  const v = {
    documentId,
    workId,
    contentJson: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] },
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
type Summary = { title: string; slug: string; wordCount: number }
type Page = {
  chapters: Summary[]
  versions: {
    name: string
    slug: string
    premise: string
    author: { displayName: string }
    afterChapter: number
    chapters: Summary[]
    wordCount: number
  }[]
}
type Chapter = {
  title: string
  index: number
  credit: { displayName: string }[]
  version: { name: string; slug: string } | null
  prev: Summary | null
  next: (Summary & { opening: string | null }) | null
  alternates: {
    name: string
    slug: string
    premise: string
    author: { displayName: string }
    firstChapter: Summary & { opening: string | null }
    chapterCount: number
  }[]
}

/**
 * A published four-chapter novel and a contributor's version that differs from chapter 4 on, with an epilogue of
 * its own, published beside it by the owner.
 */
async function readerScene() {
  const owner = await signUp(ctx.app, 'Ama Owner')
  const w = await published(owner)
  const ch4 = (
    await owner.call('POST', `/api/v1/works/${w.id}/chapters`, { title: 'Chapter 4' })
  ).json() as Ch
  const pub = (await owner.call('POST', `/api/v1/works/${w.id}/publish`, {})).json() as { publicPath: string }
  const writer = await member(owner, w.id, 'contributor')
  const b = await branch(writer, w, w.defaultBranchId, ch4.id)
  const own = (await owner.call('GET', `/api/v1/branches/${b.id}/chapters`)).json().items as Ch[]
  await write(own[3]!.documentId, w.id, 'She stayed for the harvest.')
  const epilogue = (
    await owner.call('POST', `/api/v1/branches/${b.id}/chapters`, { title: 'Epilogue' })
  ).json() as Ch
  await write(epilogue.documentId, w.id, 'Years later, the orchard was hers.')
  expect((await publishAlt(owner, w.id, b.id)).statusCode).toBe(200)
  const path = pub.publicPath
  const page = async () => (await anon(`/works/${path}`)).json() as Page
  const chapter = async (slug: string) => (await anon(`/works/${path}/chapters/${slug}`)).json() as Chapter
  return { owner, writer, w, b, path, page, chapter }
}

describe('reading alternate versions', () => {
  it('the work page lists the version; main chapter 3 offers the path, the version reads on from there', async () => {
    const s = await readerScene()
    const page = await s.page()
    expect(page.chapters).toHaveLength(4)
    expect(page.versions).toEqual([
      {
        name: 'If She Stayed',
        slug: 'if-she-stayed',
        premise: 'What if Ama stays?',
        author: expect.objectContaining({ displayName: 'contributor' }),
        afterChapter: 3,
        chapters: [
          expect.objectContaining({ title: 'Chapter 4', wordCount: 5 }),
          expect.objectContaining({ title: 'Epilogue', wordCount: 6 }),
        ],
        wordCount: 11,
      },
    ])
    const [v] = page.versions

    const third = await s.chapter(page.chapters[2]!.slug)
    expect(third.version).toBeNull()
    // the main story still carries on as the obvious path
    expect(third.next?.slug).toBe(page.chapters[3]!.slug)
    expect(third.alternates).toEqual([
      {
        name: 'If She Stayed',
        slug: 'if-she-stayed',
        premise: 'What if Ama stays?',
        author: expect.objectContaining({ displayName: 'contributor' }),
        firstChapter: { ...v!.chapters[0]!, opening: 'She stayed for the harvest.' },
        chapterCount: 2,
      },
    ])
    expect((await s.chapter(page.chapters[1]!.slug)).alternates).toEqual([])
    expect((await s.chapter(page.chapters[3]!.slug)).alternates).toEqual([])

    const first = await s.chapter(v!.chapters[0]!.slug)
    expect(first).toMatchObject({
      title: 'Chapter 4',
      index: 3,
      version: { name: 'If She Stayed', slug: 'if-she-stayed' },
      prev: page.chapters[2],
      next: { ...v!.chapters[1]!, opening: 'Years later, the orchard was hers.' },
      alternates: [],
    })
    expect(first.credit[0]!.displayName).toBe('Ama Owner')
    const last = await s.chapter(v!.chapters[1]!.slug)
    expect(last).toMatchObject({ index: 4, prev: v!.chapters[0], next: null })
  })

  it('a reader can comment on a paragraph of the version', async () => {
    const s = await readerScene()
    const slug = (await s.page()).versions[0]!.chapters[0]!.slug
    const reader = await signUp(ctx.app, 'Bo Reader')
    const posted = await reader.call('POST', `/api/v1/reading/${s.path}/comments`, {
      body: 'She should have left.',
      chapterSlug: slug,
      blockId: 'b1',
    })
    expect(posted.statusCode).toBe(201)
    const counts = (await anon(`/reading/${s.path}/chapters/${slug}/paragraph-comments`)).json()
    expect(counts).toEqual({ counts: { b1: 1 } })
  })

  it('unpublishing the version takes it off the page and its chapters 404', async () => {
    const s = await readerScene()
    const before = await s.page()
    const slug = before.versions[0]!.chapters[0]!.slug
    expect((await unpublishAlt(s.owner, s.w.id, s.b.id)).statusCode).toBe(200)
    expect((await s.page()).versions).toEqual([])
    expect((await s.chapter(before.chapters[2]!.slug)).alternates).toEqual([])
    expect((await anon(`/works/${s.path}/chapters/${slug}`)).statusCode).toBe(404)
  })

  it('a version readers can no longer reach from main is silently left out', async () => {
    // main republished from a different selected branch: the version no longer branches from what readers get
    const s = await readerScene()
    const slug = (await s.page()).versions[0]!.chapters[0]!.slug
    const other = await branch(s.owner, s.w, s.w.defaultBranchId, undefined, 'Other ending')
    expect(
      (await s.owner.call('PATCH', `/api/v1/branches/${other.id}`, { status: 'selected' })).statusCode,
    ).toBe(200)
    expect((await s.owner.call('POST', `/api/v1/works/${s.w.id}/publish`, {})).statusCode).toBe(200)
    expect((await s.page()).versions).toEqual([])
    expect((await anon(`/works/${s.path}/chapters/${slug}`)).statusCode).toBe(404)
    expect((await liveRows(s.b.id)).length).toBe(2)

    // the main chapter it follows is taken out of main
    const t = await readerScene()
    const page = await t.page()
    const altSlug = page.versions[0]!.chapters[0]!.slug
    expect((await t.owner.call('DELETE', `/api/v1/chapters/${t.w.main[2]!.id}`)).statusCode).toBe(204)
    expect((await t.owner.call('POST', `/api/v1/works/${t.w.id}/publish`, {})).statusCode).toBe(200)
    const after = await t.page()
    expect(after.chapters).toHaveLength(3)
    expect(after.versions).toEqual([])
    expect(
      (await Promise.all(after.chapters.map((c) => t.chapter(c.slug)))).every(
        (c) => c.alternates.length === 0,
      ),
    ).toBe(true)
    expect((await anon(`/works/${t.path}/chapters/${altSlug}`)).statusCode).toBe(404)
    const reader = await signUp(ctx.app)
    const comment = await reader.call('POST', `/api/v1/reading/${t.path}/comments`, {
      body: 'Hello?',
      chapterSlug: altSlug,
      blockId: 'b1',
    })
    expect(comment.statusCode).toBe(404)
  })
})

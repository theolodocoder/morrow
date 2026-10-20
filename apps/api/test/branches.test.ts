import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import { chapters, documentProjections, workMembers } from '@morrow/db'
import { setup, signUp } from './setup.ts'

let ctx: Awaited<ReturnType<typeof setup>>
beforeAll(async () => {
  ctx = await setup('branches')
})
afterAll(async () => {
  await ctx.app.close()
  await ctx.db.pool.end()
})

type User = Awaited<ReturnType<typeof signUp>>
type BranchT = {
  id: string
  name: string
  isDefault: boolean
  parentBranchId: string | null
  parentBranchName: string | null
  divergesAtChapterTitle: string | null
  chapterCount: number
  status: string
  capabilities: string[]
}

async function novel(owner: User) {
  const w = (await owner.call('POST', '/api/v1/works', { title: 'The Salt Orchard' })).json() as {
    id: string
    defaultBranchId: string
  }
  await owner.call('POST', `/api/v1/works/${w.id}/chapters`, { title: 'Chapter 2' })
  await owner.call('POST', `/api/v1/works/${w.id}/chapters`, { title: 'Chapter 3' })
  const list = (await owner.call('GET', `/api/v1/works/${w.id}/chapters`)).json() as {
    items: { id: string; title: string; documentId: string }[]
  }
  return { ...w, chapters: list.items }
}
async function member(owner: User, workId: string, role: string) {
  const u = await signUp(ctx.app)
  await ctx.db.db
    .insert(workMembers)
    .values({ workId, userId: u.id, role: role as 'editor', grantedBy: owner.id })
  return u
}

describe('branches', () => {
  it('creating a branch forks every chapter (in order, with lineage) and records where it diverges', async () => {
    const owner = await signUp(ctx.app)
    const w = await novel(owner)
    ctx.forks.length = 0
    const res = await owner.call('POST', `/api/v1/works/${w.id}/branches`, {
      name: 'The Lighthouse Ending',
      description: 'What if Ama stays?',
      fromBranchId: w.defaultBranchId,
      divergesAtChapterId: w.chapters[1]!.id,
    })
    expect(res.statusCode).toBe(201)
    const b = res.json() as BranchT
    expect(b).toMatchObject({
      name: 'The Lighthouse Ending',
      isDefault: false,
      parentBranchId: w.defaultBranchId,
      parentBranchName: 'Main',
      divergesAtChapterTitle: 'Chapter 2',
      chapterCount: 3,
      status: 'active',
    })
    expect(ctx.forks.map((f) => f.sourceDocumentId)).toEqual(w.chapters.map((c) => c.documentId))
    const branchChapters = (await owner.call('GET', `/api/v1/branches/${b.id}/chapters`)).json() as {
      items: { id: string; title: string; documentId: string }[]
    }
    expect(branchChapters.items.map((c) => c.title)).toEqual(['Chapter 1', 'Chapter 2', 'Chapter 3'])
    // separate documents (isolation), linked by origin (lineage)
    expect(branchChapters.items.every((c, i) => c.documentId !== w.chapters[i]!.documentId)).toBe(true)
    const rows = await ctx.db.db.select().from(chapters).where(eq(chapters.branchId, b.id))
    expect(rows.map((r) => r.originChapterId).sort()).toEqual(w.chapters.map((c) => c.id).sort())
    const list = (await owner.call('GET', `/api/v1/works/${w.id}/branches`)).json() as { items: BranchT[] }
    expect(list.items.map((x) => x.name)).toEqual(['Main', 'The Lighthouse Ending'])
  })

  it('a failed fork leaves no visible half-made branch', async () => {
    const owner = await signUp(ctx.app)
    const w = await novel(owner)
    ctx.failForks.next = 1
    const res = await owner.call('POST', `/api/v1/works/${w.id}/branches`, {
      name: 'Broken',
      fromBranchId: w.defaultBranchId,
    })
    expect(res.statusCode).toBe(502)
    const list = (await owner.call('GET', `/api/v1/works/${w.id}/branches`)).json() as { items: BranchT[] }
    expect(list.items.map((x) => x.name)).toEqual(['Main'])
  })

  it('contributors can branch and write in their own branch, but not in Main; viewers cannot branch; strangers see nothing', async () => {
    const owner = await signUp(ctx.app)
    const w = await novel(owner)
    const contributor = await member(owner, w.id, 'contributor')
    const viewer = await member(owner, w.id, 'viewer')
    const stranger = await signUp(ctx.app)
    const b = (
      await contributor.call('POST', `/api/v1/works/${w.id}/branches`, {
        name: 'My take',
        fromBranchId: w.defaultBranchId,
      })
    ).json() as BranchT
    expect(b.capabilities).toContain('branch.edit')
    expect(
      (await contributor.call('POST', `/api/v1/branches/${b.id}/chapters`, { title: 'Epilogue' })).statusCode,
    ).toBe(201)
    expect(
      (await contributor.call('POST', `/api/v1/branches/${w.defaultBranchId}/chapters`, { title: 'Sneaky' }))
        .statusCode,
    ).toBe(403)
    const [own] = (await contributor.call('GET', `/api/v1/branches/${b.id}/chapters`)).json().items as {
      documentId: string
    }[]
    expect(
      (await contributor.call('POST', '/api/v1/collab/tickets', { documentId: own!.documentId })).json().mode,
    ).toBe('edit')
    expect(
      (
        await contributor.call('POST', '/api/v1/collab/tickets', { documentId: w.chapters[0]!.documentId })
      ).json().mode,
    ).toBe('read')
    expect(
      (
        await viewer.call('POST', `/api/v1/works/${w.id}/branches`, {
          name: 'No',
          fromBranchId: w.defaultBranchId,
        })
      ).statusCode,
    ).toBe(403)
    expect((await stranger.call('GET', `/api/v1/works/${w.id}/branches`)).statusCode).toBe(404)
    expect((await stranger.call('GET', `/api/v1/branches/${b.id}/chapters`)).statusCode).toBe(404)
  })

  it('only the owner chooses the selected version; one per work; Main cannot be abandoned or archived', async () => {
    const owner = await signUp(ctx.app)
    const w = await novel(owner)
    const editor = await member(owner, w.id, 'editor')
    const a = (
      await owner.call('POST', `/api/v1/works/${w.id}/branches`, {
        name: 'A',
        fromBranchId: w.defaultBranchId,
      })
    ).json() as BranchT
    const b = (
      await owner.call('POST', `/api/v1/works/${w.id}/branches`, {
        name: 'B',
        fromBranchId: w.defaultBranchId,
      })
    ).json() as BranchT
    expect((await editor.call('PATCH', `/api/v1/branches/${a.id}`, { status: 'selected' })).statusCode).toBe(
      403,
    )
    expect(
      (await owner.call('PATCH', `/api/v1/branches/${a.id}`, { status: 'selected' })).json().status,
    ).toBe('selected')
    expect(
      (await owner.call('PATCH', `/api/v1/branches/${b.id}`, { status: 'selected' })).json().status,
    ).toBe('selected')
    const list = (await owner.call('GET', `/api/v1/works/${w.id}/branches`)).json() as { items: BranchT[] }
    expect(list.items.filter((x) => x.status === 'selected').map((x) => x.name)).toEqual(['B'])
    expect(
      (await owner.call('PATCH', `/api/v1/branches/${w.defaultBranchId}`, { status: 'abandoned' }))
        .statusCode,
    ).toBe(409)
    expect((await owner.call('DELETE', `/api/v1/branches/${w.defaultBranchId}`)).statusCode).toBe(409)
  })

  it('an editor cannot archive someone else’s branch; its creator and the owner can', async () => {
    const owner = await signUp(ctx.app)
    const w = await novel(owner)
    const contributor = await member(owner, w.id, 'contributor')
    const editor = await member(owner, w.id, 'editor')
    const b = (
      await contributor.call('POST', `/api/v1/works/${w.id}/branches`, {
        name: 'Theirs',
        fromBranchId: w.defaultBranchId,
      })
    ).json() as BranchT
    expect((await editor.call('DELETE', `/api/v1/branches/${b.id}`)).statusCode).toBe(403)
    expect((await contributor.call('DELETE', `/api/v1/branches/${b.id}`)).statusCode).toBe(204)
  })
})

describe('history and export', () => {
  it('restore goes through collab and is refused for viewers', async () => {
    const owner = await signUp(ctx.app)
    const w = await novel(owner)
    const viewer = await member(owner, w.id, 'viewer')
    const doc = w.chapters[0]!.documentId,
      snapshotId = crypto.randomUUID()
    expect((await owner.call('POST', `/api/v1/documents/${doc}/restore`, { snapshotId })).statusCode).toBe(
      200,
    )
    expect(ctx.restores.at(-1)).toMatchObject({ documentId: doc, snapshotId, createdBy: owner.id })
    expect((await viewer.call('POST', `/api/v1/documents/${doc}/restore`, { snapshotId })).statusCode).toBe(
      403,
    )
  })

  it('exports a branch as Markdown from projections, in chapter order', async () => {
    const owner = await signUp(ctx.app)
    const w = await novel(owner)
    const stranger = await signUp(ctx.app)
    await ctx.db.db.insert(documentProjections).values({
      documentId: w.chapters[0]!.documentId,
      workId: w.id,
      contentJson: {
        type: 'doc',
        content: [{ type: 'paragraph', content: [{ type: 'text', text: 'The salt had come up.' }] }],
      },
      plainText: 'The salt had come up.',
      wordCount: 5,
      sourceRevision: 1,
    })
    const res = await owner.call('GET', `/api/v1/branches/${w.defaultBranchId}/export.md`)
    expect(res.statusCode).toBe(200)
    expect(res.headers['content-type']).toContain('text/markdown')
    expect(res.headers['content-disposition']).toContain('the-salt-orchard.md')
    expect(res.body).toBe(
      '# The Salt Orchard\n\n## Chapter 1\n\nThe salt had come up.\n\n## Chapter 2\n\n## Chapter 3\n',
    )
    expect((await stranger.call('GET', `/api/v1/branches/${w.defaultBranchId}/export.md`)).statusCode).toBe(
      404,
    )
  })
})

describe('isolation between works (regression: an unparenthesised OR once leaked other works’ branches)', () => {
  it('a work’s branch list only ever contains its own branches', async () => {
    const a = await signUp(ctx.app)
    const b = await signUp(ctx.app)
    const wa = await novel(a)
    await novel(b)
    await b.call('POST', `/api/v1/works/${(await novel(b)).id}/branches`, {
      name: 'Private elsewhere',
      fromBranchId: (await novel(b)).defaultBranchId,
    })
    const list = (await a.call('GET', `/api/v1/works/${wa.id}/branches`)).json() as {
      items: { workId: string }[]
    }
    expect(list.items.every((x) => x.workId === wa.id)).toBe(true)
    expect(list.items).toHaveLength(1)
  })
})

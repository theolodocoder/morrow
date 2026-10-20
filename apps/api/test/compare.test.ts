import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import { branchMerges, chapters, documentProjections, workMembers } from '@morrow/db'
import { setup, signUp } from './setup.ts'

let ctx: Awaited<ReturnType<typeof setup>>
beforeAll(async () => {
  ctx = await setup('compare')
})
afterAll(async () => {
  await ctx.app.close()
  await ctx.db.pool.end()
})
beforeEach(() => {
  ctx.engine.classification = { kind: 'clean' }
})

type User = Awaited<ReturnType<typeof signUp>>
type Ch = { id: string; documentId: string; title: string }
const p = (id: string, text: string) => ({
  type: 'paragraph',
  attrs: { id },
  content: [{ type: 'text', text }],
})
/** Stand-in for collab projecting an edit. */
async function write(documentId: string, workId: string, ...paras: [string, string][]) {
  const contentJson = { type: 'doc', content: paras.map(([id, t]) => p(id, t)) }
  const v = {
    documentId,
    workId,
    contentJson,
    plainText: paras.map((x) => x[1]).join('\n'),
    wordCount: 3,
    sourceRevision: Date.now(),
  }
  await ctx.db.db
    .insert(documentProjections)
    .values(v)
    .onConflictDoUpdate({ target: documentProjections.documentId, set: v })
}
const chaptersOf = async (u: User, branchId: string) =>
  ((await u.call('GET', `/api/v1/branches/${branchId}/chapters`)).json() as { items: Ch[] }).items

async function scene() {
  const owner = await signUp(ctx.app, 'Ama')
  const w = (
    await owner.call('POST', '/api/v1/works', { title: 'The Orchard', category: 'novel' })
  ).json() as { id: string; defaultBranchId: string }
  const [main1] = await chaptersOf(owner, w.defaultBranchId)
  await write(main1!.documentId, w.id, ['a', 'She stood at the gate.'], ['b', 'The tide was out.'])
  const branch = (
    await owner.call('POST', `/api/v1/works/${w.id}/branches`, {
      name: 'The Lighthouse Ending',
      fromBranchId: w.defaultBranchId,
    })
  ).json() as { id: string }
  const [b1] = await chaptersOf(owner, branch.id)
  return { owner, workId: w.id, main: w.defaultBranchId, branch: branch.id, main1: main1!, b1: b1! }
}

describe('compare revisions (FR-019)', () => {
  it('shows what changed between a saved version and now, word by word', async () => {
    const s = await scene()
    const snap = (
      await s.owner.call('POST', `/api/v1/documents/${s.main1.documentId}/snapshots`, { label: 'Draft one' })
    ).json() as { id: string }
    await write(
      s.main1.documentId,
      s.workId,
      ['a', 'She stood alone at the gate.'],
      ['b', 'The tide was out.'],
      ['c', 'Gulls.'],
    )
    const r = (
      await s.owner.call('GET', `/api/v1/documents/${s.main1.documentId}/compare?from=${snap.id}`)
    ).json() as {
      from: { label: string }
      to: { label: string }
      summary: object
      changes: { type: string }[]
    }
    expect(r).toMatchObject({
      from: { label: 'Draft one' },
      to: { label: 'Now' },
      summary: { changed: 1, added: 1, removed: 0 },
    })
    expect(r.changes.map((c) => c.type)).toEqual(['changed', 'same', 'added'])
    const history = (
      await s.owner.call('GET', `/api/v1/documents/${s.main1.documentId}/snapshots`)
    ).json() as { items: { label: string | null; createdByName: string | null }[] }
    expect(history.items.find((x) => x.label === 'Draft one')).toMatchObject({ createdByName: 'Ama' }) // attribution
  })

  it('history and comparisons follow work access; snapshots must belong to the document', async () => {
    const s = await scene()
    const snap = (
      await s.owner.call('POST', `/api/v1/documents/${s.main1.documentId}/snapshots`, {})
    ).json() as { id: string }
    const stranger = await signUp(ctx.app, 'S')
    expect(
      (await stranger.call('GET', `/api/v1/documents/${s.main1.documentId}/compare?from=${snap.id}`))
        .statusCode,
    ).toBe(404)
    expect(
      (await s.owner.call('GET', `/api/v1/documents/${s.b1.documentId}/compare?from=${snap.id}`)).statusCode,
    ).toBe(404)
  })
})

describe('compare and merge branches (FR-018)', () => {
  it('pairs chapters by lineage and shows what the branch does differently', async () => {
    const s = await scene()
    await write(s.b1.documentId, s.workId, ['a', 'She stood at the gate.'], ['b', 'The lighthouse was lit.'])
    await s.owner.call('POST', `/api/v1/branches/${s.branch}/chapters`, { title: 'Epilogue' })
    const r = (await s.owner.call('GET', `/api/v1/branches/${s.branch}/compare`)).json() as {
      other: { name: string }
      canMerge: boolean
      chapters: { title: string; status: string; summary: object }[]
    }
    expect(r).toMatchObject({ other: { name: 'Main' }, canMerge: true })
    expect(r.chapters.map((c) => [c.title, c.status])).toEqual([
      ['Chapter 1', 'changed'],
      ['Epilogue', 'only_here'],
    ])
    expect(r.chapters[0]!.summary).toEqual({ changed: 1, added: 0, removed: 0 })
  })

  it('merges a clean branch: changed chapters apply, new chapters join Main, and the next merge starts from here', async () => {
    const s = await scene()
    await write(s.b1.documentId, s.workId, ['a', 'She stood at the gate.'], ['b', 'The lighthouse was lit.'])
    const epi = (
      await s.owner.call('POST', `/api/v1/branches/${s.branch}/chapters`, { title: 'Epilogue' })
    ).json() as Ch
    await write(epi.documentId, s.workId, ['e', 'Years later.'])
    const res = await s.owner.call(
      'POST',
      `/api/v1/branches/${s.branch}/merge`,
      {},
      { 'idempotency-key': crypto.randomUUID() },
    )
    expect(res.json()).toMatchObject({
      status: 'merged',
      chapters: [
        { title: 'Chapter 1', outcome: 'merged' },
        { title: 'Epilogue', outcome: 'added' },
      ],
    })
    expect(ctx.engine.applied.at(-1)).toContain(`merge:${s.b1.id}:`)
    const mainChapters = await chaptersOf(s.owner, s.main)
    expect(mainChapters.map((c) => c.title)).toEqual(['Chapter 1', 'Epilogue'])
    expect(ctx.forks.at(-1)).toMatchObject({ sourceDocumentId: epi.documentId })
    const [b1] = await ctx.db.db.select().from(chapters).where(eq(chapters.id, s.b1.id))
    expect(b1!.mergeBaseSnapshotId).toBeTruthy()

    // A second merge pairs Epilogue with its copy (no duplicate) and uses the new base.
    const again = (await s.owner.call('POST', `/api/v1/branches/${s.branch}/merge`, {})).json() as {
      chapters: { title: string; outcome: string }[]
    }
    expect(again.chapters.filter((c) => c.title === 'Epilogue').map((c) => c.outcome)).not.toContain('added')
    expect((await chaptersOf(s.owner, s.main)).map((c) => c.title)).toEqual(['Chapter 1', 'Epilogue'])
  })

  it('a conflict anywhere merges nothing and names the clashing paragraphs', async () => {
    const s = await scene()
    await write(s.b1.documentId, s.workId, ['a', 'She stood at the gate.'], ['b', 'The lighthouse was lit.'])
    await s.owner.call('POST', `/api/v1/branches/${s.branch}/chapters`, { title: 'Epilogue' })
    ctx.engine.classification = { kind: 'conflict', blockIds: ['b'], gaps: [] }
    const before = ctx.engine.applied.length
    const r = (await s.owner.call('POST', `/api/v1/branches/${s.branch}/merge`, {})).json() as {
      status: string
      chapters: { title: string; outcome: string; blockIds?: string[] }[]
    }
    expect(r).toMatchObject({
      status: 'conflict',
      chapters: [
        { title: 'Chapter 1', outcome: 'conflict', blockIds: ['b'] },
        { title: 'Epilogue', outcome: 'not_attempted' },
      ],
    })
    expect(ctx.engine.applied.length).toBe(before)
    expect((await chaptersOf(s.owner, s.main)).map((c) => c.title)).toEqual(['Chapter 1'])
    const [rec] = await ctx.db.db.select().from(branchMerges).where(eq(branchMerges.sourceBranchId, s.branch))
    expect(rec).toMatchObject({ status: 'conflict' })
  })

  it('merging needs the right to write the parent; Main can’t be merged', async () => {
    const s = await scene()
    const tolu = await signUp(ctx.app, 'Tolu')
    await ctx.db.db
      .insert(workMembers)
      .values({ workId: s.workId, userId: tolu.id, role: 'contributor', grantedBy: s.owner.id })
    const own = (
      await tolu.call('POST', `/api/v1/works/${s.workId}/branches`, {
        name: 'Tolu’s take',
        fromBranchId: s.main,
      })
    ).json() as { id: string }
    expect((await tolu.call('POST', `/api/v1/branches/${own.id}/merge`, {})).statusCode).toBe(403)
    expect(
      ((await tolu.call('GET', `/api/v1/branches/${own.id}/compare`)).json() as { canMerge: boolean })
        .canMerge,
    ).toBe(false)
    expect((await s.owner.call('POST', `/api/v1/branches/${s.main}/merge`, {})).statusCode).toBe(409)
  })

  it('update from Main reconciles: the branch re-bases, and the merge then goes through', async () => {
    const s = await scene()
    await write(s.b1.documentId, s.workId, ['a', 'She stood at the gate.'], ['b', 'The lighthouse was lit.'])
    ctx.engine.classification = { kind: 'conflict', blockIds: ['b'], gaps: [] }
    expect(
      ((await s.owner.call('POST', `/api/v1/branches/${s.branch}/merge`, {})).json() as { status: string })
        .status,
    ).toBe('conflict')
    const up = await s.owner.call('POST', `/api/v1/branches/${s.branch}/update-from-parent`, {})
    expect(up.json()).toEqual({ chapters: [{ title: 'Chapter 1', contested: 0 }] })
    expect(ctx.engine.refreshed).toContain(`update:${s.b1.id}`)
    const [b1] = await ctx.db.db.select().from(chapters).where(eq(chapters.id, s.b1.id))
    expect(b1!.mergeBaseSnapshotId).toBeTruthy()
    ctx.engine.classification = { kind: 'clean' }
    expect(
      ((await s.owner.call('POST', `/api/v1/branches/${s.branch}/merge`, {})).json() as { status: string })
        .status,
    ).toBe('merged')
  })
})

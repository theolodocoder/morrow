import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import { activityEvents, workMembers } from '@morrow/db'
import { setup, signUp } from './setup.ts'

let ctx: Awaited<ReturnType<typeof setup>>
beforeAll(async () => {
  ctx = await setup('proposals')
})
afterAll(async () => {
  await ctx.app.close()
  await ctx.db.pool.end()
})
beforeEach(() => {
  ctx.engine.classification = { kind: 'clean' }
})

type User = Awaited<ReturnType<typeof signUp>>
type Detail = {
  id: string
  status: string
  actions: string[]
  workspaceDocumentId: string | null
  events: { type: string; body: string; toStatus: string | null }[]
  review: { classification: { kind: string } | null; changes: unknown[] } | null
}

async function scene(mode: 'direct' | 'mixed' | 'proposal' = 'mixed') {
  const owner = await signUp(ctx.app, 'Ama')
  const w = (
    await owner.call('POST', '/api/v1/works', { title: 'The Orchard', category: 'novel' })
  ).json() as { id: string }
  await owner.call('PATCH', `/api/v1/works/${w.id}`, { collaborationMode: mode })
  const [chapter] = (
    (await owner.call('GET', `/api/v1/works/${w.id}/chapters`)).json() as {
      items: { id: string; documentId: string }[]
    }
  ).items
  const member = async (role: 'editor' | 'collaborator' | 'contributor' | 'viewer', name: string) => {
    const u = await signUp(ctx.app, name)
    await ctx.db.db.insert(workMembers).values({ workId: w.id, userId: u.id, role, grantedBy: owner.id })
    return u
  }
  return { owner, workId: w.id, chapter: chapter!, member }
}
const propose = async (u: User, workId: string, chapterId: string, extra: object = {}) =>
  u.call('POST', `/api/v1/works/${workId}/proposals`, {
    kind: 'edit',
    title: 'A gentler opening',
    explanation: 'Softer first line.',
    chapterId,
    ...extra,
  })
const act = (u: User, id: string, action: string, body: object = {}, headers?: Record<string, string>) =>
  u.call('POST', `/api/v1/proposals/${id}/${action}`, body, headers)

describe('proposals (PRD FR-014/015)', () => {
  it('a collaborator proposes an edit: the workspace forks the chapter, and the draft is private to its author', async () => {
    const s = await scene()
    const tolu = await s.member('collaborator', 'Tolu')
    const editor = await s.member('editor', 'Kemi')
    const res = await propose(tolu, s.workId, s.chapter.id)
    expect(res.statusCode).toBe(201)
    const p = res.json() as Detail
    expect(p).toMatchObject({ status: 'draft', actions: ['edit', 'submit', 'withdraw', 'refresh'] })
    expect(ctx.forks.at(-1)).toMatchObject({
      sourceDocumentId: s.chapter.documentId,
      targetDocumentId: p.workspaceDocumentId,
      reason: 'proposal_base',
    })
    // Only the author can open the workspace while it's a draft.
    expect(
      (
        (await tolu.call('POST', '/api/v1/collab/tickets', { documentId: p.workspaceDocumentId })).json() as {
          mode: string
        }
      ).mode,
    ).toBe('edit')
    expect(
      (await editor.call('POST', '/api/v1/collab/tickets', { documentId: p.workspaceDocumentId })).statusCode,
    ).toBe(404)
    expect((await editor.call('GET', `/api/v1/proposals/${p.id}`)).statusCode).toBe(404)
    expect(
      ((await editor.call('GET', `/api/v1/works/${s.workId}/proposals`)).json() as { items: unknown[] })
        .items,
    ).toHaveLength(0)
  })

  it('readers can’t propose, and nobody outside the work can see proposals', async () => {
    const s = await scene()
    const reader = await s.member('viewer', 'Reader')
    expect((await propose(reader, s.workId, s.chapter.id)).statusCode).toBe(403)
    const stranger = await signUp(ctx.app, 'Stranger')
    expect((await propose(stranger, s.workId, s.chapter.id)).statusCode).toBe(404)
    const tolu = await s.member('contributor', 'Tolu')
    const p = (await propose(tolu, s.workId, s.chapter.id)).json() as Detail
    await act(tolu, p.id, 'submit')
    expect((await stranger.call('GET', `/api/v1/proposals/${p.id}`)).statusCode).toBe(404)
    expect((await reader.call('GET', `/api/v1/proposals/${p.id}`)).statusCode).toBe(404)
  })

  it('submit freezes the workspace; a reviewer reviews, asks for changes, and the author can edit again', async () => {
    const s = await scene()
    const tolu = await s.member('collaborator', 'Tolu')
    const p = (await propose(tolu, s.workId, s.chapter.id)).json() as Detail
    const submitted = (await act(tolu, p.id, 'submit')).json() as Detail
    expect(submitted.status).toBe('submitted')
    expect(ctx.snapshots.at(-1)).toMatchObject({ documentId: p.workspaceDocumentId, label: 'Submitted' })
    expect(ctx.revocations.at(-1)).toMatchObject({ userId: tolu.id, documentId: p.workspaceDocumentId })
    expect(
      (
        (await tolu.call('POST', '/api/v1/collab/tickets', { documentId: p.workspaceDocumentId })).json() as {
          mode: string
        }
      ).mode,
    ).toBe('read')
    expect((await tolu.call('PATCH', `/api/v1/proposals/${p.id}`, { title: 'Sneaky' })).statusCode).toBe(409)

    const owner = s.owner
    const viewed = (await owner.call('GET', `/api/v1/proposals/${p.id}`)).json() as Detail
    expect(viewed.actions).toEqual(['start_review', 'request_changes', 'accept', 'reject', 'comment'])
    expect(viewed.review?.classification).toEqual({ kind: 'clean' })
    await act(owner, p.id, 'start-review')
    await owner.call('POST', `/api/v1/proposals/${p.id}/comments`, { body: 'Lovely, but keep “salt”.' })
    const back = (await act(owner, p.id, 'request-changes', { note: 'Keep the word salt.' })).json() as Detail
    expect(back.status).toBe('changes_requested')
    expect(back.events.map((e) => e.toStatus ?? e.type)).toEqual([
      'submitted',
      'under_review',
      'comment',
      'changes_requested',
    ])
    expect(
      (
        (await tolu.call('POST', '/api/v1/collab/tickets', { documentId: p.workspaceDocumentId })).json() as {
          mode: string
        }
      ).mode,
    ).toBe('edit')
    expect((await act(tolu, p.id, 'submit')).json()).toMatchObject({ status: 'submitted' })
  })

  it('accepting applies through collab exactly once, credits the author, and is idempotent per key', async () => {
    const s = await scene()
    const tolu = await s.member('contributor', 'Tolu')
    const p = (await propose(tolu, s.workId, s.chapter.id)).json() as Detail
    await act(tolu, p.id, 'submit')
    const key = { 'idempotency-key': crypto.randomUUID() }
    const first = await act(s.owner, p.id, 'accept', { note: 'Thank you!' }, key)
    expect(first.json()).toMatchObject({ status: 'accepted', actions: [] })
    const replay = await act(s.owner, p.id, 'accept', { note: 'Thank you!' }, key)
    expect(replay.statusCode).toBe(200)
    expect(replay.headers['idempotent-replay']).toBe('true')
    expect(ctx.engine.applied.filter((x) => x === p.id)).toHaveLength(1)
    expect((await act(s.owner, p.id, 'accept')).statusCode).toBe(409) // no key: already decided
    const [credit] = await ctx.db.db
      .select()
      .from(activityEvents)
      .where(eq(activityEvents.type, 'proposal.accepted'))
    expect(credit).toMatchObject({
      actorId: s.owner.id,
      subjectId: p.id,
      data: expect.objectContaining({ authorId: tolu.id }),
    })
    // Attribution survives into the published work's credits.
    const pub = (
      await s.owner.call('POST', `/api/v1/works/${s.workId}/publish`, { visibility: 'unlisted' })
    ).json() as { publicPath: string }
    const page = (
      await ctx.app.inject({ method: 'GET', url: `/api/v1/public/works/${pub.publicPath}` })
    ).json() as { contributors: { displayName: string }[] }
    expect(page.contributors).toMatchObject([{ displayName: 'Tolu', username: null }])
  })

  it('a conflicting proposal is never applied; the author refreshes it and it can then be accepted', async () => {
    const s = await scene()
    const tolu = await s.member('collaborator', 'Tolu')
    const p = (await propose(tolu, s.workId, s.chapter.id)).json() as Detail
    await act(tolu, p.id, 'submit')
    ctx.engine.classification = { kind: 'conflict', blockIds: ['b'], gaps: [] }
    const refused = await act(s.owner, p.id, 'accept')
    expect(refused.statusCode).toBe(409)
    expect(refused.json()).toMatchObject({ type: 'https://morrow.dev/problems/proposal-conflict' })
    expect(((await s.owner.call('GET', `/api/v1/proposals/${p.id}`)).json() as Detail).status).toBe(
      'submitted',
    )
    await act(s.owner, p.id, 'request-changes', { note: 'Please update it with the latest text.' })
    expect((await act(tolu, p.id, 'refresh')).statusCode).toBe(200)
    expect(ctx.engine.refreshed).toContain(p.id)
    ctx.engine.classification = { kind: 'clean' }
    await act(tolu, p.id, 'submit')
    expect((await act(s.owner, p.id, 'accept')).json()).toMatchObject({ status: 'accepted' })
  })

  it('nobody reviews their own proposal; editors review; two reviewers can’t both decide', async () => {
    const s = await scene('proposal')
    const editor = await s.member('editor', 'Kemi')
    const own = (await propose(s.owner, s.workId, s.chapter.id)).json() as Detail
    await act(s.owner, own.id, 'submit')
    expect((await act(s.owner, own.id, 'accept')).statusCode).toBe(403)
    expect((await act(editor, own.id, 'accept')).json()).toMatchObject({ status: 'accepted' })

    const tolu = await s.member('contributor', 'Tolu')
    const p = (await propose(tolu, s.workId, s.chapter.id)).json() as Detail
    await act(tolu, p.id, 'submit')
    const [a, b] = await Promise.all([
      act(s.owner, p.id, 'reject', { note: 'Not this one.' }),
      act(editor, p.id, 'accept'),
    ])
    expect([a.statusCode, b.statusCode].sort()).toEqual([200, 409])
  })

  it('notes (outline, character, research, feedback) need no chapter and change no text', async () => {
    const s = await scene()
    const tolu = await s.member('contributor', 'Tolu')
    const empty = (
      await tolu.call('POST', `/api/v1/works/${s.workId}/proposals`, {
        kind: 'character',
        title: 'The ferryman',
      })
    ).json() as Detail
    expect(empty.workspaceDocumentId).toBeNull()
    expect((await act(tolu, empty.id, 'submit')).statusCode).toBe(409) // nothing written yet
    await tolu.call('PATCH', `/api/v1/proposals/${empty.id}`, { body: 'Old, quiet, owes Ama a favour.' })
    await act(tolu, empty.id, 'submit')
    const before = ctx.engine.applied.length
    expect((await act(s.owner, empty.id, 'accept')).json()).toMatchObject({
      status: 'accepted',
      review: null,
    })
    expect(ctx.engine.applied.length).toBe(before)
  })

  it('withdrawing ends it; deleting the chapter supersedes open proposals', async () => {
    const s = await scene()
    const tolu = await s.member('contributor', 'Tolu')
    const p = (await propose(tolu, s.workId, s.chapter.id)).json() as Detail
    expect((await act(tolu, p.id, 'withdraw')).json()).toMatchObject({ status: 'withdrawn', actions: [] })

    const second = (
      await s.owner.call('POST', `/api/v1/works/${s.workId}/chapters`, { title: 'Two' })
    ).json() as { id: string }
    const q = (await propose(tolu, s.workId, second.id)).json() as Detail
    await act(tolu, q.id, 'submit')
    expect((await s.owner.call('DELETE', `/api/v1/chapters/${second.id}`)).statusCode).toBe(204)
    expect(((await tolu.call('GET', `/api/v1/proposals/${q.id}`)).json() as Detail).status).toBe('superseded')
    const closed = (
      (await tolu.call('GET', `/api/v1/works/${s.workId}/proposals?status=closed`)).json() as {
        items: { id: string }[]
      }
    ).items
    expect(closed.map((x) => x.id).sort()).toEqual([p.id, q.id].sort())
  })
})

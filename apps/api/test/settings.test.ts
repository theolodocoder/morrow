import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { and, eq } from 'drizzle-orm'
import { activityEvents, workMembers } from '@morrow/db'
import { setup, signUp } from './setup.ts'

let ctx: Awaited<ReturnType<typeof setup>>
beforeAll(async () => {
  ctx = await setup('settings')
})
afterAll(async () => {
  await ctx.app.close()
  await ctx.db.pool.end()
})

type User = Awaited<ReturnType<typeof signUp>>
const work = async (owner: User) =>
  (
    await owner.call('POST', '/api/v1/works', { title: 'Field Notes', category: 'research_paper' })
  ).json() as { id: string; category: string; publicPath: string; collaborationMode: string; license: string }
const chaptersOf = async (u: User, workId: string) =>
  (
    (await u.call('GET', `/api/v1/works/${workId}/chapters`)).json() as {
      items: { id: string; documentId: string }[]
    }
  ).items
const ticket = async (u: User, documentId: string) =>
  ((await u.call('POST', '/api/v1/collab/tickets', { documentId })).json() as { mode: string }).mode

describe('work settings (PRD FR-004/005/013)', () => {
  it('creates with a PRD category, conservative license and direct mode, and a public path', async () => {
    const owner = await signUp(ctx.app)
    const w = await work(owner)
    expect(w).toMatchObject({
      category: 'research_paper',
      collaborationMode: 'direct',
      license: 'all_rights_reserved',
    })
    expect(w.publicPath).toMatch(/^field-notes-[0-9a-f]{10}$/)
  })

  it('updates tags, warnings, license and category; labels are normalised and de-duplicated', async () => {
    const owner = await signUp(ctx.app)
    const w = await work(owner)
    const res = await owner.call('PATCH', `/api/v1/works/${w.id}`, {
      tags: ['Grief', 'grief', ' Orchards '],
      contentWarnings: ['Death'],
      license: 'cc_by',
      category: 'poetry',
    })
    expect(res.json()).toMatchObject({
      tags: ['grief', 'orchards'],
      contentWarnings: ['death'],
      license: 'cc_by',
      category: 'poetry',
    })
  })

  it('visibility and mode changes are audited; non-owners cannot change settings', async () => {
    const owner = await signUp(ctx.app)
    const w = await work(owner)
    const editor = await signUp(ctx.app)
    await ctx.db.db
      .insert(workMembers)
      .values({ workId: w.id, userId: editor.id, role: 'editor', grantedBy: owner.id })
    expect((await editor.call('PATCH', `/api/v1/works/${w.id}`, { visibility: 'public' })).statusCode).toBe(
      403,
    )
    await owner.call('PATCH', `/api/v1/works/${w.id}`, { visibility: 'unlisted', collaborationMode: 'mixed' })
    const events = await ctx.db.db
      .select({ type: activityEvents.type, data: activityEvents.data })
      .from(activityEvents)
      .where(eq(activityEvents.workId, w.id))
    expect(events).toContainEqual({
      type: 'work.visibility_changed',
      data: { from: 'private', to: 'unlisted' },
    })
    expect(events).toContainEqual({
      type: 'work.collaboration_mode_changed',
      data: { from: 'direct', to: 'mixed' },
    })
  })

  it('the collaboration mode decides who writes directly, and changing it reconnects members', async () => {
    const owner = await signUp(ctx.app)
    const w = await work(owner)
    const collaborator = await signUp(ctx.app)
    await ctx.db.db
      .insert(workMembers)
      .values({ workId: w.id, userId: collaborator.id, role: 'collaborator', grantedBy: owner.id })
    const [c] = await chaptersOf(owner, w.id)
    expect(await ticket(collaborator, c!.documentId)).toBe('edit') // direct
    ctx.revocations.length = 0
    await owner.call('PATCH', `/api/v1/works/${w.id}`, { collaborationMode: 'mixed' })
    expect(await ticket(collaborator, c!.documentId)).toBe('read') // must propose now
    expect(ctx.revocations.map((r) => r.userId).sort()).toEqual([owner.id, collaborator.id].sort())
    await owner.call('PATCH', `/api/v1/works/${w.id}`, { collaborationMode: 'proposal' })
    const editor = await signUp(ctx.app)
    await ctx.db.db
      .insert(workMembers)
      .values({ workId: w.id, userId: editor.id, role: 'editor', grantedBy: owner.id })
    expect(await ticket(editor, c!.documentId)).toBe('read')
    expect(await ticket(owner, c!.documentId)).toBe('edit')
  })

  it('a section can override the work’s mode, and only the owner can set it', async () => {
    const owner = await signUp(ctx.app)
    const w = await work(owner)
    const collaborator = await signUp(ctx.app)
    await ctx.db.db
      .insert(workMembers)
      .values({ workId: w.id, userId: collaborator.id, role: 'collaborator', grantedBy: owner.id })
    const [c] = await chaptersOf(owner, w.id)
    expect(
      (await collaborator.call('PATCH', `/api/v1/chapters/${c!.id}`, { collaborationMode: 'proposal' }))
        .statusCode,
    ).toBe(403)
    const res = await owner.call('PATCH', `/api/v1/chapters/${c!.id}`, {
      collaborationMode: 'proposal',
      description: 'The opening; changes go through review.',
    })
    expect(res.json()).toMatchObject({
      collaborationMode: 'proposal',
      description: 'The opening; changes go through review.',
    })
    expect(await ticket(collaborator, c!.documentId)).toBe('read')
    await owner.call('PATCH', `/api/v1/chapters/${c!.id}`, { collaborationMode: null })
    expect(await ticket(collaborator, c!.documentId)).toBe('edit') // inherits direct again
    const [ev] = await ctx.db.db
      .select()
      .from(activityEvents)
      .where(
        and(eq(activityEvents.workId, w.id), eq(activityEvents.type, 'chapter.collaboration_mode_changed')),
      )
    expect(ev).toBeTruthy()
  })
})

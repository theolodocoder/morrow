import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { documentProjections } from '@morrow/db'
import { processOutbox } from '../src/notifications.ts'
import { setup, signUp } from './setup.ts'

let ctx: Awaited<ReturnType<typeof setup>>
beforeAll(async () => {
  ctx = await setup('contributions')
})
afterAll(async () => {
  await ctx.app.close()
  await ctx.db.pool.end()
})

type User = Awaited<ReturnType<typeof signUp>>
const pub = (path: string) => ctx.app.inject({ method: 'GET', url: `/api/v1/public${path}` })

async function published(owner: User, title: string) {
  const w = (await owner.call('POST', '/api/v1/works', { title, category: 'short_story' })).json() as {
    id: string
  }
  const chapters = (
    (await owner.call('GET', `/api/v1/works/${w.id}/chapters`)).json() as { items: { documentId: string }[] }
  ).items
  const v = {
    documentId: chapters[0]!.documentId,
    workId: w.id,
    contentJson: {
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Words.' }] }],
    },
    plainText: 'Words.',
    wordCount: 1,
    sourceRevision: Date.now(),
  }
  await ctx.db.db
    .insert(documentProjections)
    .values(v)
    .onConflictDoUpdate({ target: documentProjections.documentId, set: v })
  const p = (await owner.call('POST', `/api/v1/works/${w.id}/publish`, { visibility: 'public' })).json() as {
    publicPath: string
  }
  return { id: w.id, publicPath: p.publicPath }
}

describe('ask to collaborate (P-050)', () => {
  it('anyone signed in may ask once; the owner accepts and they join as a contributor', async () => {
    const ama = await signUp(ctx.app, 'Ama Owner')
    const bo = await signUp(ctx.app, 'Bo Asker')
    const w = await published(ama, 'Open Door')

    const state = async (u: User) =>
      (await u.call('GET', `/api/v1/contributions/state?publicPath=${w.publicPath}`)).json() as {
        member: boolean
        pending: boolean
      }
    expect(await state(bo)).toMatchObject({ member: false, pending: false })
    const asked = await bo.call('POST', '/api/v1/contribution-requests', {
      publicPath: w.publicPath,
      message: 'I draw maps; I could help with the coast chapters.',
    })
    expect(asked.statusCode).toBe(201)
    expect((await state(bo)).pending).toBe(true)
    // Once at a time, and never on your own work.
    expect(
      (await bo.call('POST', '/api/v1/contribution-requests', { publicPath: w.publicPath })).statusCode,
    ).toBe(409)
    expect(
      (await ama.call('POST', '/api/v1/contribution-requests', { publicPath: w.publicPath })).statusCode,
    ).toBe(409)
    // Signed out can't ask.
    expect([401, 403]).toContain(
      (
        await ctx.app.inject({
          method: 'POST',
          url: '/api/v1/contribution-requests',
          payload: { publicPath: w.publicPath },
        })
      ).statusCode,
    )

    // The owner sees it in Activity, with a notification.
    await processOutbox(ctx.db.db)
    const inbox = (await ama.call('GET', '/api/v1/me/notifications')).json() as { items: { title: string }[] }
    expect(inbox.items.map((n) => n.title)).toContain('Bo Asker asked to collaborate on “Open Door”')
    const waiting = (await ama.call('GET', '/api/v1/me/contribution-requests')).json() as {
      items: { id: string; message: string; requester: { displayName: string } }[]
    }
    expect(waiting.items).toHaveLength(1)
    expect(waiting.items[0]).toMatchObject({ requester: { displayName: 'Bo Asker' } })
    // Only someone who can add people may answer.
    expect(
      (await bo.call('POST', `/api/v1/contribution-requests/${waiting.items[0]!.id}/accept`)).statusCode,
    ).toBe(404)

    expect(
      (await ama.call('POST', `/api/v1/contribution-requests/${waiting.items[0]!.id}/accept`)).statusCode,
    ).toBe(204)
    expect(await state(bo)).toMatchObject({ member: true, pending: false })
    const work = (await bo.call('GET', `/api/v1/works/${w.id}`)).json() as { myRole: string }
    expect(work.myRole).toBe('contributor')
    await processOutbox(ctx.db.db)
    const told = (await bo.call('GET', '/api/v1/me/notifications')).json() as { items: { title: string }[] }
    expect(told.items.map((n) => n.title)).toContain('You’re in: you can now contribute to “Open Door”')
    expect(
      ((await ama.call('GET', '/api/v1/me/contribution-requests')).json() as { items: [] }).items,
    ).toEqual([])
  })

  it('declining tells them kindly; blocked people cannot ask', async () => {
    const ama = await signUp(ctx.app, 'Ama Decline')
    const cy = await signUp(ctx.app, 'Cy Asker')
    const w = await published(ama, 'Closed Room')
    const r = (
      await cy.call('POST', '/api/v1/contribution-requests', { publicPath: w.publicPath })
    ).json() as { id: string }
    expect((await ama.call('POST', `/api/v1/contribution-requests/${r.id}/decline`)).statusCode).toBe(204)
    expect((await ama.call('POST', `/api/v1/contribution-requests/${r.id}/accept`)).statusCode).toBe(409)

    const username = ((await cy.call('GET', '/api/v1/me/profile')).json() as { username: string }).username
    await ama.call('PUT', '/api/v1/me/blocks', { username })
    expect(
      (await cy.call('POST', '/api/v1/contribution-requests', { publicPath: w.publicPath })).statusCode,
    ).toBe(403)
  })
})

describe('covers (P-051)', () => {
  it('a generated cover until the writer picks one; the pick shows everywhere; null goes back', async () => {
    const ama = await signUp(ctx.app, 'Ama Cover')
    const w = await published(ama, 'Jacket')
    const before = (await pub(`/works/${w.publicPath}`)).json() as { cover: { layout: string } }
    expect(before.cover.layout).toBe('classic')
    const mine = (await ama.call('GET', `/api/v1/works/${w.id}`)).json() as { cover: unknown }
    expect(mine.cover).toEqual(before.cover) // the same cover in the app and in public

    const pick = { palette: 4, motif: 2, layout: 'band' }
    expect((await ama.call('PATCH', `/api/v1/works/${w.id}`, { cover: pick })).statusCode).toBe(200)
    expect(((await pub(`/works/${w.publicPath}`)).json() as { cover: unknown }).cover).toEqual(pick)
    const feed = (await pub('/feed?limit=30')).json() as { items: { publicPath: string; cover: unknown }[] }
    expect(feed.items.find((i) => i.publicPath === w.publicPath)?.cover).toEqual(pick)
    expect(
      (await ama.call('PATCH', `/api/v1/works/${w.id}`, { cover: { palette: 99, motif: 0, layout: 'band' } }))
        .statusCode,
    ).toBe(400)
    await ama.call('PATCH', `/api/v1/works/${w.id}`, { cover: null })
    expect(((await pub(`/works/${w.publicPath}`)).json() as { cover: unknown }).cover).toEqual(before.cover)
  })
})

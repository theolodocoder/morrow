import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import { user, works } from '@morrow/db'
import { ORIGIN, setup, signUp } from './setup.ts'

let ctx: Awaited<ReturnType<typeof setup>>
beforeAll(async () => {
  ctx = await setup('account')
})
afterAll(async () => {
  await ctx.app.close()
  await ctx.db.pool.end()
})

const auth = (url: string, payload: object) =>
  ctx.app.inject({ method: 'POST', url, headers: { origin: ORIGIN }, payload })
const lastMailTo = (to: string) => ctx.email.outbox.filter((m) => m.to === to).at(-1)

describe('forgot password', () => {
  it('emails a one-hour link; the token sets a new password and ends other sessions', async () => {
    const ama = await signUp(ctx.app, 'Ama Reset')
    // Sign-up also sends a confirmation email.
    expect(lastMailTo(ama.email)?.subject).toBe('Confirm your email for Morrow')

    const req = await auth('/api/auth/request-password-reset', {
      email: ama.email,
      redirectTo: '/reset-password',
    })
    expect(req.statusCode).toBe(200)
    // An unknown address gets the same answer (no account discovery).
    const unknown = await auth('/api/auth/request-password-reset', {
      email: 'nobody@example.test',
      redirectTo: '/reset-password',
    })
    expect(unknown.statusCode).toBe(200)
    await new Promise((r) => setTimeout(r, 50)) // sends aren't awaited
    const mail = lastMailTo(ama.email)!
    expect(mail.subject).toBe('Reset your Morrow password')
    const token = mail.text.match(/reset-password\/([^?\s]+)/)?.[1]
    expect(token).toBeTruthy()

    const reset = await auth('/api/auth/reset-password', { newPassword: 'a brand new password', token })
    expect(reset.statusCode).toBe(200)
    // The old session is gone; the new password works; the token can't be used twice.
    expect((await ama.call('GET', '/api/v1/me')).statusCode).toBe(401)
    expect(
      (await auth('/api/auth/sign-in/email', { email: ama.email, password: 'a brand new password' }))
        .statusCode,
    ).toBe(200)
    expect(
      (await auth('/api/auth/reset-password', { newPassword: 'another new password', token })).statusCode,
    ).toBe(400)
  })
})

describe('your data', () => {
  it('export downloads everything that’s yours as JSON', async () => {
    const ama = await signUp(ctx.app, 'Ama Export')
    await ama.call('POST', '/api/v1/works', { title: 'Mine To Keep' })
    const res = await ama.call('GET', '/api/v1/me/export')
    expect(res.statusCode).toBe(200)
    expect(res.headers['content-disposition']).toMatch(/attachment; filename="morrow-export-/)
    const data = res.json() as { account: { email: string }; works: { title: string; chapters: unknown[] }[] }
    expect(data.account.email).toBe(ama.email)
    expect(data.works.map((w) => w.title)).toEqual(['Mine To Keep'])
  })

  it('deleting needs the password; shared works pass on, solo works go, the person is erased', async () => {
    const ama = await signUp(ctx.app, 'Ama Leaving')
    const tolu = await signUp(ctx.app, 'Tolu Staying')
    const solo = (await ama.call('POST', '/api/v1/works', { title: 'Solo' })).json() as { id: string }
    const shared = (await ama.call('POST', '/api/v1/works', { title: 'Shared' })).json() as { id: string }
    const { workMembers } = await import('@morrow/db')
    await ctx.db.db
      .insert(workMembers)
      .values({ workId: shared.id, userId: tolu.id, role: 'editor', grantedBy: ama.id })

    const wrong = await ama.call('POST', '/api/v1/me/delete', {
      password: 'not it at all',
      confirm: 'DELETE',
    })
    expect(wrong.statusCode).toBe(403)
    expect(
      (await ama.call('POST', '/api/v1/me/delete', { password: 'correct horse battery' })).statusCode,
    ).toBe(400)
    const ok = await ama.call('POST', '/api/v1/me/delete', {
      password: 'correct horse battery',
      confirm: 'DELETE',
    })
    expect(ok.statusCode).toBe(204)

    const [s] = await ctx.db.db.select().from(works).where(eq(works.id, solo.id))
    expect(s!.deletedAt).not.toBeNull()
    const kept = (await tolu.call('GET', `/api/v1/works/${shared.id}`)).json() as { myRole: string }
    expect(kept.myRole).toBe('owner')
    const [u] = await ctx.db.db.select().from(user).where(eq(user.id, ama.id))
    expect(u).toMatchObject({ name: 'Deleted account', email: `deleted-${ama.id}@deleted.invalid` })
    // Signed out everywhere, and the old password no longer signs in.
    expect((await ama.call('GET', '/api/v1/me')).statusCode).toBe(401)
    expect(
      (await auth('/api/auth/sign-in/email', { email: ama.email, password: 'correct horse battery' }))
        .statusCode,
    ).toBe(401)
  })
})

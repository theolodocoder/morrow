import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import { staff, user } from '@morrow/db'
import { ORIGIN, setup, signUp } from './setup.ts'
import { secretFromUri, totp } from './totp.ts'

let ctx: Awaited<ReturnType<typeof setup>>
beforeAll(async () => {
  ctx = await setup('admin')
})
afterAll(async () => {
  await ctx.app.close()
  await ctx.db.pool.end()
})
async function staffer(role: 'moderator' | 'admin', twoFactor = true) {
  const u = await signUp(ctx.app, role === 'admin' ? 'Ada Admin' : 'Mo Mod')
  await ctx.db.db.insert(staff).values({ userId: u.id, role })
  if (twoFactor) await ctx.db.db.update(user).set({ twoFactorEnabled: true }).where(eq(user.id, u.id))
  return u
}
const cookieOf = (res: { headers: Record<string, unknown> }) =>
  [res.headers['set-cookie']]
    .flat()
    .map((c) => String(c).split(';')[0])
    .join('; ')

describe('staff tools need two-factor (admin app)', () => {
  it('no 2FA: refused with a clear reason; not staff: not found', async () => {
    const noTwoFactor = await staffer('moderator', false)
    const r = await noTwoFactor.call('GET', '/api/v1/moderation/reports')
    expect(r.statusCode).toBe(403)
    expect(r.json()).toMatchObject({ type: 'https://morrow.dev/problems/two-factor-required' })
    expect((await noTwoFactor.call('GET', '/api/v1/admin/users?q=ab')).statusCode).toBe(403)
    expect((await noTwoFactor.call('GET', '/api/v1/me/staff')).json()).toEqual({
      role: 'moderator',
      twoFactorEnabled: false,
    })
    const writer = await signUp(ctx.app, 'Writer')
    expect((await writer.call('GET', '/api/v1/admin/users?q=ab')).statusCode).toBe(404)
  })

  it('the real flow: enable TOTP, verify a code, sign in again needs the code', async () => {
    const u = await signUp(ctx.app, 'Real Two')
    const enabled = await u.call('POST', '/api/auth/two-factor/enable', { password: 'correct horse battery' })
    expect(enabled.statusCode).toBe(200)
    const { totpURI, backupCodes } = enabled.json() as { totpURI: string; backupCodes: string[] }
    expect(backupCodes.length).toBeGreaterThan(0)
    const secret = secretFromUri(totpURI)
    expect(
      (await u.call('POST', '/api/auth/two-factor/verify-totp', { code: totp(secret) })).statusCode,
    ).toBe(200)
    const [row] = await ctx.db.db.select({ on: user.twoFactorEnabled }).from(user).where(eq(user.id, u.id))
    expect(row!.on).toBe(true)

    // Signing in again stops at the second factor.
    const signIn = await ctx.app.inject({
      method: 'POST',
      url: '/api/auth/sign-in/email',
      headers: { origin: ORIGIN },
      payload: { email: u.email, password: 'correct horse battery' },
    })
    expect(signIn.json()).toMatchObject({ twoFactorRedirect: true })
    const pending = cookieOf(signIn)
    const wrong = await ctx.app.inject({
      method: 'POST',
      url: '/api/auth/two-factor/verify-totp',
      headers: { origin: ORIGIN, cookie: pending },
      payload: { code: '000000' },
    })
    expect(wrong.statusCode).toBeGreaterThanOrEqual(400)
    const right = await ctx.app.inject({
      method: 'POST',
      url: '/api/auth/two-factor/verify-totp',
      headers: { origin: ORIGIN, cookie: pending },
      payload: { code: totp(secret) },
    })
    expect(right.statusCode).toBe(200)
    const me = await ctx.app.inject({
      method: 'GET',
      url: '/api/v1/me',
      headers: { cookie: cookieOf(right) },
    })
    expect(me.json()).toMatchObject({ id: u.id })
  })
})

describe('admin actions', () => {
  it('moderators look people up; only admins comp plans or edit plans; everything is audited', async () => {
    const mod = await staffer('moderator')
    const admin = await staffer('admin')
    const writer = await signUp(ctx.app, 'Findable Writer')
    const found = (await mod.call('GET', '/api/v1/admin/users?q=Findable')).json() as {
      items: { id: string; plan: string }[]
    }
    expect(found.items).toMatchObject([{ id: writer.id, plan: 'free' }])
    expect(
      (
        await mod.call('PUT', `/api/v1/admin/users/${writer.id}/comp`, {
          planKey: 'studio',
          note: 'Beta partner',
        })
      ).statusCode,
    ).toBe(403)

    expect(
      (
        await admin.call('PUT', `/api/v1/admin/users/${writer.id}/comp`, {
          planKey: 'studio',
          note: 'Beta partner',
        })
      ).statusCode,
    ).toBe(204)
    expect((await writer.call('GET', '/api/v1/me/plan')).json()).toMatchObject({
      plan: { key: 'studio' },
      status: 'comped',
    })
    await admin.call('DELETE', `/api/v1/admin/users/${writer.id}/comp`, { note: 'Beta ended' })
    expect((await writer.call('GET', '/api/v1/me/plan')).json()).toMatchObject({ plan: { key: 'free' } })

    const plans = (await admin.call('GET', '/api/v1/admin/plans')).json() as {
      items: {
        key: string
        name: string
        description: string
        priceMonthly: number | null
        limits: object
        features: string[]
        active: boolean
      }[]
    }
    const free = plans.items.find((p) => p.key === 'free')!
    const edit = {
      name: free.name,
      description: free.description,
      priceMonthly: free.priceMonthly,
      limits: { ...free.limits, privateWorks: 30 },
      features: free.features,
      active: true,
    }
    expect((await mod.call('PUT', '/api/v1/admin/plans/free', edit)).statusCode).toBe(403)
    expect((await admin.call('PUT', '/api/v1/admin/plans/free', edit)).statusCode).toBe(204)
    expect(
      (
        (await ctx.app.inject({ method: 'GET', url: '/api/v1/public/plans' })).json() as {
          items: { key: string; limits: { privateWorks: number } }[]
        }
      ).items[0]!.limits.privateWorks,
    ).toBe(30)

    const audit = (await mod.call('GET', '/api/v1/admin/audit')).json() as {
      items: { kind: string; actor: string }[]
    }
    expect(audit.items.map((i) => i.kind)).toEqual(
      expect.arrayContaining(['comp_granted', 'comp_revoked', 'plan_updated']),
    )
    expect(audit.items.find((i) => i.kind === 'plan_updated')!.actor).toBe('Ada Admin')
  })
})

describe('beta feedback and metrics (Phase 7)', () => {
  it('feedback keeps only the path, reaches staff, and metrics are counts', async () => {
    const writer = await signUp(ctx.app, 'Beta Tester')
    expect(
      (
        await writer.call('POST', '/api/v1/feedback', {
          kind: 'bug',
          message: 'The save badge flickers.',
          path: '/app/works/1/edit/2?token=SECRET#x',
        })
      ).statusCode,
    ).toBe(201)
    expect((await writer.call('GET', '/api/v1/admin/feedback')).statusCode).toBe(404)
    const mod = await staffer('moderator')
    const inbox = (await mod.call('GET', '/api/v1/admin/feedback')).json() as {
      items: { id: string; message: string; path: string; from: string }[]
    }
    expect(inbox.items[0]).toMatchObject({
      message: 'The save badge flickers.',
      path: '/app/works/1/edit/2',
      from: 'Beta Tester',
    })
    await mod.call('PATCH', `/api/v1/admin/feedback/${inbox.items[0]!.id}`, { status: 'done' })
    expect(
      ((await mod.call('GET', '/api/v1/admin/feedback')).json() as { items: unknown[] }).items,
    ).toHaveLength(0)
    const m = (await mod.call('GET', '/api/v1/admin/metrics')).json() as {
      totals: { people: number }
      daily: { signups: number }[]
    }
    expect(m.daily).toHaveLength(30)
    expect(m.totals.people).toBeGreaterThan(0)
    expect(m.daily.at(-1)!.signups).toBeGreaterThan(0)
  })
})

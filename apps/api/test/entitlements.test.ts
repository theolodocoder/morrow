import { createHmac } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import { plans, subscriptions } from '@morrow/db'
import { buildApp } from '../src/app.ts'
import type { CollabGateway } from '../src/collab-gateway.ts'
import { verifyWebhook } from '../src/routes/billing.ts'
import { env, setup, signUp } from './setup.ts'

let ctx: Awaited<ReturnType<typeof setup>>
beforeAll(async () => {
  ctx = await setup('entitlements')
})
afterAll(async () => {
  await ctx.app.close()
  await ctx.db.pool.end()
})
type User = Awaited<ReturnType<typeof signUp>>
const newWork = (u: User, title = 'W') => u.call('POST', '/api/v1/works', { title, category: 'novel' })
async function withFreeLimits(
  limits: Partial<Record<'privateWorks' | 'membersPerWork' | 'branchesPerWork', number | null>>,
  fn: () => Promise<void>,
) {
  const [free] = await ctx.db.db.select().from(plans).where(eq(plans.key, 'free'))
  await ctx.db.db
    .update(plans)
    .set({ limits: { ...free!.limits, ...limits } })
    .where(eq(plans.key, 'free'))
  try {
    await fn()
  } finally {
    await ctx.db.db.update(plans).set({ limits: free!.limits }).where(eq(plans.key, 'free'))
  }
}

describe('plans and limits (PRD FR-033/034)', () => {
  it('the free plan is generous by default, and limits come from data, not code', async () => {
    const plansList = (await ctx.app.inject({ method: 'GET', url: '/api/v1/public/plans' })).json() as {
      items: { key: string; priceMonthly: number | null; limits: { privateWorks: number | null } }[]
    }
    expect(plansList.items.map((p) => p.key)).toEqual(['free', 'writer_plus', 'studio', 'organization'])
    expect(plansList.items[0]).toMatchObject({ priceMonthly: null, limits: { privateWorks: 25 } })
    const u = await signUp(ctx.app, 'Ama')
    await newWork(u)
    expect((await u.call('GET', '/api/v1/me/plan')).json()).toMatchObject({
      plan: { key: 'free' },
      status: 'free',
      usage: { privateWorks: 1 },
      billingEnabled: false,
    })
  })

  it('private works: enforced on the server, at creation; sharing frees room; nothing existing is touched', async () => {
    await withFreeLimits({ privateWorks: 2 }, async () => {
      const u = await signUp(ctx.app, 'Ama')
      await newWork(u, 'One')
      const two = (await newWork(u, 'Two')).json() as { id: string }
      const third = await newWork(u, 'Three')
      expect(third.statusCode).toBe(403)
      expect(third.json()).toMatchObject({ type: 'https://morrow.dev/problems/plan-limit' })
      await u.call('PATCH', `/api/v1/works/${two.id}`, { visibility: 'unlisted' })
      expect((await newWork(u, 'Three')).statusCode).toBe(201)
      expect((await u.call('PATCH', `/api/v1/works/${two.id}`, { visibility: 'private' })).statusCode).toBe(
        403,
      )
      expect(((await u.call('GET', '/api/v1/works')).json() as { items: unknown[] }).items).toHaveLength(3) // nothing removed
    })
  })

  it('a comped plan lifts the limit; it can be granted only by staff (outside the app)', async () => {
    await withFreeLimits({ privateWorks: 1 }, async () => {
      const u = await signUp(ctx.app, 'Ama')
      await newWork(u)
      expect((await newWork(u)).statusCode).toBe(403)
      await ctx.db.db.insert(subscriptions).values({
        userId: u.id,
        planKey: 'writer_plus',
        status: 'comped',
        source: 'comp',
        grantedBy: 'staff',
      })
      expect((await newWork(u)).statusCode).toBe(201)
      expect((await u.call('GET', '/api/v1/me/plan')).json()).toMatchObject({
        plan: { key: 'writer_plus' },
        status: 'comped',
      })
      expect((await u.call('POST', '/api/v1/me/plan/change', { planKey: 'studio' })).statusCode).toBe(409) // billing disabled
    })
  })

  it('people per work count members and waiting invitations; branches per work too', async () => {
    await withFreeLimits({ membersPerWork: 2, branchesPerWork: 1 }, async () => {
      const u = await signUp(ctx.app, 'Ama')
      const w = (await newWork(u)).json() as { id: string; defaultBranchId: string }
      expect(
        (
          await u.call('POST', `/api/v1/works/${w.id}/invitations`, {
            email: 'a@example.test',
            role: 'editor',
          })
        ).statusCode,
      ).toBe(201)
      expect(
        (
          await u.call('POST', `/api/v1/works/${w.id}/invitations`, {
            email: 'b@example.test',
            role: 'editor',
          })
        ).statusCode,
      ).toBe(403)
      expect(
        (
          await u.call('POST', `/api/v1/works/${w.id}/branches`, {
            name: 'Alt',
            fromBranchId: w.defaultBranchId,
          })
        ).statusCode,
      ).toBe(201)
      expect(
        (
          await u.call('POST', `/api/v1/works/${w.id}/branches`, {
            name: 'Alt 2',
            fromBranchId: w.defaultBranchId,
          })
        ).statusCode,
      ).toBe(403)
    })
  })
})

describe('billing webhook (runs only when billing is enabled)', () => {
  const secret = 's'.repeat(40)
  const sign = (body: string, t = Math.floor(Date.now() / 1000)) =>
    `t=${t},v1=${createHmac('sha256', secret).update(`${t}.${body}`).digest('hex')}`
  let billing: Awaited<ReturnType<typeof buildApp>>
  beforeAll(async () => {
    billing = await buildApp({
      env: { ...env, BILLING_ENABLED: true, BILLING_WEBHOOK_SECRET: secret },
      db: ctx.db.db,
      collab: {} as CollabGateway,
      email: ctx.email,
      logger: false,
    })
  })
  afterAll(() => billing.close())
  const hook = (app: typeof billing, body: object, signature?: string) => {
    const raw = JSON.stringify(body)
    return app.inject({
      method: 'POST',
      url: '/api/v1/billing/webhook',
      headers: { 'content-type': 'application/json', 'morrow-signature': signature ?? sign(raw) },
      payload: raw,
    })
  }

  it('is off while billing is disabled', async () => {
    expect(
      (await hook(ctx.app, { id: 'x', type: 'subscription.canceled', data: { userId: 'u' } })).statusCode,
    ).toBe(404)
  })

  it('applies signed events once; refuses bad signatures and replays of old events', async () => {
    const u = await signUp(ctx.app, 'Payer')
    const ev = {
      id: `evt_${u.id}`,
      type: 'subscription.updated',
      data: {
        userId: u.id,
        planKey: 'studio',
        status: 'active',
        currentPeriodEnd: new Date(Date.now() + 864e5).toISOString(),
        invoice: { ref: `inv_${u.id}`, amount: 2400, currency: 'USD' },
      },
    }
    expect((await hook(billing, ev)).statusCode).toBe(204)
    expect((await hook(billing, ev)).statusCode).toBe(204) // provider retry: applied once
    expect((await u.call('GET', '/api/v1/me/plan')).json()).toMatchObject({
      plan: { key: 'studio' },
      status: 'active',
      invoices: [{ amount: 2400, status: 'paid' }],
    })
    expect((await hook(billing, { ...ev, id: 'evt_forged' }, 't=1,v1=00')).statusCode).toBe(400)
    const raw = JSON.stringify({ ...ev, id: 'evt_old' })
    expect(
      (await hook(billing, { ...ev, id: 'evt_old' }, sign(raw, Math.floor(Date.now() / 1000) - 3600)))
        .statusCode,
    ).toBe(400)

    await hook(billing, { id: `evt2_${u.id}`, type: 'invoice.payment_failed', data: { userId: u.id } })
    expect((await u.call('GET', '/api/v1/me/plan')).json()).toMatchObject({
      plan: { key: 'studio' },
      status: 'past_due',
    }) // kept during retries
    await hook(billing, { id: `evt3_${u.id}`, type: 'subscription.canceled', data: { userId: u.id } })
    expect((await u.call('GET', '/api/v1/me/plan')).json()).toMatchObject({ plan: { key: 'free' } })
  })

  it('signature verification is constant-time and timestamped', () => {
    const raw = '{"a":1}'
    expect(verifyWebhook(secret, sign(raw), raw)).toBe(true)
    expect(verifyWebhook(secret, sign(raw), raw + ' ')).toBe(false)
    expect(verifyWebhook(secret, undefined, raw)).toBe(false)
  })
})

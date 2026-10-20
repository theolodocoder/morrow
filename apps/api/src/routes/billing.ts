/**
 * Plans and billing (PRD FR-033). Billing can run disabled (the default): plans are visible and admins can comp them,
 * but nothing is for sale. When a provider is chosen, its events are mapped onto the neutral webhook below.
 *
 * Webhook contract (provider-agnostic):
 *   header  morrow-signature: t=<unix seconds>,v1=<hex HMAC-SHA256 of "<t>.<raw body>" with BILLING_WEBHOOK_SECRET>
 *   body    { id, type, data } with type one of subscription.updated | subscription.canceled | invoice.paid |
 *           invoice.payment_failed. Events older than 5 minutes are refused (replay protection); each id is applied once.
 */
import { createHmac, timingSafeEqual } from 'node:crypto'
import type { FastifyPluginAsync } from 'fastify'
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod'
import { z } from 'zod'
import { asc, desc, eq, sql } from 'drizzle-orm'
import { MyPlan, PlanInfo, PROBLEM, type MyPlan as MyPlanT } from '@morrow/contracts'
import { billingEvents, invoices, plans, subscriptions, type Database } from '@morrow/db'
import type { ApiEnv } from '../env.ts'
import { planFor, privateWorkCount, toPlanInfo } from '../entitlements.ts'
import { HttpProblem, conflict, notFound } from '../problems.ts'

export const planRoutes: FastifyPluginAsyncZod<{ db: Database; env: ApiEnv }> = async (app, { db, env }) => {
  app.get('/me/plan', { schema: { response: { 200: MyPlan } } }, async (req) => {
    const me = req.user!.id
    const { plan, subscription } = await planFor(db, me)
    const history = await db
      .select()
      .from(invoices)
      .where(eq(invoices.userId, me))
      .orderBy(desc(invoices.createdAt))
      .limit(24)
    return {
      plan: toPlanInfo(plan),
      status: (subscription?.status ?? 'free') as MyPlanT['status'],
      currentPeriodEnd: subscription?.currentPeriodEnd?.toISOString() ?? null,
      cancelAtPeriodEnd: subscription?.cancelAtPeriodEnd ?? false,
      usage: { privateWorks: await privateWorkCount(db, me) },
      billingEnabled: env.BILLING_ENABLED,
      invoices: history.map((i) => ({
        amount: i.amount,
        currency: i.currency,
        status: i.status,
        createdAt: i.createdAt.toISOString(),
        hostedUrl: i.hostedUrl,
      })),
    }
  })

  // Upgrades, downgrades and cancellation go through the provider's checkout once billing is enabled.
  app.post(
    '/me/plan/change',
    { schema: { body: z.object({ planKey: z.string().max(40) }) } },
    async (req) => {
      if (!env.BILLING_ENABLED)
        throw conflict(
          'Paid plans aren’t available yet. Everything you need to write and collaborate is free.',
        )
      const [p] = await db.select().from(plans).where(eq(plans.key, req.body.planKey))
      if (!p || !p.active) throw notFound()
      throw new HttpProblem(
        501,
        PROBLEM.internal,
        'Checkout isn’t connected yet.',
        'A payment provider still needs to be chosen (T-007).',
      )
    },
  )
}

/** Public: the plans people can see (prices are hypotheses until billing opens). */
export const publicPlanRoutes: FastifyPluginAsyncZod<{ db: Database }> = async (app, { db }) => {
  app.get('/plans', { schema: { response: { 200: z.object({ items: z.array(PlanInfo) }) } } }, async () => {
    const rows = await db.select().from(plans).where(eq(plans.active, true)).orderBy(asc(plans.sortOrder))
    return { items: rows.map(toPlanInfo) }
  })
}

const WebhookEvent = z.object({
  id: z.string().min(1).max(200),
  type: z.enum(['subscription.updated', 'subscription.canceled', 'invoice.paid', 'invoice.payment_failed']),
  data: z.object({
    userId: z.string().max(64),
    planKey: z.string().max(40).optional(),
    status: z.enum(['active', 'trialing', 'past_due', 'canceled']).optional(),
    providerRef: z.string().max(200).optional(),
    currentPeriodEnd: z.iso.datetime({ offset: true }).optional(),
    cancelAtPeriodEnd: z.boolean().optional(),
    invoice: z
      .object({
        ref: z.string().max(200),
        amount: z.number().int(),
        currency: z.string().max(8),
        hostedUrl: z.string().url().optional(),
      })
      .optional(),
  }),
})

/** Verify `t=…,v1=…` against the raw body in constant time; refuse stale timestamps. */
export function verifyWebhook(secret: string, header: string | undefined, raw: string, now = Date.now()) {
  if (!header) return false
  const parts = Object.fromEntries(header.split(',').map((kv) => kv.split('=') as [string, string]))
  const t = Number(parts.t)
  if (!Number.isFinite(t) || Math.abs(now / 1000 - t) > 300) return false
  const expected = createHmac('sha256', secret).update(`${t}.${raw}`).digest()
  const given = Buffer.from(parts.v1 ?? '', 'hex')
  return given.length === expected.length && timingSafeEqual(given, expected)
}

/** The provider's webhook. Raw body (needed for the signature) lives in its own plugin with its own parser. */
export const billingWebhookRoutes: FastifyPluginAsync<{ db: Database; env: ApiEnv }> = async (
  app,
  { db, env },
) => {
  app.addContentTypeParser('application/json', { parseAs: 'string' }, (_req, body, done) => done(null, body))
  app.post(
    '/billing/webhook',
    { config: { rateLimit: { max: 600, timeWindow: '1 minute' } } },
    async (req, reply) => {
      if (!env.BILLING_ENABLED || !env.BILLING_WEBHOOK_SECRET) throw notFound()
      const raw = String(req.body ?? '')
      const header = req.headers['morrow-signature']
      if (!verifyWebhook(env.BILLING_WEBHOOK_SECRET, typeof header === 'string' ? header : undefined, raw))
        throw new HttpProblem(400, PROBLEM.validation, 'Bad signature.')
      const event = WebhookEvent.parse(JSON.parse(raw))
      await db.transaction(async (tx) => {
        const [fresh] = await tx
          .insert(billingEvents)
          .values({ eventId: event.id, type: event.type })
          .onConflictDoNothing()
          .returning()
        if (!fresh) return // a retry: already applied
        const d = event.data
        if (event.type === 'subscription.updated' && d.planKey && d.status) {
          const values = {
            userId: d.userId,
            planKey: d.planKey,
            status: d.status,
            source: 'provider' as const,
            providerRef: d.providerRef ?? null,
            currentPeriodEnd: d.currentPeriodEnd ? new Date(d.currentPeriodEnd) : null,
            cancelAtPeriodEnd: d.cancelAtPeriodEnd ?? false,
          }
          await tx
            .insert(subscriptions)
            .values(values)
            .onConflictDoUpdate({ target: subscriptions.userId, set: { ...values, updatedAt: sql`now()` } })
        } else if (event.type === 'subscription.canceled') {
          await tx
            .update(subscriptions)
            .set({ status: 'canceled', updatedAt: sql`now()` })
            .where(eq(subscriptions.userId, d.userId))
        } else if (event.type === 'invoice.payment_failed') {
          // Keep the plan through the provider's retries; the person is told and can fix the card.
          await tx
            .update(subscriptions)
            .set({ status: 'past_due', updatedAt: sql`now()` })
            .where(eq(subscriptions.userId, d.userId))
        }
        if (d.invoice) {
          const status = event.type === 'invoice.payment_failed' ? 'failed' : 'paid'
          await tx
            .insert(invoices)
            .values({
              userId: d.userId,
              providerRef: d.invoice.ref,
              amount: d.invoice.amount,
              currency: d.invoice.currency,
              status,
              hostedUrl: d.invoice.hostedUrl ?? null,
            })
            .onConflictDoUpdate({ target: invoices.providerRef, set: { status } })
        }
      })
      return reply.status(204).send()
    },
  )
}

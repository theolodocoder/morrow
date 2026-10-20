/**
 * Entitlements (PRD FR-033/034): what a person's plan allows, checked on the server for every limited action.
 * Limits apply when you create something; nothing you already have is removed or locked by a downgrade.
 */
import { and, eq, inArray, isNull, sql } from 'drizzle-orm'
import { PROBLEM, type PlanInfo } from '@morrow/contracts'
import {
  branches,
  invitations,
  plans,
  subscriptions,
  workMembers,
  works,
  type Database,
  type PlanLimits,
} from '@morrow/db'
import { HttpProblem } from './problems.ts'

const DEFAULT_PLAN = 'free'
/** Statuses that grant the plan. Past-due keeps it during the provider's retry window. */
const GRANTING = ['active', 'trialing', 'past_due', 'comped'] as const

export async function planFor(db: Database, userId: string) {
  const [sub] = await db
    .select()
    .from(subscriptions)
    .where(and(eq(subscriptions.userId, userId), inArray(subscriptions.status, [...GRANTING])))
  const live =
    sub && (sub.status === 'comped' || !sub.currentPeriodEnd || sub.currentPeriodEnd > new Date())
      ? sub
      : null
  const [plan] = await db
    .select()
    .from(plans)
    .where(eq(plans.key, live?.planKey ?? DEFAULT_PLAN))
  const fallback = plan ?? (await db.select().from(plans).where(eq(plans.key, DEFAULT_PLAN)))[0]!
  return { plan: fallback, subscription: live }
}

export const toPlanInfo = (p: typeof plans.$inferSelect): PlanInfo => ({
  key: p.key,
  name: p.name,
  description: p.description,
  priceMonthly: p.priceMonthly,
  currency: p.currency,
  limits: p.limits,
  features: p.features,
})

function limitReached(what: string, limit: number, planName: string): never {
  throw new HttpProblem(
    403,
    PROBLEM.planLimit,
    `You’ve reached your plan’s limit of ${limit} ${what}.`,
    `${planName} includes ${limit} ${what}. See plans to raise it; nothing you already have is affected.`,
  )
}

export async function privateWorkCount(db: Database, ownerId: string) {
  const [r] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(works)
    .where(and(eq(works.ownerId, ownerId), eq(works.visibility, 'private'), isNull(works.deletedAt)))
  return r!.n
}

/** One more private work (creating one, or making a shared one private again). */
export async function assertCanAddPrivateWork(db: Database, ownerId: string) {
  const { plan } = await planFor(db, ownerId)
  const limit = (plan.limits as PlanLimits).privateWorks
  if (limit !== null && (await privateWorkCount(db, ownerId)) >= limit)
    limitReached('private works', limit, plan.name)
}

/** One more person on a work: members plus invitations still waiting, against the owner's plan. */
export async function assertCanAddMember(db: Database, workId: string, ownerId: string) {
  const { plan } = await planFor(db, ownerId)
  const limit = (plan.limits as PlanLimits).membersPerWork
  if (limit === null) return
  const [m] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(workMembers)
    .where(eq(workMembers.workId, workId))
  const [i] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(invitations)
    .where(
      and(
        eq(invitations.workId, workId),
        isNull(invitations.acceptedAt),
        isNull(invitations.revokedAt),
        sql`${invitations.expiresAt} > now()`,
      ),
    )
  if (m!.n + i!.n >= limit) limitReached('people per work', limit, plan.name)
}

export async function assertCanAddBranch(db: Database, workId: string, ownerId: string) {
  const { plan } = await planFor(db, ownerId)
  const limit = (plan.limits as PlanLimits).branchesPerWork
  if (limit === null) return
  const [b] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(branches)
    .where(and(eq(branches.workId, workId), eq(branches.isDefault, false), isNull(branches.archivedAt)))
  if (b!.n >= limit) limitReached('branches per work', limit, plan.name)
}

export async function assertCanExport(db: Database, ownerId: string, format: string) {
  const { plan } = await planFor(db, ownerId)
  if (!(plan.limits as PlanLimits).exportFormats.includes(format))
    throw new HttpProblem(
      403,
      PROBLEM.planLimit,
      `${format} export isn’t included in ${plan.name}.`,
      'See plans for other export formats.',
    )
}

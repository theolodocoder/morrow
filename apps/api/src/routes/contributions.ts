/**
 * Contributing to a published work (P-050). Two ways in, from the work's Contribute button:
 * - suggest an edit (public participation, routes/proposals.ts `/suggestions`), when the writer allows it;
 * - ask to collaborate: a request the owner or an editor accepts (the person joins as a contributor) or declines.
 * Anyone signed in may ask; blocking stops it both ways, and a person can have one pending request per work.
 */
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod'
import { z } from 'zod'
import { and, desc, eq, inArray } from 'drizzle-orm'
import { ContributionRequest, ContributionState, CreateContributionRequestInput } from '@morrow/contracts'
import { contributionRequests, workMembers, works, type Database } from '@morrow/db'
import { requireWork } from '../access.ts'
import { recordActivity } from '../activity.ts'
import { assertCanAddMember } from '../entitlements.ts'
import { peopleByIds } from '../people.ts'
import { conflict, forbidden, notFound } from '../problems.ts'
import { blockedBetween } from '../safety.ts'
import { readableWork } from './publishing.ts'

const RequestId = z.object({ id: z.uuid() })
const publicPathOf = (w: { slug: string; publicId: string }) => `${w.slug}-${w.publicId}`

export const contributionRoutes: FastifyPluginAsyncZod<{ db: Database }> = async (app, { db }) => {
  async function toRequests(rows: (typeof contributionRequests.$inferSelect)[]) {
    if (!rows.length) return []
    const ws = await db
      .select({ id: works.id, title: works.title, slug: works.slug, publicId: works.publicId })
      .from(works)
      .where(inArray(works.id, [...new Set(rows.map((r) => r.workId))]))
    const byId = new Map(ws.map((w) => [w.id, w]))
    const people = await peopleByIds(
      db,
      rows.map((r) => r.requesterId),
    )
    return rows.flatMap((r) => {
      const w = byId.get(r.workId)
      const person = people.get(r.requesterId)
      if (!w || !person) return []
      return [
        {
          id: r.id,
          status: r.status as ContributionRequest['status'],
          message: r.message,
          createdAt: r.createdAt.toISOString(),
          work: { id: w.id, title: w.title, publicPath: publicPathOf(w) },
          requester: person,
        },
      ]
    })
  }

  app.get(
    '/contributions/state',
    {
      schema: {
        querystring: z.object({ publicPath: z.string().min(3).max(200) }),
        response: { 200: ContributionState },
      },
    },
    async (req) => {
      const w = await readableWork(db, req.query.publicPath)
      if (!w) throw notFound()
      const me = req.user!.id
      const [member] = await db
        .select({ id: workMembers.userId })
        .from(workMembers)
        .where(and(eq(workMembers.workId, w.id), eq(workMembers.userId, me)))
      const [pending] = await db
        .select({ id: contributionRequests.id })
        .from(contributionRequests)
        .where(
          and(
            eq(contributionRequests.workId, w.id),
            eq(contributionRequests.requesterId, me),
            eq(contributionRequests.status, 'pending'),
          ),
        )
      return {
        member: !!member || w.ownerId === me,
        pending: !!pending,
        openToSuggestions: w.participation !== 'none',
      }
    },
  )

  app.post(
    '/contribution-requests',
    {
      schema: { body: CreateContributionRequestInput, response: { 201: ContributionRequest } },
      config: { rateLimit: { max: 20, timeWindow: '1 hour' } },
    },
    async (req, reply) => {
      const me = req.user!.id
      const w = await readableWork(db, req.body.publicPath)
      if (!w) throw notFound()
      if (w.ownerId === me) throw conflict('This is your work.')
      if (await blockedBetween(db, me, w.ownerId)) throw forbidden()
      const [member] = await db
        .select({ id: workMembers.userId })
        .from(workMembers)
        .where(and(eq(workMembers.workId, w.id), eq(workMembers.userId, me)))
      if (member) throw conflict('You’re already part of this work.')
      const row = await db.transaction(async (tx) => {
        const [r] = await tx
          .insert(contributionRequests)
          .values({ workId: w.id, requesterId: me, message: req.body.message })
          .onConflictDoNothing()
          .returning()
        if (!r) return null
        await recordActivity(tx, {
          workId: w.id,
          actorId: me,
          type: 'request.created',
          subjectType: 'contribution_request',
          subjectId: r.id,
        })
        return r
      })
      if (!row) throw conflict('You’ve already asked. The writer will see your request in their Activity.')
      const [out] = await toRequests([row])
      return reply.status(201).send(out!)
    },
  )

  /** Requests waiting on me: for works I can add people to (owner, editors). */
  app.get(
    '/me/contribution-requests',
    { schema: { response: { 200: z.object({ items: z.array(ContributionRequest) }) } } },
    async (req) => {
      const me = req.user!.id
      const [owned, editing] = await Promise.all([
        db.select({ id: works.id }).from(works).where(eq(works.ownerId, me)),
        db
          .select({ id: workMembers.workId })
          .from(workMembers)
          .where(and(eq(workMembers.userId, me), eq(workMembers.role, 'editor'))),
      ])
      const mine = [...new Set([...owned, ...editing].map((w) => w.id))]
      if (!mine.length) return { items: [] }
      const rows = await db
        .select()
        .from(contributionRequests)
        .where(and(inArray(contributionRequests.workId, mine), eq(contributionRequests.status, 'pending')))
        .orderBy(desc(contributionRequests.createdAt))
        .limit(50)
      return { items: await toRequests(rows) }
    },
  )

  async function decide(id: string, me: string, accept: boolean) {
    const [r] = await db.select().from(contributionRequests).where(eq(contributionRequests.id, id))
    if (!r) throw notFound()
    const { work } = await requireWork(db, r.workId, me, 'work.manage_members')
    if (r.status !== 'pending') throw conflict('This request has already been answered.')
    if (accept) await assertCanAddMember(db, work.id, work.ownerId)
    await db.transaction(async (tx) => {
      await tx
        .update(contributionRequests)
        .set({ status: accept ? 'accepted' : 'declined', decidedBy: me, decidedAt: new Date() })
        .where(eq(contributionRequests.id, r.id))
      if (accept)
        await tx
          .insert(workMembers)
          .values({ workId: work.id, userId: r.requesterId, role: 'contributor', grantedBy: me })
          .onConflictDoNothing()
      await recordActivity(tx, {
        workId: work.id,
        actorId: me,
        type: accept ? 'request.accepted' : 'request.declined',
        subjectType: 'contribution_request',
        subjectId: r.id,
        data: { requesterId: r.requesterId },
      })
    })
  }

  app.post('/contribution-requests/:id/accept', { schema: { params: RequestId } }, async (req, reply) => {
    await decide(req.params.id, req.user!.id, true)
    return reply.status(204).send()
  })
  app.post('/contribution-requests/:id/decline', { schema: { params: RequestId } }, async (req, reply) => {
    await decide(req.params.id, req.user!.id, false)
    return reply.status(204).send()
  })
}

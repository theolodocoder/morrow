import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod'
import { z } from 'zod'
import { createHash, randomBytes } from 'node:crypto'
import { and, asc, desc, eq, gt, isNull, sql } from 'drizzle-orm'
import {
  AcceptedInvitation,
  CreateInvitationInput,
  CreatedInvitation,
  Invitation,
  InvitationPreview,
  Member,
  UpdateMemberInput,
} from '@morrow/contracts'
import { invitations, user, workMembers, works, type Database } from '@morrow/db'
import type { ApiEnv } from '../env.ts'
import type { CollabGateway } from '../collab-gateway.ts'
import type { EmailSender } from '../email.ts'
import { requireWork } from '../access.ts'
import { recordActivity } from '../activity.ts'
import { blockedBetween } from '../safety.ts'
import { assertCanAddMember } from '../entitlements.ts'
import { conflict, forbidden, HttpProblem, notFound } from '../problems.ts'
import { PROBLEM } from '@morrow/contracts'

const INVITE_TTL_DAYS = 7
const WorkParams = z.object({ workId: z.uuid() })
const MemberParams = z.object({ workId: z.uuid(), userId: z.string().min(1) })
const TokenParams = z.object({ token: z.string().min(20).max(200) })

const hashToken = (token: string) => createHash('sha256').update(token).digest('hex')
const maskEmail = (email: string) => {
  const [local = '', domain = ''] = email.split('@')
  return `${local.slice(0, 1)}***@${domain}`
}
const toInvitation = (i: typeof invitations.$inferSelect): Invitation => ({
  id: i.id,
  email: i.email,
  role: i.role as Invitation['role'],
  invitedBy: i.invitedBy,
  expiresAt: i.expiresAt.toISOString(),
  createdAt: i.createdAt.toISOString(),
})

interface Deps {
  db: Database
  env: ApiEnv
  collab: CollabGateway
  email: EmailSender
}

/** Revocation must never fail the request: collab's periodic re-check is the backstop (spike S3). */
async function revokeQuietly(
  collab: CollabGateway,
  input: { workId: string; userId: string },
  log: { warn: (o: object, m: string) => void },
) {
  try {
    await collab.revokeAccess(input)
  } catch (err) {
    log.warn({ err, ...input }, 'collab revoke failed; periodic re-check will close the connection')
  }
}

/** Routes for signed-in callers. */
export const memberRoutes: FastifyPluginAsyncZod<Deps> = async (app, { db, env, collab, email }) => {
  app.get(
    '/works/:workId/members',
    { schema: { params: WorkParams, response: { 200: z.object({ items: z.array(Member) }) } } },
    async (req) => {
      const access = await requireWork(db, req.params.workId, req.user!.id, 'work.read')
      const seeEmails = access.capabilities.includes('work.manage_members')
      const rows = await db
        .select({ m: workMembers, name: user.name, email: user.email })
        .from(workMembers)
        .innerJoin(user, eq(user.id, workMembers.userId))
        .where(eq(workMembers.workId, access.work.id))
        .orderBy(asc(workMembers.createdAt))
      return {
        items: rows.map((r) => ({
          userId: r.m.userId,
          name: r.name,
          email: seeEmails ? r.email : null,
          role: r.m.role,
          joinedAt: r.m.createdAt.toISOString(),
        })),
      }
    },
  )

  app.get(
    '/works/:workId/invitations',
    { schema: { params: WorkParams, response: { 200: z.object({ items: z.array(Invitation) }) } } },
    async (req) => {
      const { work } = await requireWork(db, req.params.workId, req.user!.id, 'work.manage_members')
      const rows = await db
        .select()
        .from(invitations)
        .where(
          and(
            eq(invitations.workId, work.id),
            isNull(invitations.acceptedAt),
            isNull(invitations.revokedAt),
            gt(invitations.expiresAt, sql`now()`),
          ),
        )
        .orderBy(desc(invitations.createdAt))
      return { items: rows.map(toInvitation) }
    },
  )

  app.post(
    '/works/:workId/invitations',
    {
      schema: { params: WorkParams, body: CreateInvitationInput, response: { 201: CreatedInvitation } },
      config: { rateLimit: { max: 30, timeWindow: '1 hour' } },
    },
    async (req, reply) => {
      const inviter = req.user!
      const { work } = await requireWork(db, req.params.workId, inviter.id, 'work.manage_members')
      const [existing] = await db
        .select({ id: workMembers.userId })
        .from(workMembers)
        .innerJoin(user, eq(user.id, workMembers.userId))
        .where(and(eq(workMembers.workId, work.id), sql`lower(${user.email}) = ${req.body.email}`))
      if (existing) throw conflict('That person is already a member of this work.')
      await assertCanAddMember(db, work.id, work.ownerId)
      // Blocking (FR-032): neither can pull the other into a work.
      const [invitee] = await db
        .select({ id: user.id })
        .from(user)
        .where(sql`lower(${user.email}) = ${req.body.email}`)
      if (invitee && (await blockedBetween(db, req.user!.id, invitee.id)))
        throw conflict('You can’t invite this person.')

      const token = randomBytes(32).toString('base64url')
      const created = await db.transaction(async (tx) => {
        // One live invitation per address: a new one replaces the old link.
        await tx
          .update(invitations)
          .set({ revokedAt: sql`now()` })
          .where(
            and(
              eq(invitations.workId, work.id),
              eq(invitations.email, req.body.email),
              isNull(invitations.acceptedAt),
              isNull(invitations.revokedAt),
            ),
          )
        const [inv] = await tx
          .insert(invitations)
          .values({
            workId: work.id,
            email: req.body.email,
            role: req.body.role,
            tokenHash: hashToken(token),
            invitedBy: inviter.id,
            expiresAt: sql`now() + ${`${INVITE_TTL_DAYS} days`}::interval`,
          })
          .returning()
        await recordActivity(tx, {
          workId: work.id,
          actorId: inviter.id,
          type: 'member.invited',
          subjectType: 'invitation',
          subjectId: inv!.id,
          data: { role: req.body.role },
        })
        return inv!
      })
      const inviteUrl = `${env.WEB_ORIGIN}/invite/${token}`
      await email
        .send({
          to: created.email,
          subject: `${inviter.name} invited you to “${work.title}” on Morrow`,
          text: `${inviter.name} invited you to collaborate on “${work.title}” as ${created.role}.\n\nOpen this link to accept (it expires in ${INVITE_TTL_DAYS} days):\n${inviteUrl}\n`,
        })
        .catch((err) =>
          req.log.warn({ err }, 'invitation email failed; the link is still shown to the inviter'),
        )
      return reply.status(201).send({ ...toInvitation(created), inviteUrl })
    },
  )

  app.delete(
    '/invitations/:invitationId',
    { schema: { params: z.object({ invitationId: z.uuid() }) } },
    async (req, reply) => {
      const [inv] = await db.select().from(invitations).where(eq(invitations.id, req.params.invitationId))
      if (!inv) throw notFound()
      await requireWork(db, inv.workId, req.user!.id, 'work.manage_members')
      await db.transaction(async (tx) => {
        await tx
          .update(invitations)
          .set({ revokedAt: sql`now()` })
          .where(and(eq(invitations.id, inv.id), isNull(invitations.revokedAt)))
        await recordActivity(tx, {
          workId: inv.workId,
          actorId: req.user!.id,
          type: 'member.invitation_revoked',
          subjectType: 'invitation',
          subjectId: inv.id,
        })
      })
      return reply.status(204).send()
    },
  )

  app.post(
    '/invitations/:token/accept',
    {
      schema: { params: TokenParams, response: { 200: AcceptedInvitation } },
      config: { rateLimit: { max: 20, timeWindow: '1 minute' } },
    },
    async (req) => {
      const me = req.user!
      const [inv] = await db
        .select()
        .from(invitations)
        .where(eq(invitations.tokenHash, hashToken(req.params.token)))
      if (!inv || inv.revokedAt || inv.acceptedAt || inv.expiresAt <= new Date())
        throw new HttpProblem(410, PROBLEM.conflict, 'This invitation is no longer valid.')
      // The link is the secret; binding it to the invited address also stops forwarded links from working.
      if (me.email.toLowerCase() !== inv.email.toLowerCase())
        throw new HttpProblem(
          403,
          PROBLEM.forbidden,
          'This invitation was sent to a different email address.',
          `Sign in as ${maskEmail(inv.email)} to accept it.`,
        )
      await claimInvitation(db, inv, me.id)
      return { workId: inv.workId }
    },
  )

  app.patch(
    '/works/:workId/members/:userId',
    {
      schema: {
        params: MemberParams,
        body: UpdateMemberInput,
        response: { 200: z.object({ ok: z.literal(true) }) },
      },
    },
    async (req) => {
      const { work } = await requireWork(db, req.params.workId, req.user!.id, 'work.manage_members')
      if (req.params.userId === work.ownerId) throw conflict('The owner’s role cannot be changed.')
      const updated = await db.transaction(async (tx) => {
        const [m] = await tx
          .update(workMembers)
          .set({ role: req.body.role })
          .where(and(eq(workMembers.workId, work.id), eq(workMembers.userId, req.params.userId)))
          .returning()
        if (m)
          await recordActivity(tx, {
            workId: work.id,
            actorId: req.user!.id,
            type: 'member.role_changed',
            subjectType: 'member',
            subjectId: m.userId,
            data: { role: m.role },
          })
        return m
      })
      if (!updated) throw notFound()
      // Close and reconnect rather than flipping read-only in place: clients re-authenticate at the new role (spike S3).
      await revokeQuietly(collab, { workId: work.id, userId: req.params.userId }, req.log)
      return { ok: true as const }
    },
  )

  app.delete('/works/:workId/members/:userId', { schema: { params: MemberParams } }, async (req, reply) => {
    const me = req.user!.id
    const leaving = req.params.userId === me
    const { work } = await requireWork(
      db,
      req.params.workId,
      me,
      leaving ? 'work.read' : 'work.manage_members',
    )
    if (req.params.userId === work.ownerId)
      throw conflict('The owner can’t be removed. Transfer ownership first.')
    if (!leaving && !(await requireWork(db, work.id, me, 'work.manage_members'))) throw forbidden()
    const removed = await db.transaction(async (tx) => {
      const [m] = await tx
        .delete(workMembers)
        .where(and(eq(workMembers.workId, work.id), eq(workMembers.userId, req.params.userId)))
        .returning()
      if (m)
        await recordActivity(tx, {
          workId: work.id,
          actorId: me,
          type: leaving ? 'member.left' : 'member.removed',
          subjectType: 'member',
          subjectId: m.userId,
        })
      return m
    })
    if (!removed) throw notFound()
    await revokeQuietly(collab, { workId: work.id, userId: req.params.userId }, req.log)
    return reply.status(204).send()
  })
}

/** Routes that work signed out: previewing an invitation before signing up. */
export const publicInvitationRoutes: FastifyPluginAsyncZod<{ db: Database; env: ApiEnv }> = async (
  app,
  { db, env },
) => {
  app.get(
    '/invitations/:token',
    {
      schema: { params: TokenParams, response: { 200: InvitationPreview } },
      config: { rateLimit: { max: env.PUBLIC_RATE_LIMIT_PER_MINUTE, timeWindow: '1 minute' } },
    },
    async (req) => {
      const [row] = await db
        .select({ inv: invitations, title: works.title, inviter: user.name })
        .from(invitations)
        .innerJoin(works, eq(works.id, invitations.workId))
        .innerJoin(user, eq(user.id, invitations.invitedBy))
        .where(and(eq(invitations.tokenHash, hashToken(req.params.token)), isNull(works.deletedAt)))
      if (!row) throw notFound()
      const status: InvitationPreview['status'] = row.inv.revokedAt
        ? 'revoked'
        : row.inv.acceptedAt
          ? 'used'
          : row.inv.expiresAt <= new Date()
            ? 'expired'
            : 'pending'
      return {
        workTitle: row.title,
        invitedByName: row.inviter,
        role: row.inv.role as InvitationPreview['role'],
        emailHint: maskEmail(row.inv.email),
        status,
      }
    },
  )
}

/** Accept an invitation: claim it once, add the member, record it. Shared by the link and the inbox. */
export async function claimInvitation(db: Database, inv: typeof invitations.$inferSelect, userId: string) {
  await db.transaction(async (tx) => {
    const [claimed] = await tx
      .update(invitations)
      .set({ acceptedAt: sql`now()`, acceptedBy: userId })
      .where(and(eq(invitations.id, inv.id), isNull(invitations.acceptedAt), isNull(invitations.revokedAt)))
      .returning()
    if (!claimed) throw new HttpProblem(410, PROBLEM.conflict, 'This invitation is no longer valid.')
    await tx
      .insert(workMembers)
      .values({ workId: inv.workId, userId, role: inv.role, grantedBy: inv.invitedBy })
      .onConflictDoNothing()
    await recordActivity(tx, {
      workId: inv.workId,
      actorId: userId,
      type: 'member.joined',
      subjectType: 'member',
      subjectId: userId,
      data: { role: inv.role },
    })
  })
}

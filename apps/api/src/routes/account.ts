/**
 * Your account's data (privacy draft §6, GDPR Art. 15/17/20): download everything that's yours, or delete the account.
 *
 * Deleting keeps other people's work intact. Works you share are handed to the next person in line (an editor first,
 * then a collaborator, contributor, viewer; the longest-standing wins); works only you have are deleted. Your public
 * comments are removed, your name becomes "Deleted account" wherever it stays attached to shared history (proposals,
 * manuscript comments), and your sign-in, sessions, profile, follows, likes and notifications are erased.
 */
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod'
import { fromNodeHeaders } from 'better-auth/node'
import { z } from 'zod'
import { and, asc, desc, eq, inArray, isNull, ne, or, sql } from 'drizzle-orm'
import {
  account,
  blocks,
  bookmarks,
  chapters,
  comments,
  contributionRequests,
  documentProjections,
  featureWaitlist,
  follows,
  notificationPreferences,
  notifications,
  profileViews,
  profiles,
  proposals,
  reactions,
  readerComments,
  readingPositions,
  session,
  twoFactor,
  user,
  userAchievements,
  workLikes,
  workMembers,
  works,
  writingLog,
  type Database,
} from '@morrow/db'
import type { Auth } from '../auth.ts'
import { recordActivity } from '../activity.ts'
import { HttpProblem } from '../problems.ts'
import { PROBLEM } from '@morrow/contracts'

const SUCCESSION = ['editor', 'collaborator', 'contributor', 'viewer'] as const
export const DELETED_NAME = 'Deleted account'

export const accountRoutes: FastifyPluginAsyncZod<{ db: Database; auth: Auth }> = async (
  app,
  { db, auth },
) => {
  app.get('/me/export', { config: { rateLimit: { max: 5, timeWindow: '1 hour' } } }, async (req, reply) => {
    const me = req.user!.id
    const [u] = await db
      .select({ id: user.id, name: user.name, email: user.email, createdAt: user.createdAt })
      .from(user)
      .where(eq(user.id, me))
    const [profile] = await db.select().from(profiles).where(eq(profiles.userId, me))
    const memberships = await db
      .select({ workId: workMembers.workId, role: workMembers.role })
      .from(workMembers)
      .where(eq(workMembers.userId, me))
    const owned = await db
      .select()
      .from(works)
      .where(and(eq(works.ownerId, me), isNull(works.deletedAt)))
    // The current text of every chapter in works you own.
    const texts = owned.length
      ? await db
          .select({
            workId: chapters.workId,
            title: chapters.title,
            text: documentProjections.plainText,
            content: documentProjections.contentJson,
          })
          .from(chapters)
          .innerJoin(documentProjections, eq(documentProjections.documentId, chapters.documentId))
          .where(
            and(
              inArray(
                chapters.workId,
                owned.map((w) => w.id),
              ),
              isNull(chapters.deletedAt),
            ),
          )
          .orderBy(asc(chapters.position))
      : []
    const data = {
      exportedAt: new Date().toISOString(),
      account: u,
      profile,
      works: owned.map((w) => ({
        id: w.id,
        title: w.title,
        description: w.description,
        category: w.form,
        visibility: w.visibility,
        tags: w.tags,
        license: w.license,
        createdAt: w.createdAt,
        publishedAt: w.publishedAt,
        chapters: texts.filter((t) => t.workId === w.id).map(({ workId: _w, ...c }) => c),
      })),
      memberships,
      manuscriptComments: await db.select().from(comments).where(eq(comments.authorId, me)),
      readerComments: await db.select().from(readerComments).where(eq(readerComments.authorId, me)),
      proposals: await db.select().from(proposals).where(eq(proposals.authorId, me)),
      reactions: await db.select().from(reactions).where(eq(reactions.userId, me)),
      follows: await db.select().from(follows).where(eq(follows.followerId, me)),
      bookmarks: await db.select().from(bookmarks).where(eq(bookmarks.userId, me)),
      likes: await db.select().from(workLikes).where(eq(workLikes.userId, me)),
      readingPositions: await db.select().from(readingPositions).where(eq(readingPositions.userId, me)),
      badges: await db.select().from(userAchievements).where(eq(userAchievements.userId, me)),
      blocks: await db.select().from(blocks).where(eq(blocks.blockerId, me)),
      notificationPreferences: await db
        .select()
        .from(notificationPreferences)
        .where(eq(notificationPreferences.userId, me)),
      notifications: await db
        .select()
        .from(notifications)
        .where(eq(notifications.userId, me))
        .orderBy(desc(notifications.createdAt))
        .limit(1000),
    }
    return reply
      .header('content-type', 'application/json; charset=utf-8')
      .header(
        'content-disposition',
        `attachment; filename="morrow-export-${new Date().toISOString().slice(0, 10)}.json"`,
      )
      .header('cache-control', 'no-store')
      .send(JSON.stringify(data, null, 2))
  })

  app.post(
    '/me/delete',
    {
      schema: { body: z.object({ password: z.string().min(1).max(200), confirm: z.literal('DELETE') }) },
      config: { rateLimit: { max: 5, timeWindow: '15 minutes' } },
    },
    async (req, reply) => {
      const me = req.user!.id
      try {
        await auth.api.verifyPassword({
          body: { password: req.body.password },
          headers: fromNodeHeaders(req.headers),
        })
      } catch {
        throw new HttpProblem(403, PROBLEM.forbidden, 'That password isn’t right.')
      }
      await deleteAccount(db, me)
      return reply.status(204).send()
    },
  )
}

export async function deleteAccount(db: Database, me: string) {
  await db.transaction(async (tx) => {
    // 1. Works: hand shared ones on; delete the ones that are only yours.
    const owned = await tx
      .select({ id: works.id })
      .from(works)
      .where(and(eq(works.ownerId, me), isNull(works.deletedAt)))
    for (const w of owned) {
      const others = await tx
        .select({ userId: workMembers.userId, role: workMembers.role, since: workMembers.createdAt })
        .from(workMembers)
        .where(and(eq(workMembers.workId, w.id), ne(workMembers.userId, me)))
      const heir = others.sort(
        (a, b) =>
          SUCCESSION.indexOf(a.role as (typeof SUCCESSION)[number]) -
            SUCCESSION.indexOf(b.role as (typeof SUCCESSION)[number]) ||
          a.since.getTime() - b.since.getTime(),
      )[0]
      if (heir) {
        await tx
          .update(works)
          .set({ ownerId: heir.userId, updatedAt: sql`now()` })
          .where(eq(works.id, w.id))
        await tx
          .update(workMembers)
          .set({ role: 'owner' })
          .where(and(eq(workMembers.workId, w.id), eq(workMembers.userId, heir.userId)))
        await recordActivity(tx, {
          workId: w.id,
          actorId: me,
          type: 'member.role_changed',
          subjectType: 'user',
          subjectId: heir.userId,
          data: { role: 'owner', reason: 'previous_owner_deleted_account' },
        })
      } else {
        await tx.update(works).set({ deletedAt: new Date() }).where(eq(works.id, w.id))
      }
    }
    await tx.delete(workMembers).where(eq(workMembers.userId, me))

    // 2. Public traces: comments removed (threads keep their shape), likes un-counted, follows and saves gone.
    await tx
      .update(readerComments)
      .set({ body: '', deletedAt: new Date(), deletedBy: me })
      .where(and(eq(readerComments.authorId, me), isNull(readerComments.deletedAt)))
    const liked = await tx
      .select({ workId: workLikes.workId })
      .from(workLikes)
      .where(eq(workLikes.userId, me))
    if (liked.length)
      await tx
        .update(works)
        .set({ likeCount: sql`greatest(${works.likeCount} - 1, 0)` })
        .where(
          inArray(
            works.id,
            liked.map((l) => l.workId),
          ),
        )
    await tx.delete(workLikes).where(eq(workLikes.userId, me))
    await tx
      .delete(follows)
      .where(or(eq(follows.followerId, me), and(eq(follows.targetType, 'author'), eq(follows.targetId, me))))
    await tx.delete(bookmarks).where(eq(bookmarks.userId, me))
    await tx.delete(readingPositions).where(eq(readingPositions.userId, me))
    await tx.delete(reactions).where(eq(reactions.userId, me))
    await tx.delete(contributionRequests).where(eq(contributionRequests.requesterId, me))
    await tx.delete(featureWaitlist).where(eq(featureWaitlist.userId, me))
    await tx.delete(writingLog).where(eq(writingLog.userId, me))
    await tx.delete(profileViews).where(eq(profileViews.userId, me))
    await tx.delete(userAchievements).where(eq(userAchievements.userId, me))
    await tx.delete(notifications).where(eq(notifications.userId, me))
    await tx.delete(notificationPreferences).where(eq(notificationPreferences.userId, me))

    // 3. Who you were: profile cleared, sign-in erased. The user row stays (as "Deleted account") so shared history
    //    such as accepted proposals and manuscript comments still has someone to point at.
    await tx
      .update(profiles)
      .set({
        username: `deleted_${me.slice(-10).toLowerCase()}`,
        bio: '',
        interests: [],
        genres: [],
        links: [],
        avatar: null,
        isPublic: false,
        showBadges: false,
      })
      .where(eq(profiles.userId, me))
    await tx.delete(session).where(eq(session.userId, me))
    await tx.delete(account).where(eq(account.userId, me))
    await tx.delete(twoFactor).where(eq(twoFactor.userId, me))
    await tx
      .update(user)
      .set({ name: DELETED_NAME, email: `deleted-${me}@deleted.invalid`, emailVerified: false, image: null })
      .where(eq(user.id, me))
  })
}

/**
 * Notifications (PRD FR-030), produced from the activity outbox (architecture §20). A worker claims unprocessed events
 * in order (`FOR UPDATE SKIP LOCKED`, so several API instances can share the work), turns each into notifications for
 * the people it concerns, and marks it processed in the same transaction: nothing is lost or delivered twice.
 * Emails follow per-category preferences and wait out the recipient's quiet hours.
 */
import { and, desc, eq, inArray, isNull, sql } from 'drizzle-orm'
import { can } from '@morrow/domain'
import {
  activityEvents,
  chapters,
  comments,
  contributionRequests,
  invitations,
  loadWorkAccess,
  notificationPreferences,
  notifications,
  proposalEvents,
  proposals,
  readerComments,
  toAccessContext,
  user,
  workMembers,
  works,
  type Database,
  type NotificationCategory,
} from '@morrow/db'
import type { EmailSender } from './email.ts'
import { followersOfPublication } from './routes/follows.ts'
import { blockedSet } from './safety.ts'
import { evaluateBadges } from './badges.ts'

type Event = typeof activityEvents.$inferSelect
interface Draft {
  userId: string
  category: NotificationCategory
  type: string
  title: string
  body?: string
  url: string
  /** same key for the same recipient = delivered once */
  dedupeKey: string
}

/** What people get unless they choose otherwise: everything in-app; email for what usually needs a response. */
export const DEFAULT_PREFERENCES: Record<NotificationCategory, { inApp: boolean; email: boolean }> = {
  invitations: { inApp: true, email: true },
  proposals: { inApp: true, email: true },
  mentions: { inApp: true, email: true },
  comments: { inApp: true, email: false },
  publishing: { inApp: true, email: false },
  activity: { inApp: true, email: false },
}

const clip = (s: string, n = 140) => (s.length > n ? `${s.slice(0, n - 1)}…` : s)

/** Who should hear about this event, and what to tell them. Pure planning: reads only. */
async function plan(db: Database, e: Event): Promise<Draft[]> {
  const nameOf = async (id: string | null) =>
    id
      ? ((await db.select({ n: user.name }).from(user).where(eq(user.id, id)))[0]?.n ?? 'Someone')
      : 'Someone'
  const workOf = async (id: string | null) =>
    id
      ? (
          await db.select({ title: works.title, ownerId: works.ownerId }).from(works).where(eq(works.id, id))
        )[0]
      : undefined
  const actor = await nameOf(e.actorId)
  const work = await workOf(e.workId)
  const data = e.data as Record<string, unknown>
  const key = `event:${e.id}`

  if (e.type.startsWith('proposal.')) {
    const [p] = await db.select().from(proposals).where(eq(proposals.id, e.subjectId))
    if (!p || !work) return []
    const url = `/app/works/${p.workId}/proposals/${p.id}`
    if (e.type === 'proposal.submitted') {
      // Reviewers hear about new submissions (project activity).
      const reviewers = await db
        .select({ id: workMembers.userId })
        .from(workMembers)
        .where(and(eq(workMembers.workId, p.workId), inArray(workMembers.role, ['owner', 'editor'])))
      const ids = new Set([work.ownerId, ...reviewers.map((r) => r.id)])
      return [...ids].map((userId) => ({
        userId,
        category: 'activity',
        type: e.type,
        title: `${actor} submitted a proposal: “${p.title}”`,
        body: work.title,
        url,
        dedupeKey: key,
      }))
    }
    const verb = {
      'proposal.accepted': 'accepted',
      'proposal.rejected': 'didn’t accept',
      'proposal.changes_requested': 'asked for changes to',
    }[e.type]
    if (!verb) return []
    const [note] = await db
      .select({ body: proposalEvents.body })
      .from(proposalEvents)
      .where(and(eq(proposalEvents.proposalId, p.id), eq(proposalEvents.type, 'status')))
      .orderBy(desc(proposalEvents.createdAt))
      .limit(1)
    return [
      {
        userId: p.authorId,
        category: 'proposals',
        type: e.type,
        title: `${actor} ${verb} your proposal “${p.title}”`,
        body: clip(note?.body || work.title),
        url,
        dedupeKey: key,
      },
    ]
  }

  if (e.type === 'comment.created' || e.type === 'comment.replied') {
    const [c] = await db.select().from(comments).where(eq(comments.id, e.subjectId))
    if (!c || c.deletedAt || !work) return []
    const [ch] = await db
      .select({ id: chapters.id, title: chapters.title })
      .from(chapters)
      .where(eq(chapters.documentId, c.documentId))
    if (!ch) return []
    const url = `/app/works/${c.workId}/edit/${ch.id}?feedback=1`
    const body = clip(c.body)
    // One notification per person per comment: a mention outranks a reply, which outranks "new comment".
    const dedupeKey = `comment:${c.id}`
    const out: Draft[] = (c.mentions ?? []).map((userId) => ({
      userId,
      category: 'mentions',
      type: 'comment.mentioned',
      title: `${actor} mentioned you on “${ch.title}”`,
      body,
      url,
      dedupeKey,
    }))
    if (e.type === 'comment.replied') {
      const threadId = String(data.threadId ?? c.parentId)
      const people = await db
        .selectDistinct({ id: comments.authorId })
        .from(comments)
        .where(
          and(
            sql`(${comments.id} = ${threadId} or ${comments.parentId} = ${threadId})`,
            isNull(comments.deletedAt),
          ),
        )
      for (const { id } of people)
        out.push({
          userId: id,
          category: 'comments',
          type: e.type,
          title: `${actor} replied on “${ch.title}”`,
          body,
          url,
          dedupeKey,
        })
    } else {
      out.push({
        userId: work.ownerId,
        category: 'comments',
        type: e.type,
        title: `${actor} commented on “${ch.title}”`,
        body,
        url,
        dedupeKey,
      })
    }
    return out
  }

  if (e.type === 'member.invited') {
    const [inv] = await db.select().from(invitations).where(eq(invitations.id, e.subjectId))
    if (!inv || !work) return []
    const [invitee] = await db
      .select({ id: user.id })
      .from(user)
      .where(and(sql`lower(${user.email}) = ${inv.email.toLowerCase()}`, eq(user.emailVerified, true)))
    // Only a *verified* address may learn of an invitation in-app: anyone can sign up claiming an address, and the
    // invitation names a private work. Everyone else relies on the emailed link, whose token proves the inbox.
    return invitee
      ? [
          {
            userId: invitee.id,
            category: 'invitations',
            type: e.type,
            title: `${actor} invited you to “${work.title}”`,
            url: '/app/invitations',
            dedupeKey: key,
          },
        ]
      : []
  }

  if (e.type === 'member.joined' && work)
    return [
      {
        userId: work.ownerId,
        category: 'activity',
        type: e.type,
        title: `${actor} joined “${work.title}”`,
        url: `/app/works/${e.workId}`,
        dedupeKey: key,
      },
    ]

  if (e.type === 'member.role_changed' && work) {
    const role =
      {
        editor: 'an editor',
        collaborator: 'a collaborator',
        contributor: 'a contributor',
        viewer: 'a reader',
      }[String(data.role)] ?? String(data.role)
    return [
      {
        userId: e.subjectId,
        category: 'activity',
        type: e.type,
        title: `You’re now ${role} on “${work.title}”`,
        url: `/app/works/${e.workId}`,
        dedupeKey: key,
      },
    ]
  }

  if (e.type === 'branch.merged' && work)
    return [
      {
        userId: work.ownerId,
        category: 'activity',
        type: e.type,
        title: `${actor} merged a branch into “${work.title}”`,
        url: `/app/works/${e.workId}`,
        dedupeKey: key,
      },
    ]

  // Readers on published work: comments, replies and likes reach the writer (and the person replied to).
  if (e.type === 'reader_comment.created' || e.type === 'reader_comment.replied') {
    const [c] = await db.select().from(readerComments).where(eq(readerComments.id, e.subjectId))
    const [w] = e.workId
      ? await db
          .select({ slug: works.slug, publicId: works.publicId, title: works.title, ownerId: works.ownerId })
          .from(works)
          .where(eq(works.id, e.workId))
      : []
    if (!c || c.deletedAt || !w) return []
    const url = `/works/${w.slug}-${w.publicId}#comments`
    const out: Draft[] = [
      {
        userId: w.ownerId,
        category: 'comments',
        type: e.type,
        title: `${actor} commented on “${w.title}”`,
        body: clip(c.body),
        url,
        dedupeKey: key,
      },
    ]
    const parentAuthor = typeof data.parentAuthor === 'string' ? data.parentAuthor : null
    if (parentAuthor && parentAuthor !== w.ownerId)
      out.push({
        userId: parentAuthor,
        category: 'comments',
        type: e.type,
        title: `${actor} replied to your comment on “${w.title}”`,
        body: clip(c.body),
        url,
        dedupeKey: key,
      })
    return out
  }
  // Contribution requests (P-050): the owner and editors hear about a request; the person asking hears the answer.
  if (e.type === 'request.created' && work) {
    const [r] = await db.select().from(contributionRequests).where(eq(contributionRequests.id, e.subjectId))
    if (!r || r.status !== 'pending') return []
    const editors = await db
      .select({ id: workMembers.userId })
      .from(workMembers)
      .where(and(eq(workMembers.workId, r.workId), eq(workMembers.role, 'editor')))
    return [...new Set([work.ownerId, ...editors.map((x) => x.id)])].map((userId) => ({
      userId,
      category: 'invitations' as const,
      type: e.type,
      title: `${actor} asked to collaborate on “${work.title}”`,
      ...(r.message ? { body: clip(r.message) } : {}),
      url: '/app/notifications',
      dedupeKey: key,
    }))
  }
  if (
    (e.type === 'request.accepted' || e.type === 'request.declined') &&
    work &&
    typeof data.requesterId === 'string'
  )
    return [
      {
        userId: data.requesterId,
        category: 'invitations',
        type: e.type,
        title:
          e.type === 'request.accepted'
            ? `You’re in: you can now contribute to “${work.title}”`
            : `Your request to collaborate on “${work.title}” wasn’t accepted this time`,
        url: e.type === 'request.accepted' ? `/app/works/${e.workId}` : '/app/notifications',
        dedupeKey: key,
      },
    ]

  if (e.type === 'work.milestone' && work) {
    const n = Number(data.n)
    const kind = data.kind === 'likes' ? 'likes' : 'reads'
    return [
      {
        userId: work.ownerId,
        category: 'activity',
        type: e.type,
        title: `“${work.title}” just passed ${n.toLocaleString('en')} ${kind}`,
        body:
          kind === 'reads'
            ? 'People are reading. Share it while it’s moving.'
            : 'People love it. Tell them thanks?',
        url: `/app/dashboard?milestone=${kind}-${n}&work=${e.workId}`,
        dedupeKey: `milestone:${e.workId}:${kind}:${n}`,
      },
    ]
  }

  if (e.type === 'work.liked' && work)
    return [
      {
        userId: work.ownerId,
        category: 'activity',
        type: e.type,
        title: `${actor} liked “${work.title}”`,
        url: `/app/works/${e.workId}`,
        // Unlike and like again: still one notification.
        dedupeKey: `like:${e.workId}:${e.actorId}`,
      },
    ]

  return publishingPlan(db, e, actor, key)
}

/** Who might have just earned a badge because of this event. */
async function badgeCandidates(db: Database, e: Event): Promise<string[]> {
  const ids = new Set<string>()
  if (e.actorId) ids.add(e.actorId)
  if (e.workId) {
    const [w] = await db.select({ ownerId: works.ownerId }).from(works).where(eq(works.id, e.workId))
    if (w) ids.add(w.ownerId)
  }
  if (e.type.startsWith('proposal.')) {
    const [p] = await db
      .select({ authorId: proposals.authorId })
      .from(proposals)
      .where(eq(proposals.id, e.subjectId))
    if (p) ids.add(p.authorId)
  }
  return [...ids]
}

/** Published works from followed authors and works (FR-022): readers who follow are told, never about private work. */
async function publishingPlan(db: Database, e: Event, actor: string, key: string): Promise<Draft[]> {
  if (e.type !== 'work.published' || !e.workId) return []
  const [w] = await db.select().from(works).where(eq(works.id, e.workId))
  if (!w || w.deletedAt || w.visibility === 'private' || !w.publishedAt || w.hiddenAt) return []
  const [earlier] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(activityEvents)
    .where(
      and(
        eq(activityEvents.workId, w.id),
        eq(activityEvents.type, 'work.published'),
        sql`${activityEvents.createdAt} < ${e.createdAt}`,
        // "Updated" only if these readers could already see it: link-only releases don't count for the public.
        w.visibility === 'public' ? sql`${activityEvents.data}->>'visibility' = 'public'` : undefined,
      ),
    )
  const title = earlier && earlier.n > 0 ? `${actor} updated “${w.title}”` : `${actor} published “${w.title}”`
  const url = `/works/${w.slug}-${w.publicId}`
  return (await followersOfPublication(db, w)).map((userId) => ({
    userId,
    category: 'publishing' as const,
    type: e.type,
    title,
    body: w.description,
    url,
    dedupeKey: key,
  }))
}

async function preferencesFor(db: Database, userIds: string[]) {
  const rows = userIds.length
    ? await db.select().from(notificationPreferences).where(inArray(notificationPreferences.userId, userIds))
    : []
  return new Map(rows.map((r) => [r.userId, r]))
}

/** Events that can unlock a badge (FR-025). Others skip the check. */
const BADGE_EVENTS = new Set([
  'work.published',
  'work.completed',
  'proposal.accepted',
  'member.joined',
  'branch.merged',
  'branch.merge_partial',
  'work.liked',
])

/** Process up to `limit` outbox events. Safe to run concurrently on several instances. */
export async function processOutbox(db: Database, { limit = 200 } = {}) {
  return db.transaction(async (tx) => {
    const t = tx as unknown as Database
    const batch = await tx
      .select()
      .from(activityEvents)
      .where(isNull(activityEvents.processedAt))
      .orderBy(activityEvents.createdAt, activityEvents.id)
      .limit(limit)
      .for('update', { skipLocked: true })
    let created = 0
    for (const e of batch) {
      const blocked = e.actorId ? await blockedSet(t, e.actorId) : new Set<string>()
      // Nobody hears about the actions of someone they've blocked, or who blocked them (FR-032).
      const drafts = (await plan(t, e)).filter(
        (d) => d.userId && d.userId !== e.actorId && !blocked.has(d.userId),
      )
      const prefs = await preferencesFor(t, [...new Set(drafts.map((d) => d.userId))])
      for (const d of drafts) {
        // Only people who can still read the work hear about it (access may have changed since the event).
        if (
          e.workId &&
          d.category !== 'invitations' &&
          d.category !== 'publishing' &&
          d.category !== 'proposals' &&
          // Comments and likes on published work: the people told are readers of a public page.
          !d.type.startsWith('reader_comment.')
        ) {
          const access = await loadWorkAccess(t, e.workId, d.userId)
          if (!access || !can({ userId: d.userId }, 'work.read', toAccessContext(access))) continue
        }
        const choice = {
          ...DEFAULT_PREFERENCES[d.category],
          ...(prefs.get(d.userId)?.categories?.[d.category] ?? {}),
        }
        if (!choice.inApp && !choice.email) continue
        const inserted = await tx
          .insert(notifications)
          .values({
            userId: d.userId,
            category: d.category,
            type: d.type,
            workId: e.workId,
            actorId: e.actorId,
            title: d.title,
            body: d.body ?? '',
            url: d.url,
            dedupeKey: d.dedupeKey,
            // email-only: nothing waits in the notification center
            readAt: choice.inApp ? null : sql`now()`,
            emailState: choice.email ? 'pending' : 'none',
          })
          .onConflictDoNothing()
          .returning({ id: notifications.id })
        created += inserted.length
      }
      if (BADGE_EVENTS.has(e.type)) for (const u of await badgeCandidates(t, e)) await evaluateBadges(t, u)
      await tx
        .update(activityEvents)
        .set({ processedAt: sql`now()` })
        .where(eq(activityEvents.id, e.id))
    }
    return { events: batch.length, notifications: created }
  })
}

/** Minutes since local midnight in `timeZone`. */
function localMinutes(now: Date, timeZone: string) {
  try {
    const parts = new Intl.DateTimeFormat('en-GB', {
      timeZone,
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    }).formatToParts(now)
    const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0)
    return get('hour') * 60 + get('minute')
  } catch {
    return now.getUTCHours() * 60 + now.getUTCMinutes()
  }
}

/** Quiet hours may cross midnight (e.g. 22:00–07:00). */
export function inQuietHours(
  now: Date,
  p: { quietStart: number | null; quietEnd: number | null; timeZone: string } | undefined,
) {
  if (!p || p.quietStart === null || p.quietEnd === null || p.quietStart === p.quietEnd) return false
  const m = localMinutes(now, p.timeZone)
  return p.quietStart < p.quietEnd ? m >= p.quietStart && m < p.quietEnd : m >= p.quietStart || m < p.quietEnd
}

/** Send pending emails, except to people in their quiet hours (they wait until it ends). */
export async function deliverEmails(
  db: Database,
  email: EmailSender,
  webOrigin: string,
  { now = new Date(), limit = 100 } = {},
) {
  // No provider (T-003): leave mail pending rather than pretend it went; it sends once a provider is configured.
  if (email.delivers === false) return { sent: 0 }
  const pending = await db
    .select({ n: notifications, address: user.email, name: user.name })
    .from(notifications)
    .innerJoin(user, eq(user.id, notifications.userId))
    .where(eq(notifications.emailState, 'pending'))
    .orderBy(notifications.createdAt)
    .limit(limit)
  const prefs = await preferencesFor(db, [...new Set(pending.map((p) => p.n.userId))])
  let sent = 0
  for (const { n, address, name } of pending) {
    if (inQuietHours(now, prefs.get(n.userId))) continue
    try {
      await email.send({
        to: address,
        subject: n.title,
        text: `Hi ${name},\n\n${n.title}${n.body ? `\n\n“${n.body}”` : ''}\n\nOpen it: ${webOrigin}${n.url}\n\nChoose which emails you get: ${webOrigin}/app/settings/notifications`,
      })
      await db.update(notifications).set({ emailState: 'sent' }).where(eq(notifications.id, n.id))
      sent++
    } catch {
      await db.update(notifications).set({ emailState: 'failed' }).where(eq(notifications.id, n.id))
    }
  }
  return { sent }
}

/** Runs in each API process; the outbox claim makes concurrent workers safe. */
export function startNotificationWorker(
  db: Database,
  email: EmailSender,
  webOrigin: string,
  log: { warn(o: object, m: string): void },
  intervalMs = 1000,
) {
  let running = false
  const tick = async () => {
    if (running) return
    running = true
    try {
      for (let i = 0; i < 10; i++) if ((await processOutbox(db)).events === 0) break
      await deliverEmails(db, email, webOrigin)
    } catch (err) {
      log.warn({ err }, 'notification worker tick failed')
    } finally {
      running = false
    }
  }
  const timer = setInterval(() => void tick(), intervalMs)
  timer.unref()
  return () => clearInterval(timer)
}

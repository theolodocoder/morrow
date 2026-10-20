import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod'
import { z } from 'zod'
import { and, asc, eq, inArray, isNull, ne, sql } from 'drizzle-orm'
import {
  coverOf,
  PROBLEM,
  PublicationStatus,
  PublicChapter,
  type PublicCredit,
  type PublicPerson,
  PublicWork,
  PublishInput,
} from '@morrow/contracts'
import {
  alternatePublications,
  branches,
  chapters,
  documentSnapshots,
  publications,
  works,
  type Database,
} from '@morrow/db'
import { openingLine } from '@morrow/editor'
import type { CollabGateway } from '../collab-gateway.ts'
import { requireWork } from '../access.ts'
import { recordActivity } from '../activity.ts'
import { chapterCredits } from '../credits.ts'
import { peopleByIds } from '../people.ts'
import { HttpProblem, notFound } from '../problems.ts'
import { readableAlternates } from './alternates.ts'
import { slugify } from '../slug.ts'

const WorkParams = z.object({ workId: z.uuid() })
const publicPathOf = (w: { slug: string; publicId: string }) => `${w.slug}-${w.publicId}`
/** stable chapter slug: title words plus a short id suffix, so renames before republishing never break links */
const chapterSlug = (title: string, chapterId: string) => `${slugify(title)}-${chapterId.slice(-6)}`

/** The version readers get: the branch marked "selected" if any, otherwise the main branch (FR-018). */
async function publishedBranch(db: Database, workId: string) {
  const rows = await db
    .select()
    .from(branches)
    .where(and(eq(branches.workId, workId), isNull(branches.archivedAt)))
  return rows.find((b) => b.status === 'selected') ?? rows.find((b) => b.isDefault)!
}

export const publishingRoutes: FastifyPluginAsyncZod<{ db: Database; collab: CollabGateway }> = async (
  app,
  { db, collab },
) => {
  app.get(
    '/works/:workId/publication',
    { schema: { params: WorkParams, response: { 200: PublicationStatus } } },
    async (req) => {
      const { work } = await requireWork(db, req.params.workId, req.user!.id, 'work.read')
      const live = await db
        .select({ branchId: publications.branchId })
        .from(publications)
        .where(and(eq(publications.workId, work.id), isNull(publications.supersededAt)))
      const [b] = live.length
        ? await db.select({ name: branches.name }).from(branches).where(eq(branches.id, live[0]!.branchId))
        : []
      return {
        published: work.publishedAt !== null,
        publishedAt: work.publishedAt?.toISOString() ?? null,
        publicPath: publicPathOf(work),
        visibility: work.visibility,
        branchName: b?.name ?? null,
        chapterCount: live.length,
      }
    },
  )

  /**
   * Publish (FR-023): pin a snapshot of every chapter in the published version. Readers only ever see these
   * snapshots, never the live draft — so later edits, renames and new chapters stay private until republished.
   */
  app.post(
    '/works/:workId/publish',
    { schema: { params: WorkParams, body: PublishInput, response: { 200: PublicationStatus } } },
    async (req) => {
      const userId = req.user!.id
      const { work } = await requireWork(db, req.params.workId, userId, 'work.publish')
      // A work a moderator has hidden can't be (re)published until it's restored (FR-031 project restriction).
      if (work.hiddenAt)
        throw new HttpProblem(
          409,
          PROBLEM.conflict,
          'This work is under review.',
          'A moderator has hidden it. See your account’s moderation page for details and appeals.',
        )
      const visibility = req.body.visibility ?? work.visibility
      if (visibility === 'private')
        throw new HttpProblem(
          409,
          PROBLEM.conflict,
          'Choose who can read it first.',
          'A private work can’t be published: make it public or unlisted.',
        )
      const branch = await publishedBranch(db, work.id)
      const list = await db
        .select()
        .from(chapters)
        .where(and(eq(chapters.branchId, branch.id), isNull(chapters.deletedAt)))
        .orderBy(asc(chapters.position))

      const pinned: {
        chapter: (typeof list)[number]
        snap: Awaited<ReturnType<CollabGateway['createSnapshot']>>
      }[] = []
      for (const c of list) {
        const snap = await collab.createSnapshot({
          documentId: c.documentId,
          workId: work.id,
          label: 'Published',
          createdBy: userId,
          reason: 'publish',
        })
        pinned.push({ chapter: c, snap })
      }
      // Credits describe what was published: only edits and acceptances from before this moment count.
      const before = new Date()
      const credits = await Promise.all(
        pinned.map(({ chapter }) =>
          chapterCredits(db, {
            workId: work.id,
            ownerId: work.ownerId,
            chapterId: chapter.id,
            documentId: chapter.documentId,
            before,
          }),
        ),
      )
      await db.transaction(async (tx) => {
        await tx
          .update(publications)
          .set({ supersededAt: sql`now()` })
          .where(and(eq(publications.workId, work.id), isNull(publications.supersededAt)))
        if (pinned.length)
          await tx.insert(publications).values(
            pinned.map(({ chapter, snap }, i) => ({
              workId: work.id,
              branchId: branch.id,
              chapterId: chapter.id,
              snapshotId: snap.id,
              title: chapter.title,
              position: chapter.position,
              wordCount: snap.wordCount,
              publishedBy: userId,
              credits: credits[i]!,
            })),
          )
        await tx
          .update(works)
          .set({ visibility, publishedAt: sql`coalesce(${works.publishedAt}, now())`, updatedAt: sql`now()` })
          .where(eq(works.id, work.id))
        if (visibility !== work.visibility)
          await recordActivity(tx, {
            workId: work.id,
            actorId: userId,
            type: 'work.visibility_changed',
            subjectType: 'work',
            subjectId: work.id,
            data: { from: work.visibility, to: visibility },
          })
        await recordActivity(tx, {
          workId: work.id,
          actorId: userId,
          type: 'work.published',
          subjectType: 'work',
          subjectId: work.id,
          data: { branchId: branch.id, chapters: pinned.length, visibility },
        })
      })
      const [w] = await db.select().from(works).where(eq(works.id, work.id))
      return {
        published: true,
        publishedAt: w!.publishedAt!.toISOString(),
        publicPath: publicPathOf(w!),
        visibility: w!.visibility,
        branchName: branch.isDefault ? null : branch.name,
        chapterCount: pinned.length,
      }
    },
  )

  app.post(
    '/works/:workId/unpublish',
    { schema: { params: WorkParams, response: { 200: PublicationStatus } } },
    async (req) => {
      const userId = req.user!.id
      const { work } = await requireWork(db, req.params.workId, userId, 'work.publish')
      await db.transaction(async (tx) => {
        await tx
          .update(publications)
          .set({ supersededAt: sql`now()` })
          .where(and(eq(publications.workId, work.id), isNull(publications.supersededAt)))
        // alternates share main's opening, so they can't stay up without it
        await tx
          .update(alternatePublications)
          .set({ supersededAt: sql`now()` })
          .where(and(eq(alternatePublications.workId, work.id), isNull(alternatePublications.supersededAt)))
        await tx
          .update(works)
          .set({ publishedAt: null, updatedAt: sql`now()` })
          .where(eq(works.id, work.id))
        await recordActivity(tx, {
          workId: work.id,
          actorId: userId,
          type: 'work.unpublished',
          subjectType: 'work',
          subjectId: work.id,
        })
      })
      return {
        published: false,
        publishedAt: null,
        publicPath: publicPathOf(work),
        visibility: work.visibility,
        branchName: null,
        chapterCount: 0,
      }
    },
  )
}

/** Resolve a public path to a work readers may see: published, not private, not deleted. Everything else is 404. */
/** A classic's real author and year (P-063), from the work's stored source. */
export function classicOf(source: unknown) {
  const s = source as { kind?: string; originalAuthor?: unknown; year?: unknown } | null
  return s?.kind === 'public_domain' && typeof s.originalAuthor === 'string'
    ? { author: s.originalAuthor, year: Number(s.year) || 0 }
    : null
}

/** An open-access article's attribution (P-064): who wrote it, where, under which licence, and what we changed. */
export function openAccessOf(source: unknown) {
  const s = source as Record<string, unknown> | null
  if (s?.kind !== 'open_access') return null
  return {
    authors: Array.isArray(s.authors) ? (s.authors as unknown[]).map(String) : [],
    journal: String(s.journal ?? ''),
    year: Number(s.year) || 0,
    doi: typeof s.doi === 'string' ? s.doi : null,
    license: String(s.license ?? 'CC BY'),
    licenseUrl: String(s.licenseUrl ?? ''),
    url: String(s.url ?? ''),
    changes: String(s.changes ?? ''),
  }
}

/** "Dan Denis and Scott A. Cairney", "A, B, C et al." */
export function bylineOf(authors: string[]) {
  if (authors.length <= 2) return authors.join(' and ') || 'Unknown authors'
  return `${authors.slice(0, 2).join(', ')} et al.`
}

export async function readableWork(db: Database, publicPath: string) {
  const publicId = publicPath.slice(publicPath.lastIndexOf('-') + 1)
  if (!/^[0-9a-f]{10}$/.test(publicId)) return null
  const [w] = await db
    .select()
    .from(works)
    .where(
      and(
        eq(works.publicId, publicId),
        ne(works.visibility, 'private'),
        isNull(works.deletedAt),
        isNull(works.hiddenAt), // moderation (FR-031)
        sql`${works.publishedAt} is not null`,
      ),
    )
  return w ?? null
}

const personOr = (people: Map<string, PublicPerson>, id: string): PublicPerson =>
  people.get(id) ?? { displayName: 'Unknown', username: null, avatarSeed: id.slice(-8), avatar: null }

/**
 * One line per person for the work page, from the credits stored on each live publication. Someone credited
 * in several roles shows under their highest (co-writer over contributor), with the chapters of that role.
 */
function workCredits(
  ownerId: string,
  pubs: { credits: { userId: string; role: 'cowriter' | 'contributor' }[] }[],
  people: Map<string, PublicPerson>,
): PublicCredit[] {
  const earned = new Map<string, { role: 'cowriter' | 'contributor'; chapters: number[] }>()
  pubs.forEach((p, i) => {
    for (const c of p.credits) {
      const had = earned.get(c.userId)
      if (!had || (had.role === 'contributor' && c.role === 'cowriter'))
        earned.set(c.userId, { role: c.role, chapters: [i + 1] })
      else if (had.role === c.role) had.chapters.push(i + 1)
    }
  })
  const others = [...earned]
    .flatMap(([id, e]) => {
      const person = people.get(id)
      return person ? [{ person, ...e }] : []
    })
    .sort(
      (a, b) =>
        (a.role === b.role ? 0 : a.role === 'cowriter' ? -1 : 1) ||
        a.person.displayName.localeCompare(b.person.displayName),
    )
  return [{ person: personOr(people, ownerId), role: 'author', chapters: [] }, ...others]
}

/** What a reader's path through a work is made of: a published main or alternate chapter. */
type Chapterish = Pick<
  typeof publications.$inferSelect,
  'title' | 'chapterId' | 'snapshotId' | 'wordCount' | 'credits'
>
const summaryOf = (x: Chapterish) => ({
  title: x.title,
  slug: chapterSlug(x.title, x.chapterId),
  wordCount: x.wordCount,
})

export async function livePublications(db: Database, workId: string) {
  return db
    .select()
    .from(publications)
    .where(and(eq(publications.workId, workId), isNull(publications.supersededAt)))
    .orderBy(asc(publications.position))
}

/** Published works are free to read for everyone, signed in or not (P-049): an account is only asked for to take part. */
export const publicReadingRoutes: FastifyPluginAsyncZod<{ db: Database }> = async (app, { db }) => {
  app.get(
    '/works/:publicPath',
    { schema: { params: z.object({ publicPath: z.string().max(200) }), response: { 200: PublicWork } } },
    async (req) => {
      const w = await readableWork(db, req.params.publicPath)
      if (!w) throw notFound()
      const pubs = await livePublications(db, w.id)
      const [branch] = pubs.length
        ? await db.select().from(branches).where(eq(branches.id, pubs[0]!.branchId))
        : []
      const alts = await readableAlternates(db, pubs)
      const people = await peopleByIds(db, [
        w.ownerId,
        ...pubs.flatMap((p) => p.credits.map((c) => c.userId)),
        ...alts.map((a) => a.branch.createdBy),
      ])
      const credits = workCredits(w.ownerId, pubs, people)
      return {
        openToSuggestions:
          w.visibility === 'public' &&
          (w.participation === 'propose' || w.participation === 'propose_and_branch'),
        title: w.title,
        description: w.description,
        category: w.form,
        tags: w.tags,
        contentWarnings: w.contentWarnings,
        license: w.license,
        publicPath: publicPathOf(w),
        publishedAt: w.publishedAt!.toISOString(),
        indexable: w.visibility === 'public',
        versionName: branch && !branch.isDefault ? branch.name : null,
        author: credits[0]!.person,
        credits,
        contributors: credits.slice(1).map((c) => c.person),
        completed: w.completedAt !== null,
        cover: coverOf(w.id, w.cover),
        classic: classicOf(w.source),
        openAccess: openAccessOf(w.source),
        releaseDay: w.releaseDay,
        openRoles: w.openRoles as PublicWork['openRoles'],
        likes: w.likeCount,
        views: w.viewCount,
        comments: w.readerCommentCount,
        chapters: pubs.map(summaryOf),
        wordCount: pubs.reduce((n, p) => n + p.wordCount, 0),
        versions: alts
          .toSorted((a, b) => a.after - b.after)
          .map((a) => ({
            name: a.branch.name,
            slug: a.branch.slug,
            premise: a.branch.description,
            author: personOr(people, a.branch.createdBy),
            afterChapter: a.after + 1,
            chapters: a.rows.map(summaryOf),
            wordCount: a.rows.reduce((n, r) => n + r.wordCount, 0),
          })),
      }
    },
  )

  app.get(
    '/works/:publicPath/chapters/:chapterSlug',
    {
      schema: {
        params: z.object({ publicPath: z.string().max(200), chapterSlug: z.string().max(240) }),
        response: { 200: PublicChapter },
      },
    },
    async (req) => {
      const w = await readableWork(db, req.params.publicPath)
      if (!w) throw notFound()
      const pubs = await livePublications(db, w.id)
      const alts = await readableAlternates(db, pubs)
      const suffix = req.params.chapterSlug.slice(-6)
      const at = (rows: { chapterId: string }[]) => rows.findIndex((r) => r.chapterId.endsWith(suffix))
      // The reader's path to this chapter: main's chapters, or main's up to where a version splits off, then its own.
      let path: Chapterish[] = pubs
      let index = at(pubs)
      let version: (typeof alts)[number]['branch'] | null = null
      for (const a of index === -1 ? alts : []) {
        const j = at(a.rows)
        if (j === -1) continue
        path = [...pubs.slice(0, a.after + 1), ...a.rows]
        index = a.after + 1 + j
        version = a.branch
        break
      }
      if (index === -1) throw notFound()
      const p = path[index]!
      const following = path[index + 1]
      // no alternates of alternates: only main chapters offer a choice
      const offered = version ? [] : alts.filter((a) => a.after === index)
      const snaps = await db
        .select({ id: documentSnapshots.id, content: documentSnapshots.contentJson })
        .from(documentSnapshots)
        .where(
          inArray(documentSnapshots.id, [
            p.snapshotId,
            ...(following ? [following.snapshotId] : []),
            ...offered.map((a) => a.rows[0]!.snapshotId),
          ]),
        )
      const content = new Map(snaps.map((x) => [x.id, x.content]))
      const cowriters = p.credits.filter((c) => c.role === 'cowriter').map((c) => c.userId)
      const people = await peopleByIds(db, [
        w.ownerId,
        ...cowriters,
        ...offered.map((a) => a.branch.createdBy),
      ])
      const teaser = (x: Chapterish) => ({ ...summaryOf(x), opening: openingLine(content.get(x.snapshotId)) })
      return {
        title: p.title,
        slug: chapterSlug(p.title, p.chapterId),
        index,
        content: content.get(p.snapshotId) ?? { type: 'doc' },
        wordCount: p.wordCount,
        credit: [
          personOr(people, w.ownerId),
          ...cowriters
            .flatMap((id) => people.get(id) ?? [])
            .sort((a, b) => a.displayName.localeCompare(b.displayName)),
        ],
        prev: index > 0 ? summaryOf(path[index - 1]!) : null,
        next: following ? teaser(following) : null,
        version: version && { name: version.name, slug: version.slug },
        alternates: offered.map((a) => ({
          name: a.branch.name,
          slug: a.branch.slug,
          premise: a.branch.description,
          author: personOr(people, a.branch.createdBy),
          firstChapter: teaser(a.rows[0]!),
          chapterCount: a.rows.length,
        })),
      }
    },
  )
}

/* eslint-disable no-console -- an operator's CLI reports to the terminal */
/**
 * A lived-in Morrow for demos and screenshots (never production):
 * - 12 real accounts (they can sign in) writing "The Salt Orchard" together, owned by Ama Owusu
 * - 240 more writers and readers, 24 published works with covers, likes, reads, comments (some on single paragraphs),
 *   follows, saves, badges, streaks, a reader poll, pending proposals and requests, and Ama's Activity
 *
 *   pnpm --filter @morrow/api seed-demo        # needs the stack running (API on :4000, collab on :4001)
 *
 * Accounts: ama@demo.morrow.test … (see DEMO_ACCOUNTS), password `morrow demo password`. Re-running is a no-op.
 */
import { createHash } from 'node:crypto'
import { eq, inArray, sql } from 'drizzle-orm'
import { generateKeyBetween } from 'fractional-indexing'
import { AVATAR_PARTS, COVER_LAYOUTS } from '@morrow/contracts'
import { SCHEMA_VERSION } from '@morrow/editor'
import { stateFromJSON } from '@morrow/editor/server'
import {
  achievements,
  bookmarks,
  branches,
  chapterPolls,
  chapters,
  contributionRequests,
  createDb,
  documentProjections,
  documentSnapshots,
  documents,
  follows,
  notifications,
  pollVotes,
  profileViews,
  profiles,
  proposals,
  publications,
  readerComments,
  user,
  userAchievements,
  workLikes,
  workMembers,
  works,
  workViews,
  writingLog,
} from '@morrow/db'
import { httpCollabGateway } from '../collab-gateway.ts'
import { ensureProfile } from '../routes/profiles.ts'
import { promptFor } from '../prompts.ts'
import { slugify } from '../slug.ts'
import { BIOS, COMMENTS, FIRST, FLAGSHIP, LAST, PROSE, WORKS, type DemoWork } from './demo-corpus.ts'

if (process.env.NODE_ENV === 'production') {
  console.error('seed-demo is for development and demos only.')
  process.exit(1)
}
const API = `http://127.0.0.1:${process.env.API_PORT ?? 4000}`
const ORIGIN = process.env.WEB_ORIGIN ?? 'http://localhost:3000'
export const DEMO_PASSWORD = 'morrow demo password'
export const DEMO_ACCOUNTS = [
  ['Ama Owusu', 'owner'],
  ['Tolu Ade', 'editor'],
  ['Mei Chen', 'editor'],
  ['Kofi Mensah', 'editor'],
  ['Priya Sharma', 'collaborator'],
  ['Mateo García', 'collaborator'],
  ['Leila Haddad', 'collaborator'],
  ['Jonas Berg', 'collaborator'],
  ['Ngozi Okafor', 'collaborator'],
  ['Haruto Sato', 'collaborator'],
  ['Aroha Ngata', 'collaborator'],
  ['Sofia Rossi', 'viewer'],
] as const
const emailOf = (name: string) => `${name.split(' ')[0]!.toLowerCase()}@demo.morrow.test`

// A small seeded random, so every run of a fresh database looks the same.
let seed = 20261020
const rand = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648
const pick = <T>(xs: readonly T[]) => xs[Math.floor(rand() * xs.length)]!
const int = (lo: number, hi: number) => lo + Math.floor(rand() * (hi - lo + 1))
const daysAgo = (d: number, h = int(0, 23)) => new Date(Date.now() - d * 86_400_000 - h * 3_600_000)
/** a day in the last two months, more often recent: steady growth, not a launch-day spike */
const recentDay = () => Math.floor(rand() ** 1.5 * 59)
const face = () => ({
  style: 'face' as const,
  skin: int(0, AVATAR_PARTS.skin - 1),
  hair: int(0, AVATAR_PARTS.hair - 1),
  hairColor: int(0, AVATAR_PARTS.hairColor - 1),
  eyes: int(0, AVATAR_PARTS.eyes - 1),
  mouth: int(0, AVATAR_PARTS.mouth - 1),
  accessory: rand() < 0.6 ? 0 : int(1, AVATAR_PARTS.accessory - 1),
  background: int(0, AVATAR_PARTS.background - 1),
})
const cover = () => ({ palette: int(0, 7), motif: int(0, 4), layout: pick(COVER_LAYOUTS) })

const { db, pool } = createDb(process.env.DATABASE_URL!)
const collab = httpCollabGateway(process.env.COLLAB_INTERNAL_URL!, process.env.INTERNAL_SECRET!)

async function call(cookie: string, method: string, path: string, body?: unknown) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: {
      cookie,
      origin: ORIGIN,
      ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
      ...(method === 'POST' && path.endsWith('/works') ? { 'idempotency-key': crypto.randomUUID() } : {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  })
  if (!res.ok) throw new Error(`${method} ${path}: ${res.status} ${await res.text()}`)
  return res.status === 204 ? null : res.json()
}

/** Sign up (or sign in) a real account; returns its id and session cookie. */
async function account(name: string) {
  const email = emailOf(name)
  for (const path of ['/api/auth/sign-up/email', '/api/auth/sign-in/email']) {
    const res = await fetch(`${API}${path}`, {
      method: 'POST',
      headers: { origin: ORIGIN, 'content-type': 'application/json' },
      body: JSON.stringify({ name, email, password: DEMO_PASSWORD }),
    })
    if (res.ok) {
      const cookie = res.headers
        .getSetCookie()
        .map((c) => c.split(';')[0])
        .join('; ')
      const { user: u } = (await res.json()) as { user: { id: string } }
      return { id: u.id, cookie, name }
    }
  }
  throw new Error(`couldn't sign up or in as ${email}`)
}

const doc = (paras: string[], prefix: string) => ({
  type: 'doc',
  content: paras.map((t, i) =>
    t.includes('\n')
      ? { type: 'verse', attrs: { id: `${prefix}:${i}` }, content: [{ type: 'text', text: t }] }
      : { type: 'paragraph', attrs: { id: `${prefix}:${i}` }, content: [{ type: 'text', text: t }] },
  ),
})
/** n paragraphs of a kind, none repeated (until the bank runs out) */
const paragraphsFor = (kind: DemoWork['kind'], n: number) =>
  [...PROSE[kind]]
    .map((t) => ({ t, k: rand() }))
    .sort((a, b) => a.k - b.k)
    .slice(0, n)
    .map((x) => x.t)

/** A published work by a seeded writer, stored like any published work (snapshots + publications). */
async function publishedWork(
  ownerId: string,
  w: DemoWork,
  publishedAt: Date,
  extra: Partial<typeof works.$inferInsert> = {},
) {
  return db.transaction(async (tx) => {
    const [row] = await tx
      .insert(works)
      .values({
        ownerId,
        title: w.title,
        slug: slugify(w.title),
        description: w.description,
        form: w.category,
        visibility: 'public',
        tags: w.tags,
        cover: cover(),
        publishedAt,
        createdAt: publishedAt,
        ...extra,
      })
      .returning()
    await tx
      .insert(workMembers)
      .values({ workId: row!.id, userId: ownerId, role: 'owner', grantedBy: ownerId })
    const [b] = await tx
      .insert(branches)
      .values({ workId: row!.id, name: 'Main', slug: 'main', createdBy: ownerId, isDefault: true })
      .returning()
    await tx.update(works).set({ defaultBranchId: b!.id }).where(eq(works.id, row!.id))
    let position: string | null = null
    const count = w.category === 'short_story' || w.category === 'essay' ? 1 : int(2, 5)
    for (let c = 0; c < count; c++) {
      position = generateKeyBetween(position, null)
      const [d] = await tx
        .insert(documents)
        .values({ workId: row!.id, kind: 'chapter', schemaVersion: SCHEMA_VERSION })
        .returning()
      const seeded = stateFromJSON(doc(paragraphsFor(w.kind, int(5, 9)), d!.id) as never)
      const title = count === 1 ? w.title : `Chapter ${c + 1}`
      const [ch] = await tx
        .insert(chapters)
        .values({ workId: row!.id, branchId: b!.id, documentId: d!.id, title, position })
        .returning()
      await tx.insert(documentProjections).values({
        documentId: d!.id,
        workId: row!.id,
        contentJson: seeded.contentJson,
        plainText: seeded.plainText,
        wordCount: seeded.wordCount,
        sourceRevision: 1,
      })
      const [snap] = await tx
        .insert(documentSnapshots)
        .values({
          documentId: d!.id,
          workId: row!.id,
          state: Buffer.from(seeded.state),
          contentJson: seeded.contentJson,
          contentHash: createHash('sha256').update(JSON.stringify(seeded.contentJson)).digest('hex'),
          wordCount: seeded.wordCount,
          reason: 'publish',
          label: 'Published',
          createdBy: ownerId,
        })
        .returning()
      await tx.insert(publications).values({
        workId: row!.id,
        branchId: b!.id,
        chapterId: ch!.id,
        snapshotId: snap!.id,
        title,
        position,
        wordCount: seeded.wordCount,
        publishedBy: ownerId,
        publishedAt,
      })
    }
    return row!
  })
}

/** Likes, reads, comments and saves from the crowd, spread over the last month; counters kept in step. */
async function engage(workId: string, crowd: string[], scale: number) {
  const likers = crowd.filter(() => rand() < 0.35 * scale).slice(0, 230)
  if (likers.length) {
    await db
      .insert(workLikes)
      .values(likers.map((u) => ({ workId, userId: u, createdAt: daysAgo(recentDay()) })))
      .onConflictDoNothing()
  }
  const reads = Math.round(int(80, 400) * scale * 6)
  const viewRows = Array.from({ length: reads }, (_, i) => ({
    workId,
    viewer: `a:demo-${workId.slice(0, 8)}-${i}`,
    day: daysAgo(recentDay()).toISOString().slice(0, 10),
  }))
  for (let i = 0; i < viewRows.length; i += 1000)
    await db
      .insert(workViews)
      .values(viewRows.slice(i, i + 1000))
      .onConflictDoNothing()
  const commenters = crowd.filter(() => rand() < 0.06 * scale).slice(0, 30)
  for (const u of commenters)
    await db
      .insert(readerComments)
      .values({ workId, authorId: u, body: pick(COMMENTS), createdAt: daysAgo(recentDay()) })
  await db
    .insert(bookmarks)
    .values(
      crowd
        .filter(() => rand() < 0.12 * scale)
        .map((u) => ({ userId: u, workId, createdAt: daysAgo(recentDay()) })),
    )
    .onConflictDoNothing()
  await db.execute(sql`update ${works} w set
    like_count = (select count(*) from ${workLikes} l where l.work_id = w.id),
    view_count = (select count(*) from ${workViews} v where v.work_id = w.id),
    reader_comment_count = (select count(*) from ${readerComments} c where c.work_id = w.id and c.deleted_at is null)
    where w.id = ${workId}`)
}

async function main() {
  const [already] = await db
    .select({ id: works.id })
    .from(works)
    .where(eq(works.title, FLAGSHIP.title))
    .limit(1)
  if (already) {
    console.log('Demo data is already here. (Reset the database to seed again.)')
    return
  }

  // 1. The twelve real accounts, with faces, handles and bios.
  const team: { id: string; cookie: string; name: string; role: string }[] = []
  for (const [name, role] of DEMO_ACCOUNTS) team.push({ ...(await account(name)), role })
  const ama = team[0]!
  for (const t of team)
    await db
      .update(profiles)
      .set({
        username: slugify(t.name).replace(/-/g, '_'),
        isPublic: true,
        avatar: face(),
        bio: pick(BIOS),
        onboardedAt: daysAgo(int(60, 300)),
        dailyWordGoal: t === ama ? 1000 : pick([0, 250, 500]),
      })
      .where(eq(profiles.userId, t.id))

  // 2. The crowd: 240 more writers and readers (they can't sign in; they're here to read, like and follow).
  const crowd: string[] = []
  for (let i = 0; i < 240; i++) {
    const name = `${pick(FIRST)} ${pick(LAST)}`
    const id = `demo-${i.toString().padStart(3, '0')}`
    await db
      .insert(user)
      .values({
        id,
        name,
        email: `${id}@demo.morrow.test`,
        emailVerified: true,
        createdAt: daysAgo(int(30, 400)),
      })
      .onConflictDoNothing()
    await ensureProfile(db, id, name)
    await db
      .update(profiles)
      .set({
        isPublic: true,
        avatar: face(),
        bio: rand() < 0.5 ? pick(BIOS) : '',
        onboardedAt: daysAgo(int(30, 400)),
      })
      .where(eq(profiles.userId, id))
    crowd.push(id)
  }
  console.log(`+ ${team.length} accounts, ${crowd.length} readers and writers`)

  // 3. The flagship: written together, live, through the real API and collab.
  const flagship = (await call(ama.cookie, 'POST', '/api/v1/works', {
    title: FLAGSHIP.title,
    category: 'novel',
    description: FLAGSHIP.description,
  })) as { id: string; defaultBranchId: string }
  const first = (
    (await call(ama.cookie, 'GET', `/api/v1/works/${flagship.id}/chapters`)) as { items: { id: string }[] }
  ).items[0]!
  await call(ama.cookie, 'PATCH', `/api/v1/chapters/${first.id}`, { title: FLAGSHIP.chapters[0] })
  for (const title of FLAGSHIP.chapters.slice(1))
    await call(ama.cookie, 'POST', `/api/v1/works/${flagship.id}/chapters`, { title })
  const flagChapters = (
    (await call(ama.cookie, 'GET', `/api/v1/works/${flagship.id}/chapters`)) as {
      items: { id: string; documentId: string; title: string }[]
    }
  ).items
  for (const c of flagChapters) {
    const paras = [
      ...(c.title === 'First Frost'
        ? [
            'The salt came up through the roots again, white as frost, and the old trees drank it anyway, because trees, like people, take what the ground gives.',
            'Grandmother Efua walked the rows before dawn, counting the trees the way other people counted their children, out loud and twice, in case one had wandered off.',
          ]
        : []),
      ...paragraphsFor('fiction', int(7, 11)),
    ]
    const seeded = stateFromJSON(doc(paras, c.documentId) as never)
    const [snap] = await db
      .insert(documentSnapshots)
      .values({
        documentId: c.documentId,
        workId: flagship.id,
        state: Buffer.from(seeded.state),
        contentJson: seeded.contentJson,
        contentHash: createHash('sha256').update(JSON.stringify(seeded.contentJson)).digest('hex'),
        wordCount: seeded.wordCount,
        reason: 'manual',
        label: 'Seeded draft',
        createdBy: ama.id,
      })
      .returning()
    await collab.restoreDocument({
      documentId: c.documentId,
      snapshotId: snap!.id,
      workId: flagship.id,
      createdBy: ama.id,
    })
  }
  await db
    .insert(workMembers)
    .values(
      team.slice(1).map((t) => ({
        workId: flagship.id,
        userId: t.id,
        role: t.role as 'editor',
        grantedBy: ama.id,
        createdAt: daysAgo(int(20, 90)),
      })),
    )
    .onConflictDoNothing()
  await call(ama.cookie, 'PATCH', `/api/v1/works/${flagship.id}`, {
    tags: FLAGSHIP.tags,
    collaborationMode: 'direct', // editors and collaborators write directly; proposals stay open to everyone
    releaseDay: 5,
    openRoles: ['illustrator', 'translator'],
    cover: { palette: 0, motif: 0, layout: 'classic' },
  })
  await call(ama.cookie, 'POST', `/api/v1/works/${flagship.id}/publish`, { visibility: 'public' })
  await call(ama.cookie, 'PATCH', `/api/v1/works/${flagship.id}`, { participation: 'propose' })
  await engage(flagship.id, crowd, 2.6)
  console.log(`+ ${FLAGSHIP.title}: ${flagChapters.length} chapters, ${team.length} people`)

  // Paragraph comments on the first chapter, a poll on the last, proposals and requests waiting for Ama.
  const pubs = await db
    .select({
      chapterId: publications.chapterId,
      content: documentSnapshots.contentJson,
      title: publications.title,
    })
    .from(publications)
    .innerJoin(documentSnapshots, eq(documentSnapshots.id, publications.snapshotId))
    .where(eq(publications.workId, flagship.id))
  const firstPub = pubs.find((p) => p.title === FLAGSHIP.chapters[0])!
  const blocks = ((firstPub.content as { content: { attrs?: { id?: string } }[] }).content ?? [])
    .map((b) => b.attrs?.id)
    .filter((x): x is string => !!x)
  for (const [i, b] of blocks.slice(0, 6).entries())
    for (let k = 0; k < [7, 3, 12, 2, 5, 4][i]!; k++)
      await db.insert(readerComments).values({
        workId: flagship.id,
        authorId: pick(crowd),
        chapterId: firstPub.chapterId,
        blockId: b,
        body: pick(COMMENTS),
        createdAt: daysAgo(int(0, 12)),
      })
  const lastPub = pubs.find((p) => p.title === FLAGSHIP.chapters.at(-1))!
  const [poll] = await db
    .insert(chapterPolls)
    .values({
      workId: flagship.id,
      chapterId: lastPub.chapterId,
      question: 'Who should keep the lighthouse?',
      options: ['Efua, as she always has', 'Kwesi, who never wanted it', 'Nobody: let the light go out'],
      closesAt: daysAgo(-5),
      createdBy: ama.id,
    })
    .returning()
  await db
    .insert(pollVotes)
    .values(
      crowd
        .slice(0, 186)
        .map((u, i) => ({ pollId: poll!.id, userId: u, option: i % 7 < 3 ? 0 : i % 7 < 6 ? 1 : 2 })),
    )
  for (const [k, t] of team.slice(3, 6).entries())
    await db.insert(proposals).values({
      workId: flagship.id,
      kind: (['outline', 'character', 'chapter'] as const)[k]!,
      authorId: t.id,
      title: ['What Kwesi finds in the well', 'A new voice: the ferryman', 'The Night of the Second Tide'][
        k
      ]!,
      explanation: 'Picked up from our call on Tuesday.',
      body: paragraphsFor('fiction', 3).join('\n\n'),
      status: 'submitted',
      submittedAt: daysAgo(k),
      createdAt: daysAgo(k + 1),
    })
  for (const [k, u] of crowd.slice(200, 203).entries())
    await db.insert(contributionRequests).values({
      workId: flagship.id,
      requesterId: u,
      message: [
        'I illustrate coastal birds. I’d love to draw the orchard.',
        'I can translate it into Portuguese; my family is from a town like this.',
        'Editor here. Your middle chapters could sing with a little tightening.',
      ][k]!,
      createdAt: daysAgo(int(0, 3)),
    })

  // 4. The rest of the platform: 24 published works by the crowd, some for this week's prompt.
  const prompt = promptFor()
  for (const [i, w] of WORKS.entries()) {
    // Ama has a couple of her own pieces out too; three teammates have one each
    const owner = i === 9 || i === 20 ? ama.id : i < 3 ? team[i + 1]!.id : pick(crowd)
    const row = await publishedWork(
      owner,
      { ...w, tags: i % 6 === 0 ? [...w.tags, prompt.tag] : w.tags },
      daysAgo(int(0, 28)),
      {
        completedAt: rand() < 0.4 ? daysAgo(1) : null,
        releaseDay: rand() < 0.3 ? int(0, 6) : null,
        openRoles:
          rand() < 0.25 ? [pick(['editor', 'illustrator', 'co_writer', 'beta_reader'] as const)] : [],
        participation: rand() < 0.4 ? 'propose' : 'none',
      },
    )
    await engage(row.id, crowd, rand() * 1.4 + 0.2)
  }
  console.log(`+ ${WORKS.length} published works`)

  // 5. People: Ama's following, follows across the crowd, badges, streaks, Ama's Activity.
  await db
    .insert(follows)
    .values(
      crowd.slice(0, 212).map((u) => ({
        followerId: u,
        targetType: 'author' as const,
        targetId: ama.id,
        createdAt: daysAgo(Math.floor(rand() ** 1.3 * 120)),
      })),
    )
    .onConflictDoNothing()
  // Ama follows people too, and people visit her page
  await db
    .insert(follows)
    .values(
      [...team.slice(1).map((t) => t.id), ...crowd.slice(212, 236)].map((u) => ({
        followerId: ama.id,
        targetType: 'author' as const,
        targetId: u,
        createdAt: daysAgo(int(5, 200)),
      })),
    )
    .onConflictDoNothing()
  await db
    .insert(profileViews)
    .values(
      Array.from({ length: 900 }, (_, i) => ({
        userId: ama.id,
        viewer: `a:demo-profile-${i}`,
        day: daysAgo(recentDay()).toISOString().slice(0, 10),
      })),
    )
    .onConflictDoNothing()
  await db
    .insert(follows)
    .values(team.slice(1).map((t) => ({ followerId: t.id, targetType: 'author' as const, targetId: ama.id })))
    .onConflictDoNothing()
  for (const u of crowd)
    for (let k = 0; k < int(0, 6); k++)
      await db
        .insert(follows)
        .values({
          followerId: u,
          targetType: 'author',
          targetId: pick([...crowd, ...team.map((t) => t.id)]),
          createdAt: daysAgo(int(0, 90)),
        })
        .onConflictDoNothing()
  const codes = (await db.select({ code: achievements.code }).from(achievements)).map((a) => a.code)
  const awards = [
    ...[
      'first_chapter',
      'the_finisher',
      'bridge_builder',
      'found_readers',
      'reliable_one',
      'steady_hand',
      'prompt_answerer',
    ].map((c) => ({ userId: ama.id, achievementCode: c })),
    ...team
      .slice(1)
      .flatMap((t) => codes.filter(() => rand() < 0.4).map((c) => ({ userId: t.id, achievementCode: c }))),
    ...crowd.flatMap((u) =>
      codes.filter(() => rand() < 0.08).map((c) => ({ userId: u, achievementCode: c })),
    ),
  ].map((a) => ({ ...a, awardedAt: daysAgo(int(1, 60)) }))
  await db.insert(userAchievements).values(awards).onConflictDoNothing()
  for (let d = 0; d < 23; d++)
    await db
      .insert(writingLog)
      .values({
        userId: ama.id,
        day: daysAgo(d, 0).toISOString().slice(0, 10),
        words: d === 0 ? 640 : int(300, 1800),
      })
      .onConflictDoNothing()
  for (const t of team.slice(1))
    for (let d = 0; d < int(2, 14); d++)
      await db
        .insert(writingLog)
        .values({ userId: t.id, day: daysAgo(d, 0).toISOString().slice(0, 10), words: int(100, 1200) })
        .onConflictDoNothing()

  const people = await db
    .select({ id: user.id, name: user.name })
    .from(user)
    .where(inArray(user.id, crowd.slice(0, 40)))
  const name = (i: number) => people[i % people.length]!.name
  const note = (i: number, n: Omit<typeof notifications.$inferInsert, 'userId' | 'dedupeKey'>) => ({
    userId: ama.id,
    dedupeKey: `demo:${i}`,
    emailState: 'none' as const,
    ...n,
  })
  await db.insert(notifications).values([
    note(1, {
      category: 'activity',
      type: 'work.milestone',
      workId: flagship.id,
      title: `“${FLAGSHIP.title}” just passed 1,000 reads`,
      body: 'People are reading. Share it while it’s moving.',
      url: `/app/dashboard?milestone=reads-1000&work=${flagship.id}`,
      createdAt: daysAgo(0, 1),
    }),
    note(2, {
      category: 'activity',
      type: 'proposal.submitted',
      workId: flagship.id,
      actorId: team[5]!.id,
      title: `${team[5]!.name} submitted a proposal: “The Night of the Second Tide”`,
      body: FLAGSHIP.title,
      url: `/app/works/${flagship.id}/proposals`,
      createdAt: daysAgo(0, 2),
    }),
    note(3, {
      category: 'comments',
      type: 'reader_comment.created',
      workId: flagship.id,
      title: `${name(1)} commented on “${FLAGSHIP.title}”`,
      body: 'Who lit the lights?? I need the next chapter.',
      url: '/',
      createdAt: daysAgo(0, 3),
    }),
    note(4, {
      category: 'activity',
      type: 'work.liked',
      workId: flagship.id,
      title: `${name(2)} liked “${FLAGSHIP.title}”`,
      url: '/',
      createdAt: daysAgo(0, 4),
    }),
    note(5, {
      category: 'activity',
      type: 'follow.created',
      title: `${name(3)} followed you`,
      url: '/',
      createdAt: daysAgo(0, 5),
    }),
    note(6, {
      category: 'mentions',
      type: 'comment.mentioned',
      workId: flagship.id,
      actorId: team[1]!.id,
      title: `${team[1]!.name} mentioned you in “What the Keeper Saw”`,
      body: '@ama can we move this scene before the storm?',
      url: `/app/works/${flagship.id}`,
      createdAt: daysAgo(0, 6),
    }),
    note(7, {
      category: 'activity',
      type: 'badge.earned',
      title: 'You earned a badge: The Steady Hand',
      body: 'Wrote on seven days in a row.',
      url: '/app/badges',
      createdAt: daysAgo(1, 2),
    }),
    note(8, {
      category: 'comments',
      type: 'reader_comment.created',
      workId: flagship.id,
      title: `${name(4)} commented on “${FLAGSHIP.title}”`,
      body: 'The detail about the salt in the roots is haunting.',
      url: '/',
      createdAt: daysAgo(1, 4),
      readAt: daysAgo(1),
    }),
    note(9, {
      category: 'activity',
      type: 'proposal.submitted',
      workId: flagship.id,
      actorId: team[4]!.id,
      title: `${team[4]!.name} submitted a proposal: “A new voice: the ferryman”`,
      body: FLAGSHIP.title,
      url: `/app/works/${flagship.id}/proposals`,
      createdAt: daysAgo(1, 6),
      readAt: daysAgo(1),
    }),
    note(10, {
      category: 'activity',
      type: 'work.milestone',
      workId: flagship.id,
      title: `“${FLAGSHIP.title}” just passed 250 likes`,
      body: 'People love it. Tell them thanks?',
      url: `/app/dashboard?milestone=likes-250&work=${flagship.id}`,
      createdAt: daysAgo(2),
      readAt: daysAgo(2),
    }),
  ])
  console.log('+ follows, badges, streaks and Activity')
  console.log(
    `\nSign in as ${emailOf('Ama Owusu')} / "${DEMO_PASSWORD}" (or any of: ${team.map((t) => emailOf(t.name)).join(', ')})`,
  )
}

try {
  await main()
} finally {
  await pool.end()
}

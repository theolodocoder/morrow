/**
 * Storing a public-domain book as a published Morrow work (P-063), owned by the "Morrow Library" account. Its chapters
 * are snapshots and publications, exactly like a writer's published work, so the reader, search, comments, likes,
 * polls and share cards all just work. Nobody signs in as the library: it has no password.
 */
import { createHash } from 'node:crypto'
import { eq, sql } from 'drizzle-orm'
import { generateKeyBetween } from 'fractional-indexing'
import { SCHEMA_VERSION } from '@morrow/editor'
import { stateFromJSON } from '@morrow/editor/server'
import {
  branches,
  chapters as chaptersTable,
  documentProjections,
  documentSnapshots,
  documents,
  profiles,
  publications,
  user,
  workMembers,
  works,
  type Database,
} from '@morrow/db'
import type { WORK_CATEGORIES } from '@morrow/contracts'
import { ensureProfile } from '../routes/profiles.ts'
import { slugify } from '../slug.ts'
import type { Chapter } from './gutenberg.ts'

export const LIBRARY_USER_ID = 'morrow-library'
export const LIBRARY_USERNAME = 'morrow_library'

export interface ClassicBook {
  gutenbergId: number
  title: string
  author: string
  year: number
  category: (typeof WORK_CATEGORIES)[number]
  tags: string[]
  description: string
}

/** The library account: a public profile with no way to sign in. */
export async function ensureLibrary(db: Database) {
  await db
    .insert(user)
    .values({
      id: LIBRARY_USER_ID,
      name: 'Morrow Library',
      email: 'library@morrow.invalid',
      emailVerified: true,
    })
    .onConflictDoNothing()
  await ensureProfile(db, LIBRARY_USER_ID, 'Morrow Library')
  await db
    .update(profiles)
    .set({
      username: LIBRARY_USERNAME,
      isPublic: true,
      bio: 'Public-domain classics, free to read, and free to retell.',
      onboardedAt: sql`coalesce(${profiles.onboardedAt}, now())`,
    })
    .where(eq(profiles.userId, LIBRARY_USER_ID))
}

export async function alreadyImported(db: Database, gutenbergId: number) {
  const rows = await db.execute(
    sql`select 1 from ${works} where source->>'gutenbergId' = ${String(gutenbergId)} and deleted_at is null`,
  )
  return rows.rows.length > 0
}

/** Take an imported classic down (soft delete: it leaves every public surface, like any deleted work). */
export async function retireClassic(db: Database, gutenbergId: number) {
  await db.execute(
    sql`update ${works} set deleted_at = now() where source->>'gutenbergId' = ${String(gutenbergId)} and deleted_at is null`,
  )
}

export async function storeClassic(db: Database, book: ClassicBook, chapters: Chapter[]) {
  if (!chapters.length) throw new Error(`${book.title}: no chapters found`)
  return db.transaction(async (tx) => {
    const [w] = await tx
      .insert(works)
      .values({
        ownerId: LIBRARY_USER_ID,
        title: book.title,
        slug: slugify(book.title),
        description: book.description,
        form: book.category,
        visibility: 'public',
        tags: book.tags,
        license: 'cc0',
        completedAt: sql`now()`,
        publishedAt: sql`now()`,
        source: {
          kind: 'public_domain',
          originalAuthor: book.author,
          year: book.year,
          gutenbergId: book.gutenbergId,
        },
      })
      .returning()
    await tx
      .insert(workMembers)
      .values({ workId: w!.id, userId: LIBRARY_USER_ID, role: 'owner', grantedBy: LIBRARY_USER_ID })
    const [b] = await tx
      .insert(branches)
      .values({ workId: w!.id, name: 'Main', slug: 'main', createdBy: LIBRARY_USER_ID, isDefault: true })
      .returning()
    await tx.update(works).set({ defaultBranchId: b!.id }).where(eq(works.id, w!.id))
    let position: string | null = null
    for (const ch of chapters) {
      position = generateKeyBetween(position, null)
      const [d] = await tx
        .insert(documents)
        .values({ workId: w!.id, kind: 'chapter', schemaVersion: SCHEMA_VERSION })
        .returning()
      const seeded = stateFromJSON(ch.doc as never)
      const [c] = await tx
        .insert(chaptersTable)
        .values({ workId: w!.id, branchId: b!.id, documentId: d!.id, title: ch.title, position })
        .returning()
      await tx.insert(documentProjections).values({
        documentId: d!.id,
        workId: w!.id,
        contentJson: seeded.contentJson,
        plainText: seeded.plainText,
        wordCount: seeded.wordCount,
        sourceRevision: 1,
      })
      const [snap] = await tx
        .insert(documentSnapshots)
        .values({
          documentId: d!.id,
          workId: w!.id,
          state: Buffer.from(seeded.state),
          contentJson: seeded.contentJson,
          contentHash: createHash('sha256').update(JSON.stringify(seeded.contentJson)).digest('hex'),
          wordCount: seeded.wordCount,
          reason: 'publish',
          label: 'Published',
          createdBy: LIBRARY_USER_ID,
        })
        .returning()
      await tx.insert(publications).values({
        workId: w!.id,
        branchId: b!.id,
        chapterId: c!.id,
        snapshotId: snap!.id,
        title: ch.title,
        position,
        wordCount: seeded.wordCount,
        publishedBy: LIBRARY_USER_ID,
      })
    }
    return w!
  })
}

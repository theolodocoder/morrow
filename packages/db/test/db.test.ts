import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { execSync } from 'node:child_process'
import { eq, sql } from 'drizzle-orm'
import { branches, createDb, documentStates, documents, user, works } from '../src/index.ts'

const url = process.env.DATABASE_URL ?? 'postgres://morrow:morrow@127.0.0.1:5432/morrow_test'
const { db, pool } = createDb(url)

beforeAll(async () => {
  const admin = createDb(url.replace(/\/[^/]+$/, '/morrow'), { max: 1 })
  await admin.pool.query('drop database if exists morrow_test with (force)').catch(() => {})
  await admin.pool.query('create database morrow_test')
  await admin.pool.end()
  execSync('node --import tsx src/migrate.ts', {
    env: { ...process.env, DATABASE_URL: url },
    stdio: 'ignore',
  })
})
afterAll(() => pool.end())

async function seed() {
  const [u] = await db
    .insert(user)
    .values({ id: `u-${crypto.randomUUID()}`, name: 'Ama', email: `${crypto.randomUUID()}@example.test` })
    .returning()
  const [w] = await db
    .insert(works)
    .values({ ownerId: u!.id, title: 'The Salt Orchard', slug: 'the-salt-orchard' })
    .returning()
  return { u: u!, w: w! }
}

describe('schema', () => {
  it('generates time-ordered UUIDv7 ids and private-by-default works', async () => {
    const { w } = await seed()
    const { w: w2 } = await seed()
    expect(w.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7/)
    expect(w2.id > w.id).toBe(true)
    expect(w.visibility).toBe('private')
    expect(w.participation).toBe('none')
  })
  it('stores and returns Yjs state bytes exactly (bytea customType)', async () => {
    const { w } = await seed()
    const [d] = await db
      .insert(documents)
      .values({ workId: w.id, kind: 'chapter', schemaVersion: 1 })
      .returning()
    const bytes = new Uint8Array([0, 1, 2, 250, 255, 128, 7])
    await db.insert(documentStates).values({
      documentId: d!.id,
      workId: w.id,
      state: bytes,
      stateVector: new Uint8Array([0]),
      revision: 1,
      byteSize: 7,
      compactedSize: 7,
    })
    const [row] = await db.select().from(documentStates).where(eq(documentStates.documentId, d!.id))
    expect([...row!.state]).toEqual([...bytes])
  })
  it('allows only one default branch per work', async () => {
    const { u, w } = await seed()
    await db
      .insert(branches)
      .values({ workId: w.id, name: 'Main', slug: 'main', createdBy: u.id, isDefault: true })
    await expect(
      db
        .insert(branches)
        .values({ workId: w.id, name: 'Other', slug: 'other', createdBy: u.id, isDefault: true }),
    ).rejects.toThrow()
    await db
      .insert(branches)
      .values({ workId: w.id, name: 'Alt', slug: 'alt', createdBy: u.id, isDefault: false })
    const n = await db.execute(sql`select count(*)::int as n from branches where work_id = ${w.id}`)
    expect(n.rows[0]!.n).toBe(2)
  })
})

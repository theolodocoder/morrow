/* eslint-disable no-console -- an operator's tool reports to the terminal */
/**
 * Backup and recovery verification (PRD Phase 7). Proves a backup can actually be restored, not just taken:
 *   1. pg_dump the database (custom format)
 *   2. pg_restore it into a fresh scratch database
 *   3. compare every table's row count, source vs restored
 *   4. decode every stored Yjs document from the restored copy (manuscripts are recoverable, not just rows)
 *   5. report timings; drop the scratch database
 * Run: pnpm --filter @morrow/collab backup-check   (BACKUP_DOCKER_CONTAINER runs pg tools inside a container)
 */
import { execFileSync } from 'node:child_process'
import * as Y from 'yjs'
import { createDb, documentProjections, documentStates } from '@morrow/db'
import { documentToJSON } from '@morrow/editor/server'
import { plainText } from '@morrow/editor'
import { eq } from 'drizzle-orm'

const url = new URL(process.env.DATABASE_URL!)
const db = url.pathname.slice(1)
const scratch = `${db}_restore_check`
const container = process.env.BACKUP_DOCKER_CONTAINER
const pg = (tool: string, args: string[], input?: Buffer) => {
  const env = { ...process.env, PGPASSWORD: decodeURIComponent(url.password) }
  const base = [
    '-h',
    container ? '127.0.0.1' : url.hostname,
    '-p',
    container ? '5432' : url.port || '5432',
    '-U',
    decodeURIComponent(url.username),
  ]
  return container
    ? execFileSync(
        'docker',
        ['exec', '-i', '-e', `PGPASSWORD=${env.PGPASSWORD}`, container, tool, ...base, ...args],
        { input, maxBuffer: 1 << 30 },
      )
    : execFileSync(tool, [...base, ...args], { input, env, maxBuffer: 1 << 30 })
}
const t = () => performance.now()

const t0 = t()
const dump = pg('pg_dump', ['-Fc', '-d', db])
const dumped = t() - t0
console.log(`dump: ${(dump.length / 1024 / 1024).toFixed(1)} MB in ${Math.round(dumped)} ms`)

pg('psql', ['-d', db, '-c', `drop database if exists ${scratch} with (force)`])
pg('psql', ['-d', db, '-c', `create database ${scratch}`])
const t1 = t()
pg('pg_restore', ['-d', scratch, '--no-owner', '--exit-on-error'], dump)
console.log(`restore: ${Math.round(t() - t1)} ms`)

const source = createDb(url.toString(), { max: 2 })
const restoredUrl = new URL(url.toString())
restoredUrl.pathname = `/${scratch}`
const restored = createDb(restoredUrl.toString(), { max: 2 })
let failures = 0
try {
  const tables = (
    await source.pool.query<{ t: string }>(
      `select tablename as t from pg_tables where schemaname = 'public' order by 1`,
    )
  ).rows.map((r) => r.t)
  for (const table of tables) {
    const [a, b] = await Promise.all([
      source.pool.query<{ n: string }>(`select count(*) as n from "${table}"`),
      restored.pool.query<{ n: string }>(`select count(*) as n from "${table}"`),
    ])
    if (a.rows[0]!.n !== b.rows[0]!.n) {
      failures++
      console.log(`MISMATCH ${table}: ${a.rows[0]!.n} vs ${b.rows[0]!.n}`)
    }
  }
  console.log(`tables: ${tables.length} compared, ${failures} mismatched`)

  // Every manuscript decodes, and its text matches what readers were last shown (the projection).
  const t2 = t()
  const states = await restored.db
    .select({ id: documentStates.documentId, state: documentStates.state })
    .from(documentStates)
  let decoded = 0
  let textMismatch = 0
  for (const s of states) {
    try {
      const doc = new Y.Doc()
      Y.applyUpdate(doc, s.state)
      const text = plainText(documentToJSON(doc))
      const [p] = await restored.db
        .select({ text: documentProjections.plainText })
        .from(documentProjections)
        .where(eq(documentProjections.documentId, s.id))
      if (p && p.text !== text) textMismatch++
      decoded++
      doc.destroy()
    } catch (err) {
      failures++
      console.log(`UNREADABLE document ${s.id}: ${String(err)}`)
    }
  }
  console.log(
    `documents: ${decoded}/${states.length} decoded in ${Math.round(t() - t2)} ms; ${textMismatch} differ from their projection (expected only for edits newer than the last projection)`,
  )
} finally {
  await source.pool.end()
  await restored.pool.end()
  pg('psql', ['-d', db, '-c', `drop database if exists ${scratch} with (force)`])
}
console.log(failures ? `FAILED: ${failures} problem(s)` : 'OK: the backup restores completely')
process.exit(failures ? 1 : 0)

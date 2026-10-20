/* eslint-disable no-console -- an operator's CLI reports to the terminal */
/**
 * Import the classics catalogue (P-063) from Project Gutenberg's HTML editions, through their mirror (Project Gutenberg
 * asks automated tools to use mirrors, not www.gutenberg.org). One book at a time, a few seconds apart; books already
 * imported are skipped; downloads are cached so a re-run doesn't fetch again.
 *   pnpm --filter @morrow/api import-classics            # the whole catalogue
 *   pnpm --filter @morrow/api import-classics 84 1342    # just these
 *   pnpm --filter @morrow/api import-classics --replace  # re-import (the old copies are taken down)
 *   pnpm --filter @morrow/api import-classics --sample   # a tiny built-in book, no network (tests, demos)
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { createDb } from '@morrow/db'
import { CATALOGUE, SAMPLE_BOOK, SAMPLE_HTML } from '../classics/catalogue.ts'
import { parseGutenbergHtml } from '../classics/gutenberg.ts'
import { alreadyImported, ensureLibrary, retireClassic, storeClassic } from '../classics/store.ts'

const MIRROR = process.env.GUTENBERG_MIRROR ?? 'https://gutenberg.pglaf.org'
const CACHE = path.join(os.tmpdir(), 'morrow-classics')
const UA = 'MorrowClassicsImporter/0.1 (+public-domain reading shelf)'

const dirOf = (id: number) => {
  const s = String(id)
  return s.length === 1 ? `0/${s}` : `${s.slice(0, -1).split('').join('/')}/${s}`
}

async function fetchBook(id: number) {
  const file = path.join(CACHE, `${id}.htm`)
  try {
    return await readFile(file, 'utf8')
  } catch {
    // not cached
  }
  const url = `${MIRROR}/${dirOf(id)}/${id}-h/${id}-h.htm`
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await fetch(url, { headers: { 'user-agent': UA }, signal: AbortSignal.timeout(300_000) })
      if (!res.ok) throw new Error(`${res.status}`)
      const html = await res.text()
      await mkdir(CACHE, { recursive: true })
      await writeFile(file, html)
      return html
    } catch (e) {
      console.warn(`  ${url}: attempt ${attempt} failed (${(e as Error).message})`)
      await new Promise((r) => setTimeout(r, attempt * 5000))
    }
  }
  throw new Error(`couldn't download ${url}`)
}

const sample = process.argv.includes('--sample')
// --replace: take down what's there (soft delete) and import again, e.g. after the converter improves
const replace = process.argv.includes('--replace')
const only = process.argv.slice(2).map(Number).filter(Boolean)
const books = only.length ? CATALOGUE.filter((b) => only.includes(b.gutenbergId)) : CATALOGUE
const { db, pool } = createDb(process.env.DATABASE_URL!)
await ensureLibrary(db)
if (sample) {
  if (!(await alreadyImported(db, SAMPLE_BOOK.gutenbergId))) {
    const w = await storeClassic(db, SAMPLE_BOOK, parseGutenbergHtml(SAMPLE_HTML, 'sample'))
    console.log(`+ ${SAMPLE_BOOK.title} → /works/${w.slug}-${w.publicId}`)
  } else console.log(`= ${SAMPLE_BOOK.title} (already here)`)
  await pool.end()
  process.exit(0)
}
let added = 0
for (const book of books) {
  if (replace) await retireClassic(db, book.gutenbergId)
  if (await alreadyImported(db, book.gutenbergId)) {
    console.log(`= ${book.title} (already here)`)
    continue
  }
  try {
    const html = await fetchBook(book.gutenbergId)
    const chapters = parseGutenbergHtml(html, `pg${book.gutenbergId}`, book.title)
    const w = await storeClassic(db, book, chapters)
    added++
    console.log(`+ ${book.title}: ${chapters.length} chapters → /works/${w.slug}-${w.publicId}`)
  } catch (e) {
    console.error(`! ${book.title}: ${(e as Error).message}`)
  }
  await new Promise((r) => setTimeout(r, 3000)) // be gentle with the mirror
}
console.log(`${added} added`)
await pool.end()

/* eslint-disable no-console -- an operator's CLI reports to the terminal */
/**
 * Import open-access research articles (P-064) from PubMed Central, via NCBI E-utilities (efetch, JATS XML). Only CC
 * BY and CC0 articles are stored: the licence is read from each article itself, and anything else is skipped.
 * Polite to NCBI: one request a second (their limit without a key is three), `tool=morrow`, no email address, and
 * downloads cached so a re-run doesn't fetch again.
 *   pnpm --filter @morrow/api import-articles              # the starter list
 *   pnpm --filter @morrow/api import-articles PMC5122008   # just these
 *   pnpm --filter @morrow/api import-articles --replace    # re-import (the old copies are taken down)
 *   pnpm --filter @morrow/api import-articles --sample     # a tiny built-in article, no network (tests, demos)
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { createDb } from '@morrow/db'
import { ARTICLES, SAMPLE_JATS } from '../classics/articles.ts'
import { parseJats } from '../classics/jats.ts'
import { articleImported, ensureLibrary, retireArticle, storeArticle } from '../classics/store.ts'

const EUTILS = 'https://eutils.ncbi.nlm.nih.gov/entrez/eutils/efetch.fcgi'
const CACHE = path.join(os.tmpdir(), 'morrow-articles')
const pause = () => new Promise((r) => setTimeout(r, 1000))

async function fetchJats(pmcid: string) {
  const file = path.join(CACHE, `${pmcid}.xml`)
  try {
    return await readFile(file, 'utf8')
  } catch {
    // not cached
  }
  const url = `${EUTILS}?db=pmc&tool=morrow&id=${pmcid.replace(/^PMC/i, '')}`
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(120_000) })
      if (!res.ok) throw new Error(`${res.status}`)
      const xml = await res.text()
      await mkdir(CACHE, { recursive: true })
      await writeFile(file, xml)
      return xml
    } catch (e) {
      console.warn(`  ${pmcid}: attempt ${attempt} failed (${(e as Error).message})`)
      await new Promise((r) => setTimeout(r, attempt * 3000))
    }
  }
  throw new Error(`couldn't download ${pmcid}`)
}

const args = process.argv.slice(2)
const sample = args.includes('--sample')
const replace = args.includes('--replace')
const only = args.filter((a) => /^PMC\d+$/i.test(a)).map((a) => a.toUpperCase())
const list = only.length ? ARTICLES.filter((a) => only.includes(a.pmcid)) : ARTICLES
const { db, pool } = createDb(process.env.DATABASE_URL!)
await ensureLibrary(db)

if (sample) {
  const a = parseJats(SAMPLE_JATS)!
  if (replace) await retireArticle(db, a.pmcid)
  if (await articleImported(db, a.pmcid)) console.log(`= ${a.title} (already here)`)
  else {
    const w = await storeArticle(db, a, ['sample'])
    console.log(`+ ${a.title} → /works/${w.slug}-${w.publicId}`)
  }
  await pool.end()
  process.exit(0)
}

let added = 0
for (const item of list) {
  if (replace) await retireArticle(db, item.pmcid)
  if (await articleImported(db, item.pmcid)) {
    console.log(`= ${item.pmcid} (already here)`)
    continue
  }
  try {
    const xml = await fetchJats(item.pmcid)
    const a = parseJats(xml)
    if (!a) {
      console.log(`- ${item.pmcid}: not CC BY or CC0, skipped`)
      continue
    }
    const w = await storeArticle(db, a, item.tags)
    added++
    console.log(`+ ${a.title} (${a.license}): ${a.chapters.length} chapters → /works/${w.slug}-${w.publicId}`)
  } catch (e) {
    console.error(`! ${item.pmcid}: ${(e as Error).message}`)
  }
  await pause()
}
console.log(`${added} added`)
await pool.end()

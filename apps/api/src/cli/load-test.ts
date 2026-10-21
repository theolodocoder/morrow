/* eslint-disable no-console -- an operator's tool reports to the terminal */
/**
 * Read-path load test (PRD Phase 7 performance testing). Hammers the endpoints readers hit most and reports
 * throughput and latency percentiles. Point it at an API started with a high API_RATE_LIMIT_PER_MINUTE.
 *   LOAD_API=http://127.0.0.1:4100 LOAD_REQUESTS=2000 LOAD_CONCURRENCY=50 pnpm --filter @morrow/api load-test
 * LOAD_WORK picks the work (its public path, e.g. a long classic); by default the most-commented public work.
 * Signed-in endpoints use one throwaway reader it signs up (the API's AUTH_RATE_LIMIT must allow one sign-up).
 */
import { randomBytes } from 'node:crypto'
import { createDb } from '@morrow/db'

const API = process.env.LOAD_API ?? 'http://127.0.0.1:4100'
const N = Number(process.env.LOAD_REQUESTS ?? 2000)
const C = Number(process.env.LOAD_CONCURRENCY ?? 50)

async function run(name: string, url: string, headers: Record<string, string> = {}) {
  const lat: number[] = []
  let errors = 0
  let next = 0
  const t0 = performance.now()
  await Promise.all(
    Array.from({ length: C }, async () => {
      while (next < N) {
        next++
        const s = performance.now()
        // Many readers, not one: each request arrives through the trusted proxy from its own address.
        const reader = `10.${next % 250}.${Math.floor(next / 250) % 250}.${next % 7}`
        const r = await fetch(url, { headers: { ...headers, 'x-forwarded-for': reader } }).catch(() => null)
        if (!r || !r.ok) errors++
        await r?.arrayBuffer()
        lat.push(performance.now() - s)
      }
    }),
  )
  const secs = (performance.now() - t0) / 1000
  lat.sort((a, b) => a - b)
  const p = (q: number) => lat[Math.min(lat.length - 1, Math.floor(q * lat.length))]!.toFixed(1)
  console.log(
    `${name.padEnd(22)} ${String(Math.round(N / secs)).padStart(6)} req/s  p50 ${p(0.5)}  p95 ${p(0.95)}  p99 ${p(0.99)} ms  errors ${errors}`,
  )
}

const { db, pool } = createDb(process.env.DATABASE_URL!, { max: 2 })
const [w] = process.env.LOAD_WORK
  ? [{ path: process.env.LOAD_WORK }]
  : (
      await pool.query<{ path: string }>(
        `select slug || '-' || public_id as path from works where visibility = 'public' and published_at is not null and deleted_at is null and hidden_at is null order by reader_comment_count desc limit 1`,
      )
    ).rows
void db
await pool.end()

async function signUpReader(): Promise<string> {
  const r = await fetch(`${API}/api/auth/sign-up/email`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      origin: process.env.LOAD_ORIGIN ?? 'http://localhost:3000',
    },
    body: JSON.stringify({
      name: 'Load reader',
      email: `load-reader-${randomBytes(4).toString('hex')}@example.test`,
      password: randomBytes(12).toString('hex'),
    }),
  })
  if (!r.ok) throw new Error(`sign-up ${r.status}`)
  return r.headers
    .getSetCookie()
    .map((c) => c.split(';')[0])
    .join('; ')
}

console.log(`load: ${N} requests per endpoint, ${C} concurrent, against ${API}`)
const cookie = await signUpReader()
await run('feed', `${API}/api/v1/public/feed`)
await run('feed, signed in', `${API}/api/v1/public/feed`, { cookie })
await run('feed popular', `${API}/api/v1/public/feed?sort=popular`)
await run('discover', `${API}/api/v1/public/discover`)
await run('search', `${API}/api/v1/public/search?q=orchard`)
if (w) {
  await run('public work page', `${API}/api/v1/public/works/${w.path}`)
  const page = (await (await fetch(`${API}/api/v1/public/works/${w.path}`)).json()) as {
    chapters: { slug: string }[]
  }
  const chapter = page.chapters[0]?.slug
  if (chapter) {
    await run('reading page', `${API}/api/v1/public/works/${w.path}/chapters/${chapter}`)
    await run('chapter comments', `${API}/api/v1/public/reading/${w.path}/comments?chapter=${chapter}`, {
      cookie,
    })
  }
  await run('reading positions', `${API}/api/v1/me/reading/${w.path}/positions`, { cookie })
}
await run('health', `${API}/healthz`)

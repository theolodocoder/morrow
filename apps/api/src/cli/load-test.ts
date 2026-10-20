/* eslint-disable no-console -- an operator's tool reports to the terminal */
/**
 * Read-path load test (PRD Phase 7 performance testing). Hammers the endpoints readers hit most and reports
 * throughput and latency percentiles. Point it at an API started with a high API_RATE_LIMIT_PER_MINUTE.
 *   LOAD_API=http://127.0.0.1:4100 LOAD_REQUESTS=2000 LOAD_CONCURRENCY=50 pnpm --filter @morrow/api load-test
 */
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
const [w] = (
  await pool.query<{ path: string }>(
    `select slug || '-' || public_id as path from works where visibility = 'public' and published_at is not null and deleted_at is null and hidden_at is null limit 1`,
  )
).rows
void db
await pool.end()
console.log(`load: ${N} requests per endpoint, ${C} concurrent, against ${API}`)
await run('discover', `${API}/api/v1/public/discover`)
await run('search', `${API}/api/v1/public/search?q=orchard`)
if (w) {
  await run('public work page', `${API}/api/v1/public/works/${w.path}`)
  const page = (await (await fetch(`${API}/api/v1/public/works/${w.path}`)).json()) as {
    chapters: { slug: string }[]
  }
  if (page.chapters[0])
    await run('reading page', `${API}/api/v1/public/works/${w.path}/chapters/${page.chapters[0].slug}`)
}
await run('health', `${API}/healthz`)

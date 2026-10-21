/* eslint-disable no-console -- an operator's tool reports to the terminal */
/**
 * Write-path load test: many writers typing into one chapter at once over real Hocuspocus connections.
 * Point it at a dedicated API + collab (never the dev stack people are using); the API needs high
 * API_RATE_LIMIT_PER_MINUTE / AUTH_RATE_LIMIT_PER_MINUTE, and collab's ALLOWED_ORIGINS must include LOAD_ORIGIN.
 *   LOAD_API=http://127.0.0.1:4030 LOAD_COLLAB=ws://127.0.0.1:4031 LOAD_WRITERS=25 LOAD_SECONDS=60 \
 *     pnpm --filter @morrow/collab load-writers
 * Also LOAD_RATE (keys/s per writer, default 5), LOAD_ORIGIN, LOAD_COLLAB_PID (else found by port with lsof).
 * Exits 1 on a correctness failure: lost edits, replicas that never converge, or a stored state that differs.
 * Prints metrics only: never text, Yjs updates, awareness, cookies, tickets or invitation links.
 * Leaves its accounts (load-<tag>-*@example.test) and works behind, like any other dev data.
 */
import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { monitorEventLoopDelay, performance } from 'node:perf_hooks'
import { cpus, loadavg } from 'node:os'
import WebSocket from 'ws'
import * as Y from 'yjs'
import { HocuspocusProvider, HocuspocusProviderWebsocket } from '@hocuspocus/provider'
import { createDb, invitations, subscriptions } from '@morrow/db'
import { CONTENT_FIELD } from '@morrow/editor'
import { documentToJSON } from '@morrow/editor/server'

const API = process.env.LOAD_API ?? 'http://127.0.0.1:4030'
const COLLAB = process.env.LOAD_COLLAB ?? 'ws://127.0.0.1:4031'
const ORIGIN = process.env.LOAD_ORIGIN ?? 'http://localhost:3000'
const N = Number(process.env.LOAD_WRITERS ?? 10)
const SECONDS = Number(process.env.LOAD_SECONDS ?? 60)
/** keystrokes per second per writer (~5 is a fast typist) */
const RATE = Number(process.env.LOAD_RATE ?? 5)
const TAG = `${Date.now().toString(36)}${randomBytes(2).toString('hex')}`
/** the seeded paragraph every writer also types into */
const SHARED = 1

const { db, pool } = createDb(process.env.DATABASE_URL!, { max: 2 })

// ---------- API (cookie session per user, same endpoints as the web app) ----------

interface User {
  id: string
  email: string
  cookie: string
}

async function call<T>(u: User | null, method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: {
      origin: ORIGIN,
      ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
      ...(u?.cookie ? { cookie: u.cookie } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })
  if (u) {
    const set = res.headers.getSetCookie().map((c) => c.split(';')[0]!)
    if (set.length) u.cookie = set.join('; ')
  }
  const text = await res.text()
  if (!res.ok) {
    // Problem titles are fixed strings; never echo anything else from the body.
    const title = (() => {
      try {
        return (JSON.parse(text) as { title?: string }).title ?? ''
      } catch {
        return ''
      }
    })()
    throw Object.assign(
      new Error(`${method} ${path.replace(/[0-9a-f-]{20,}|[\w-]{40,}/g, ':id')} → ${res.status} ${title}`),
      {
        status: res.status,
      },
    )
  }
  return (text ? JSON.parse(text) : null) as T
}

async function signUp(label: string): Promise<User> {
  const u: User = { id: '', email: `load-${TAG}-${label}@example.test`, cookie: '' }
  await call(u, 'POST', '/api/auth/sign-up/email', {
    name: `Load ${label}`,
    email: u.email,
    password: randomBytes(12).toString('hex'),
  })
  u.id = (await call<{ id: string }>(u, 'GET', '/api/v1/me')).id
  return u
}

/** Runs `fn` over `items`, `limit` at a time (sign-up hashes passwords; don't fire hundreds at once). */
async function pooled<T, R>(items: T[], limit: number, fn: (x: T, i: number) => Promise<R>): Promise<R[]> {
  const out: R[] = []
  let next = 0
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const i = next++
        out[i] = await fn(items[i]!, i)
      }
    }),
  )
  return out
}

async function invite(
  owner: User,
  workId: string,
  email: string,
): Promise<{ token: string; viaDb: boolean }> {
  try {
    const inv = await call<{ inviteUrl: string }>(owner, 'POST', `/api/v1/works/${workId}/invitations`, {
      email,
      role: 'editor',
    })
    return { token: new URL(inv.inviteUrl).pathname.split('/').pop()!, viaDb: false }
  } catch (err) {
    if ((err as { status?: number }).status !== 429) throw err
    // The invite route allows 30 per owner per hour. Past that, write the same row the route writes; acceptance
    // (which grants membership) still goes through the API.
    const token = randomBytes(32).toString('base64url')
    await db.insert(invitations).values({
      workId,
      email,
      role: 'editor',
      tokenHash: createHash('sha256').update(token).digest('hex'),
      invitedBy: owner.id,
      expiresAt: new Date(Date.now() + 7 * 86_400_000),
    })
    return { token, viaDb: true }
  }
}

// ---------- collab clients ----------

/** Node's WebSocket sends no Origin; collab refuses upgrades without an allowed one. */
class OriginWS extends WebSocket {
  constructor(url: string, protocols?: string | string[]) {
    super(url, protocols, { headers: { origin: ORIGIN } })
  }
}

interface Client {
  label: string
  doc: Y.Doc
  provider: HocuspocusProvider
  startedAt: number
  syncedAt: number | null
  refused: string | null
  disconnects: number
  close(): void
}

/** clientID → clock → when that keystroke was made. A Yjs item id is the edit's unique marker. */
const sent = new Map<number, Map<number, number>>()
const latencies: number[] = []
let receipts = 0

function openClient(u: User, documentId: string, label: string, track = true): Promise<Client> {
  const doc = new Y.Doc()
  const socket = new HocuspocusProviderWebsocket({ url: COLLAB, WebSocketPolyfill: OriginWS })
  return new Promise((resolve) => {
    const done = () => {
      clearTimeout(timer)
      resolve(c)
    }
    const timer = setTimeout(() => {
      c.refused ??= 'sync_timeout'
      done()
    }, 60_000)
    const provider = new HocuspocusProvider({
      websocketProvider: socket,
      name: documentId,
      document: doc,
      // Same flow as the web client: a fresh ticket on every (re)connect.
      token: async () => {
        const t = await call<{ ticket: string; schemaVersion: number }>(u, 'POST', '/api/v1/collab/tickets', {
          documentId,
        })
        return JSON.stringify({ ticket: t.ticket, schemaVersion: t.schemaVersion })
      },
      onSynced: ({ state }) => {
        if (state && c.syncedAt === null) {
          c.syncedAt = performance.now()
          done()
        }
      },
      onAuthenticationFailed: ({ reason }) => {
        c.refused = reason
        c.close()
        done()
      },
      onDisconnect: () => {
        if (c.syncedAt !== null) c.disconnects++
      },
    })
    const c: Client = {
      label,
      doc,
      provider,
      startedAt: performance.now(),
      syncedAt: null,
      refused: null,
      disconnects: 0,
      close: () => {
        provider.destroy()
        socket.destroy()
      },
    }
    if (track)
      doc.on('update', (update: Uint8Array, origin: unknown) => {
        if (origin !== provider) return
        const now = performance.now()
        const { from, to } = Y.parseUpdateMeta(update)
        for (const [client, end] of to) {
          const mine = sent.get(client)
          if (!mine) continue
          for (let clock = from.get(client) ?? 0; clock < end; clock++) {
            const t = mine.get(clock)
            if (t === undefined) continue
            latencies.push(now - t)
            receipts++
          }
        }
      })
    provider.attach()
  })
}

const PROSE =
  'the rain came in off the estuary and the lamps along the quay went on one by one while she counted the boats '
const WORDS = PROSE.trim().split(' ')

function paragraph(text: string): Y.XmlElement {
  const p = new Y.XmlElement('paragraph')
  p.setAttribute('id', randomUUID())
  const t = new Y.XmlText()
  if (text) t.insert(0, text)
  p.insert(0, [t])
  return p
}

/** ~2,000 words in 20 paragraphs, written by the owner over collab (never via REST). */
function seed(doc: Y.Doc) {
  const words = (i: number) =>
    Array.from({ length: 100 }, (_, k) => WORDS[(i * 7 + k) % WORDS.length]).join(' ')
  doc.transact(() => {
    doc.getXmlFragment(CONTENT_FIELD).push(Array.from({ length: 20 }, (_, i) => paragraph(`${words(i)}.`)))
  })
}

const counts = { inserts: 0, deletes: 0 }

/** One writer typing for `ms`: appends in its own paragraph, inserts in the shared one, sometimes backspaces. */
function type(c: Client, ms: number): Promise<void> {
  const fragment = c.doc.getXmlFragment(CONTENT_FIELD)
  const own = paragraph('')
  fragment.push([own])
  const ownText = own.get(0) as Y.XmlText
  const mine = new Map<number, number>()
  sent.set(c.doc.clientID, mine)
  let pos = Math.floor(Math.random() * PROSE.length)
  const keystroke = () => {
    const shared = fragment.get(SHARED)
    const r = Math.random()
    let text = ownText
    let index = ownText.length
    if (r < 0.1 && ownText.length > 0) {
      ownText.delete(ownText.length - 1, 1)
      counts.deletes++
      index--
    } else {
      if (r < 0.3 && shared instanceof Y.XmlElement && shared.get(0) instanceof Y.XmlText) {
        text = shared.get(0) as Y.XmlText
        index = Math.floor(Math.random() * (text.length + 1))
      }
      const clock = Y.getState(c.doc.store, c.doc.clientID)
      mine.set(clock, performance.now())
      text.insert(index, PROSE[pos++ % PROSE.length]!)
      counts.inserts++
      index++
    }
    // The caret moves with every keystroke, as CollaborationCaret broadcasts it.
    const at = Y.relativePositionToJSON(Y.createRelativePositionFromTypeIndex(text, index))
    c.provider.setAwarenessField('cursor', { anchor: at, head: at })
  }
  return new Promise((resolve) => {
    // Desynchronised starts and jittered gaps, like people typing.
    setTimeout(() => {
      const end = performance.now() + ms
      const tick = () => {
        if (performance.now() >= end) return resolve()
        keystroke()
        setTimeout(tick, (1000 / RATE) * (0.5 + Math.random()))
      }
      tick()
    }, Math.random() * 1000)
  })
}

// ---------- measurements ----------

const run = promisify(execFile)

async function collabPid(): Promise<number | null> {
  if (process.env.LOAD_COLLAB_PID) return Number(process.env.LOAD_COLLAB_PID)
  const port = new URL(COLLAB).port
  const { stdout } = await run('lsof', ['-ti', `tcp:${port}`, '-sTCP:LISTEN']).catch(() => ({ stdout: '' }))
  const pid = Number(stdout.trim().split('\n')[0])
  return pid || null
}

/** Collab RSS and CPU from `ps`, plus /healthz round trips as a proxy for its event-loop lag. */
function sampleServer(pid: number | null) {
  const health = COLLAB.replace(/^ws/, 'http') + '/healthz'
  const rss: number[] = []
  const cpu: { t: number; secs: number }[] = []
  const healthMs: number[] = []
  const parseTime = (s: string) => s.split(':').reduce((acc, part) => acc * 60 + Number(part), 0)
  let running = true
  // A loop, not setInterval: under load a sample can take over a second, and overlapping samples skew CPU %.
  const done = (async () => {
    while (running) {
      const t0 = performance.now()
      await fetch(health)
        .then((r) => r.arrayBuffer())
        .then(() => healthMs.push(performance.now() - t0))
        .catch(() => healthMs.push(Infinity))
      if (pid) {
        const t = performance.now()
        const { stdout } = await run('ps', ['-o', 'rss=,time=', '-p', String(pid)]).catch(() => ({
          stdout: '',
        }))
        const [kb, time] = stdout.trim().split(/\s+/)
        if (kb && time) {
          rss.push(Number(kb) / 1024)
          cpu.push({ t, secs: parseTime(time) })
        }
      }
      await sleep(Math.max(0, 1000 - (performance.now() - t0)))
    }
  })()
  /** CPU % of one core: over the whole window, and the busiest ~1 s step. */
  const cpuPct = () => {
    const pctOf = (a: { t: number; secs: number }, b: { t: number; secs: number }) =>
      (100 * (b.secs - a.secs)) / ((b.t - a.t) / 1000)
    if (cpu.length < 2) return { avg: NaN, max: NaN }
    const steps = cpu.slice(1).map((b, i) => pctOf(cpu[i]!, b))
    return { avg: pctOf(cpu[0]!, cpu.at(-1)!), max: Math.max(...steps) }
  }
  return {
    stop: async () => {
      running = false
      await done
    },
    rss,
    cpuPct,
    healthMs,
  }
}

const DOC_TABLES = ['document_states', 'document_projections', 'document_snapshots', 'edit_sessions']
async function pgCounters() {
  const { rows } = await pool.query<{ relname: string; ins: string; upd: string }>(
    `select relname, n_tup_ins as ins, n_tup_upd as upd from pg_stat_user_tables where relname = any($1)`,
    [DOC_TABLES],
  )
  return new Map(rows.map((r) => [r.relname, { ins: Number(r.ins), upd: Number(r.upd) }]))
}

async function storedState(documentId: string) {
  const { rows } = await pool.query<{ state: Buffer; revision: string }>(
    `select state, revision from document_states where document_id = $1`,
    [documentId],
  )
  return rows[0] ? { state: new Uint8Array(rows[0].state), revision: Number(rows[0].revision) } : null
}

const pct = (xs: number[], q: number) => {
  if (!xs.length) return NaN
  const s = xs.sort((a, b) => a - b) // in place: the latency array can hold millions of samples
  return s[Math.min(s.length - 1, Math.floor(q * s.length))]!
}
const f = (x: number, d = 0) => (Number.isFinite(x) ? x.toFixed(d) : String(x))
const svKey = (doc: Y.Doc) =>
  [...Y.decodeStateVector(Y.encodeStateVector(doc))].sort((a, b) => a[0] - b[0]).join(';')
const textHash = (doc: Y.Doc) =>
  createHash('sha256')
    .update(JSON.stringify(documentToJSON(doc)))
    .digest('hex')
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

// ---------- the run ----------

console.log(`load-writers ${TAG}: ${N} writers × ${SECONDS}s at ${RATE} keys/s against ${API} + ${COLLAB}`)
const t0 = performance.now()

const owner = await signUp('owner')
// Free plans cap a work at 10 people. Comp the owner as an admin would (the admin API needs a staff session + 2FA).
await db
  .insert(subscriptions)
  .values({ userId: owner.id, planKey: 'organization', status: 'comped', source: 'comp', note: 'load test' })
  .onConflictDoNothing()
const work = await call<{ id: string }>(owner, 'POST', '/api/v1/works', { title: `Load test ${TAG}` })
const chapter = (
  await call<{ items: { documentId: string }[] }>(owner, 'GET', `/api/v1/works/${work.id}/chapters`)
).items[0]!
const documentId = chapter.documentId

const writers = await pooled(
  Array.from({ length: N }, (_, i) => i),
  8,
  (i) => signUp(`w${i}`),
)
let invitesViaDb = 0
await pooled(writers, 4, async (w) => {
  const { token, viaDb } = await invite(owner, work.id, w.email)
  if (viaDb) invitesViaDb++
  await call(w, 'POST', `/api/v1/invitations/${token}/accept`)
})
const setupSecs = (performance.now() - t0) / 1000

// The owner seeds the chapter and stays on as an observer (it never types, so it sees every writer's edits).
const observer = await openClient(owner, documentId, 'owner')
if (observer.refused) throw new Error(`owner could not join: ${observer.refused}`)
seed(observer.doc)
await sleep(3000) // past the store debounce, so the seed is stored before the baseline

const pid = await collabPid()
const pgBefore = await pgCounters()
const revBefore = (await storedState(documentId))?.revision ?? 0

// Everyone opens the chapter at once.
const joinT0 = performance.now()
const clients = await Promise.all(writers.map((w, i) => openClient(w, documentId, `w${i}`)))
const joinSecs = (performance.now() - joinT0) / 1000
const live = clients.filter((c) => c.syncedAt !== null)
const refused = clients.filter((c) => c.refused)
const syncMs = live.map((c) => c.syncedAt! - c.startedAt)

// One more connection now that everyone is in: past ROOM_MAX_CONNECTIONS it must be refused cleanly.
const probe = await openClient(writers[0] ?? owner, documentId, 'probe', false)
const probeResult = probe.refused ? `refused (${probe.refused})` : 'accepted'
probe.close()
await sleep(300)

const server = sampleServer(pid)
const loop = monitorEventLoopDelay({ resolution: 10 })
loop.enable()
const elu0 = performance.eventLoopUtilization()
const load0 = loadavg()[0]!
const typeT0 = performance.now()
await Promise.all(live.map((c) => type(c, SECONDS * 1000)))
const typeSecs = (performance.now() - typeT0) / 1000
const elu = performance.eventLoopUtilization(elu0)
loop.disable()

// Quiet period: every replica (writers + observer) must reach the same state.
const replicas = [observer, ...live].map((c) => c.doc)
const quietT0 = performance.now()
let converged = false
while (performance.now() - quietT0 < 30_000) {
  if (new Set(replicas.map(svKey)).size === 1 && new Set(replicas.map(textHash)).size === 1) {
    converged = true
    break
  }
  await sleep(250)
}
const convergeMs = performance.now() - quietT0
await server.stop()
const distinctTexts = new Set(replicas.map(textHash)).size
const distinctVectors = new Set(replicas.map(svKey)).size
const expectedReceipts = counts.inserts * live.length // every other writer + the observer
const disconnects = live.reduce((n, c) => n + c.disconnects, 0)

// Everyone leaves; the last one out makes collab store immediately. The stored state must match the replicas.
const finalSv = svKey(observer.doc)
const finalText = textHash(observer.doc)
for (const c of [...live, observer]) c.close()
let persisted = 'no'
let revAfter = revBefore
const persistT0 = performance.now()
while (performance.now() - persistT0 < 30_000) {
  const s = await storedState(documentId)
  if (s) {
    revAfter = s.revision
    const d = new Y.Doc()
    Y.applyUpdate(d, s.state)
    const same = svKey(d) === finalSv && textHash(d) === finalText
    d.destroy()
    if (same) {
      persisted = `yes (${f(performance.now() - persistT0)} ms after leaving)`
      break
    }
  }
  await sleep(250)
}
await sleep(11_000) // idle backends flush their table statistics within ~10 s
const pgAfter = await pgCounters()

const results: Record<string, string> = {
  // Everything here shares the machine with the load client and whatever else runs: read results against this.
  'machine: cores / load avg 1m before→after': `${cpus().length} / ${f(load0, 1)} → ${f(loadavg()[0]!, 1)}`,
  'setup (sign-ups, invites, accepts)': `${f(setupSecs, 1)} s (${N} writers, ${invitesViaDb} invites via DB after the API's 30/h limit)`,
  'joined / refused': `${live.length}/${N} joined in ${f(joinSecs, 1)} s; refused ${refused.length}${refused.length ? ` (${[...new Set(refused.map((c) => c.refused))].join(', ')})` : ''}`,
  'connections at probe': `${live.length + 1} open → probe ${probeResult}`,
  'sync on join ms p50/p95/max': `${f(pct(syncMs, 0.5))} / ${f(pct(syncMs, 0.95))} / ${f(Math.max(...syncMs))}`,
  'keystrokes (inserts/deletes)': `${counts.inserts} / ${counts.deletes} in ${f(typeSecs, 1)} s = ${f((counts.inserts + counts.deletes) / typeSecs)} /s`,
  'propagation ms p50/p95/p99/max': `${f(pct(latencies, 0.5), 1)} / ${f(pct(latencies, 0.95), 1)} / ${f(pct(latencies, 0.99), 1)} / ${f(pct(latencies, 1), 1)}`,
  'markers received / expected': `${receipts} / ${expectedReceipts} (lost ${expectedReceipts - receipts})`,
  'disconnects after sync': String(disconnects),
  convergence: converged
    ? `yes, ${f(convergeMs)} ms after typing stopped`
    : `NO after 30 s: ${distinctTexts} distinct texts, ${distinctVectors} distinct state vectors`,
  persisted: `${persisted}; revisions ${revBefore} → ${revAfter} (+${revAfter - revBefore} stores)`,
  'collab CPU % of a core avg/max': `${f(server.cpuPct().avg)} / ${f(server.cpuPct().max)}`,
  'collab RSS MB start/max': `${f(server.rss[0] ?? NaN)} / ${f(Math.max(...server.rss))}`,
  'collab /healthz ms p50/p99/max': `${f(pct(server.healthMs, 0.5), 1)} / ${f(pct(server.healthMs, 0.99), 1)} / ${f(Math.max(...server.healthMs), 1)}`,
  'load client loop delay p99 ms / utilisation': `${f(loop.percentile(99) / 1e6, 1)} / ${f(elu.utilization * 100)}%`,
}
for (const t of DOC_TABLES) {
  const a = pgBefore.get(t)
  const b = pgAfter.get(t)
  if (a && b) results[`pg ${t} ins/upd (whole DB)`] = `+${b.ins - a.ins} / +${b.upd - a.upd}`
}
// pg_stat counts every writer to the database; these are this chapter's own rows.
const { rows: own } = await pool.query<{ snapshots: number; sessions: number }>(
  `select (select count(*)::int from document_snapshots where document_id = $1) as snapshots,
          (select count(*)::int from edit_sessions where document_id = $1) as sessions`,
  [documentId],
)
results['this chapter: snapshots / edit sessions'] = `${own[0]!.snapshots} / ${own[0]!.sessions}`
console.table(results)
await pool.end()
process.exit(converged && persisted.startsWith('yes') && receipts === expectedReceipts ? 0 : 1)

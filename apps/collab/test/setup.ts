import { execSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import WebSocket from 'ws'
import * as Y from 'yjs'
import { HocuspocusProvider, HocuspocusProviderWebsocket } from '@hocuspocus/provider'
import { branches, chapters, createDb, documents, user, workMembers, works } from '@morrow/db'
import { mintTicket } from '@morrow/domain/signing'
import { SCHEMA_VERSION } from '@morrow/editor'
import type { Role } from '@morrow/domain'
import { parseEnv } from '../src/env.ts'

const base = process.env.TEST_DATABASE_URL ?? 'postgres://morrow:morrow@127.0.0.1:5432/morrow'
export const url = (name = 'core') => base.replace(/\/[^/]+$/, `/morrow_collab_test_${name}`)
export const ORIGIN = 'http://localhost:3000'

export async function freshDatabase(name = 'core') {
  const admin = createDb(base, { max: 1 })
  await admin.pool.query(`drop database if exists morrow_collab_test_${name} with (force)`)
  await admin.pool.query(`create database morrow_collab_test_${name}`)
  await admin.pool.end()
  const migrate = fileURLToPath(new URL('../../../packages/db/src/migrate.ts', import.meta.url))
  execSync(`node --import tsx ${migrate}`, {
    env: { ...process.env, DATABASE_URL: url(name) },
    stdio: 'ignore',
  })
}

export const env = (port: number, over: Record<string, string> = {}) =>
  parseEnv({
    DATABASE_URL: url(),
    COLLAB_PORT: String(port),
    TICKET_SECRET: 't'.repeat(40),
    INTERNAL_SECRET: 'i'.repeat(40),
    ALLOWED_ORIGINS: ORIGIN,
    STORE_DEBOUNCE_MS: '50',
    STORE_MAX_DEBOUNCE_MS: '200',
    ...over,
  })

let nextPort = 43000 + Math.floor(Math.random() * 1500)
export const port = () => nextPort++

export async function seedChapter(
  db: ReturnType<typeof createDb>['db'],
  members: Partial<Record<Role, string>> = {},
) {
  const owner = await addUser(db)
  const [w] = await db
    .insert(works)
    .values({ ownerId: owner, title: 'The Salt Orchard', slug: 'the-salt-orchard' })
    .returning()
  await db.insert(workMembers).values({ workId: w!.id, userId: owner, role: 'owner', grantedBy: owner })
  const [b] = await db
    .insert(branches)
    .values({ workId: w!.id, name: 'Main', slug: 'main', createdBy: owner, isDefault: true })
    .returning()
  const [d] = await db
    .insert(documents)
    .values({ workId: w!.id, kind: 'chapter', schemaVersion: SCHEMA_VERSION })
    .returning()
  await db
    .insert(chapters)
    .values({ workId: w!.id, branchId: b!.id, documentId: d!.id, title: 'Chapter 1', position: 'a0' })
  const ids: Partial<Record<Role, string>> = { owner }
  for (const role of Object.keys(members) as Role[]) {
    const u = await addUser(db)
    ids[role] = u
    await db.insert(workMembers).values({ workId: w!.id, userId: u, role, grantedBy: owner })
  }
  return { workId: w!.id, documentId: d!.id, users: ids }
}

export async function addUser(db: ReturnType<typeof createDb>['db']) {
  const id = `u_${randomUUID()}`
  await db.insert(user).values({ id, name: 'Writer', email: `${id}@example.test` })
  return id
}

export function connect(
  p: number,
  documentId: string,
  userId: string,
  opts: { mode?: 'edit' | 'read'; schemaVersion?: number; ticket?: string; origin?: string } = {},
) {
  const doc = new Y.Doc()
  const events = { stateless: [] as string[], authFailed: [] as string[] }
  const ticket =
    opts.ticket ?? mintTicket(env(p).TICKET_SECRET, { userId, documentId, mode: opts.mode ?? 'edit' }).ticket
  // Node's global WebSocket sends no Origin header, so tests use `ws` to present one (spike S3).
  class OriginWS extends WebSocket {
    constructor(u: string, protocols?: string | string[]) {
      super(u, protocols, { headers: { origin: opts.origin ?? ORIGIN } })
    }
  }
  const ws = new HocuspocusProviderWebsocket(
    {
      url: `ws://127.0.0.1:${p}`,
      WebSocketPolyfill: OriginWS,
      maxAttempts: 3,
    } /* note: `delay` alone stops the first dial */,
  )
  const provider = new HocuspocusProvider({
    websocketProvider: ws,
    name: documentId,
    document: doc,
    token: JSON.stringify({ ticket, schemaVersion: opts.schemaVersion ?? SCHEMA_VERSION }),
    onStateless: ({ payload }) => {
      events.stateless.push(JSON.parse(payload).type)
    },
    onAuthenticationFailed: ({ reason }) => {
      events.authFailed.push(reason)
    },
  })
  provider.attach()
  return {
    doc,
    provider,
    events,
    close: () => {
      provider.destroy()
      ws.destroy()
    },
  }
}

export async function waitFor(cond: () => boolean | Promise<boolean>, ms = 5000, label = 'condition') {
  const t0 = Date.now()
  while (Date.now() - t0 < ms) {
    if (await cond()) return
    await new Promise((r) => setTimeout(r, 25))
  }
  throw new Error(`timed out waiting for ${label}`)
}

export function writeParagraph(doc: Y.Doc, text: string, id: string = randomUUID()) {
  doc.transact(() => {
    const el = new Y.XmlElement('paragraph')
    el.setAttribute('id', id)
    const t = new Y.XmlText()
    t.insert(0, text)
    el.insert(0, [t])
    doc.getXmlFragment('default').push([el])
  })
}

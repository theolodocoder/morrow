import { execSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { eq } from 'drizzle-orm'
import { createDb, documentProjections, documentSnapshots } from '@morrow/db'
import type { Snapshot } from '@morrow/contracts'
import { buildApp } from '../src/app.ts'
import { parseEnv } from '../src/env.ts'
import type { CollabGateway } from '../src/collab-gateway.ts'
import { devEmailSender } from '../src/email.ts'

const base = process.env.TEST_DATABASE_URL ?? 'postgres://morrow:morrow@127.0.0.1:5432/morrow'
export const ORIGIN = 'http://localhost:3000'

export const env = parseEnv({
  NODE_ENV: 'test',
  DATABASE_URL: base, // unused by the app under test: it receives its database connection directly
  WEB_ORIGIN: ORIGIN,
  COLLAB_PUBLIC_URL: 'ws://localhost:4001',
  COLLAB_INTERNAL_URL: 'http://127.0.0.1:4001',
  AUTH_SECRET: 'a'.repeat(40),
  TICKET_SECRET: 't'.repeat(40),
  INTERNAL_SECRET: 'i'.repeat(40),
  DISCOVER_CACHE_MS: '0', // tests change data and look again immediately
})

/** Each test file gets its own throwaway database so files can run in parallel. */
export async function setup(name: string) {
  const dbName = `morrow_api_test_${name}`
  const url = base.replace(/\/[^/]+$/, `/${dbName}`)
  const admin = createDb(base, { max: 1 })
  await admin.pool.query(`drop database if exists ${dbName} with (force)`)
  await admin.pool.query(`create database ${dbName}`)
  await admin.pool.end()
  const migrate = fileURLToPath(new URL('../../../packages/db/src/migrate.ts', import.meta.url))
  execSync(`node --import tsx ${migrate}`, { env: { ...process.env, DATABASE_URL: url }, stdio: 'ignore' })
  const db = createDb(url)
  const snapshots: Parameters<CollabGateway['createSnapshot']>[0][] = []
  const revocations: Parameters<CollabGateway['revokeAccess']>[0][] = []
  const forks: Parameters<CollabGateway['forkDocument']>[0][] = []
  const restores: Parameters<CollabGateway['restoreDocument']>[0][] = []
  const failForks = { next: 0 }
  const feedback: Parameters<CollabGateway['notifyFeedback']>[0][] = []
  /** Proposal engine stand-in: tests choose what classification collab would report. */
  const engine = {
    classification: { kind: 'clean' } as
      { kind: 'fast-forward' | 'clean' } | { kind: 'conflict'; blockIds: string[]; gaps: string[] },
    applied: [] as string[],
    refreshed: [] as string[],
  }
  const email = devEmailSender(() => {})
  const collab: CollabGateway = {
    async forkDocument(input) {
      if (failForks.next > 0) {
        failForks.next--
        throw new Error('collab unavailable')
      }
      forks.push(input)
      // Like collab: the fork's base is a real snapshot of the source as it is now.
      const snap = await this.createSnapshot({
        documentId: input.sourceDocumentId,
        workId: input.workId,
        label: null,
        createdBy: input.createdBy,
      })
      // ...and the copy starts with the source's text.
      const [src] = await db.db
        .select()
        .from(documentProjections)
        .where(eq(documentProjections.documentId, input.sourceDocumentId))
      if (src) {
        const copy = { ...src, documentId: input.targetDocumentId }
        await db.db
          .insert(documentProjections)
          .values(copy)
          .onConflictDoUpdate({ target: documentProjections.documentId, set: copy })
      }
      return { forkSnapshotId: snap.id }
    },
    async forkSnapshot(input) {
      // like collab: the copy starts with the snapshot's text
      const [snap] = await db.db
        .select()
        .from(documentSnapshots)
        .where(eq(documentSnapshots.id, input.snapshotId))
      if (!snap) throw new Error('snapshot_not_found')
      const v = {
        documentId: input.targetDocumentId,
        workId: input.workId,
        contentJson: snap.contentJson,
        plainText: '',
        wordCount: snap.wordCount,
        sourceRevision: 1,
      }
      await db.db
        .insert(documentProjections)
        .values(v)
        .onConflictDoUpdate({ target: documentProjections.documentId, set: v })
    },
    async restoreDocument(input) {
      restores.push(input)
      return { preRestoreSnapshotId: crypto.randomUUID() }
    },
    async classifyProposal(input) {
      const doc = async (id: string) =>
        (await db.db.select().from(documentProjections).where(eq(documentProjections.documentId, id)))[0]
          ?.contentJson ?? { type: 'doc', content: [] }
      const [base] = await db.db
        .select()
        .from(documentSnapshots)
        .where(eq(documentSnapshots.id, input.baseSnapshotId))
      return {
        classification: engine.classification,
        base: base?.contentJson,
        chapter: await doc(input.targetDocumentId),
        proposal: await doc(input.workspaceDocumentId),
      }
    },
    async applyProposal(input) {
      if (engine.classification.kind === 'conflict' && !input.resolve)
        return { ok: false, classification: engine.classification }
      const again = engine.applied.includes(input.proposalId)
      engine.applied.push(input.proposalId)
      const snap = await this.createSnapshot({
        documentId: input.targetDocumentId,
        workId: input.workId,
        label: null,
        createdBy: input.userId,
      })
      // like collab: the workspace state as applied, the next base for a branch merge
      const from = await this.createSnapshot({
        documentId: input.workspaceDocumentId,
        workId: input.workId,
        label: null,
        createdBy: input.userId,
      })
      return { ok: true, appliedSnapshotId: snap.id, workspaceSnapshotId: from.id, alreadyApplied: again }
    },
    async refreshProposal(input) {
      engine.refreshed.push(input.proposalId)
      const snap = await this.createSnapshot({
        documentId: input.targetDocumentId,
        workId: input.workId,
        label: null,
        createdBy: input.userId,
      })
      return { baseSnapshotId: snap.id, reference: [] }
    },
    async liveContent(input) {
      const [p] = await db.db
        .select()
        .from(documentProjections)
        .where(eq(documentProjections.documentId, input.documentId))
      return { content: p?.contentJson ?? { type: 'doc', content: [] } }
    },
    async notifyFeedback(input) {
      feedback.push(input)
    },
    async revokeAccess(input) {
      revocations.push(input)
    },
    /** Like collab: freeze the document's current content (here, its projection) into a real snapshot row. */
    async createSnapshot(input) {
      snapshots.push(input)
      const [p] = await db.db
        .select()
        .from(documentProjections)
        .where(eq(documentProjections.documentId, input.documentId))
      const [row] = await db.db
        .insert(documentSnapshots)
        .values({
          documentId: input.documentId,
          workId: input.workId,
          state: Buffer.alloc(0),
          contentJson: p?.contentJson ?? { type: 'doc', content: [] },
          contentHash: 'test',
          wordCount: p?.wordCount ?? 0,
          reason: input.reason ?? 'manual',
          label: input.label,
          createdBy: input.createdBy,
        })
        .returning()
      return {
        id: row!.id,
        documentId: row!.documentId,
        reason: row!.reason,
        label: row!.label,
        wordCount: row!.wordCount,
        createdBy: row!.createdBy,
        createdAt: row!.createdAt.toISOString(),
      } satisfies Snapshot
    },
  }
  const app = await buildApp({ env, db: db.db, collab, email, logger: false })
  return { app, db, snapshots, revocations, forks, restores, failForks, email, engine, feedback }
}

type App = Awaited<ReturnType<typeof setup>>['app']

/** Signs up a fresh user and returns a request helper bound to their session cookie. */
export async function signUp(app: App, name = 'Ama') {
  const email = `${crypto.randomUUID()}@example.test`
  const res = await app.inject({
    method: 'POST',
    url: '/api/auth/sign-up/email',
    headers: { origin: ORIGIN },
    payload: { name, email, password: 'correct horse battery' },
  })
  if (res.statusCode !== 200) throw new Error(`sign-up failed: ${res.statusCode} ${res.body}`)
  const cookie = [res.headers['set-cookie']]
    .flat()
    .map((c) => String(c).split(';')[0])
    .join('; ')
  const me = res.json() as { user: { id: string } }
  const call = (
    method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
    path: string,
    payload?: unknown,
    headers: Record<string, string> = {},
  ) =>
    app.inject({
      method,
      url: path,
      headers: { cookie, origin: ORIGIN, ...headers },
      ...(payload !== undefined ? { payload: payload as object } : {}),
    })
  return { id: me.user.id, email, cookie, signUpResponse: res, call }
}

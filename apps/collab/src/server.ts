/**
 * The collaboration service (architecture §5, §8): the single writer of live document state (P-013).
 * Each chapter document is one Hocuspocus room named by its document id.
 */
import { Server } from '@hocuspocus/server'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { randomUUID } from 'node:crypto'
import * as Y from 'yjs'
import { documentMode } from '@morrow/domain'
import { verifyInternal, verifyTicket, INTERNAL_SIGNATURE_HEADER } from '@morrow/domain/signing'
import {
  blocks,
  documentSnapshots,
  editSessions,
  loadDocumentAccess,
  loadRestriction,
  toAccessContext,
  works,
  type Database,
} from '@morrow/db'
import { and, eq, inArray, or } from 'drizzle-orm'
import type { PMNode } from '@morrow/editor'
import { CONTENT_FIELD, SCHEMA_VERSION } from '@morrow/editor'
import { documentToJSON, initialDocumentState, replaceDocumentContent } from '@morrow/editor/server'
import type { CollabEvent } from '@morrow/contracts'
import type { CollabEnv } from './env.ts'
import { createDocumentStore } from './document-store.ts'
import { createVoiceRooms, parseVoiceMessage } from './voice.ts'
import {
  applyProposal,
  applyUsingProposal,
  classifyDocs,
  docFromState,
  freeze,
  refreshWorkspace,
} from './proposals.ts'
import type { Logger } from './logger.ts'

export interface ConnectionContext {
  userId: string
  workId: string
  readOnly: boolean
}

/** Rejections must carry `reason`: Hocuspocus forwards only that, anything else arrives as "permission-denied". */
const reject = (reason: 'access_denied' | 'room_full' | `reload_required:${number}`) =>
  Object.assign(new Error(reason), { reason })

/** Ends a raw HTTP request handled inside a Hocuspocus hook. `throw null` tells Hocuspocus it was handled. */
const handled = (): never => {
  throw null
}

const AUTO_SNAPSHOT_INTERVAL_MS = 15 * 60_000

export async function startCollab(env: CollabEnv, db: Database, log: Logger) {
  const store = createDocumentStore(db)
  const degraded = new Set<string>()
  const lastAutoSnapshot = new Map<string, number>()
  const lastAccessCheck = new WeakMap<object, number>()
  const sessions = new Map<
    string,
    { documentId: string; workId: string; userId: string; startedAt: Date; updates: number }
  >()

  /** What this user may do on this document right now: 'edit', 'read' or 'none'. */
  async function currentMode(documentId: string, userId: string): Promise<'edit' | 'read' | 'none'> {
    const row = await loadDocumentAccess(db, documentId, userId)
    const mode = row ? documentMode({ userId }, toAccessContext(row), row) : 'none'
    // A moderator's suspension makes the account read-only everywhere (FR-031).
    return mode === 'edit' && (await loadRestriction(db, userId)) === 'suspended' ? 'read' : mode
  }

  /** Tell the client its access changed, then close; it reconnects with a fresh ticket at its new role, or not at all. */
  function closeForAccessChange(
    conn: { sendStateless(p: string): void; close(e?: { code: number; reason: string }): void },
    mode: 'read' | 'none',
  ) {
    conn.sendStateless(JSON.stringify({ v: 1, type: 'access_changed', mode } satisfies CollabEvent))
    conn.close({ code: 4403, reason: 'access_changed' })
  }

  const send = (doc: { broadcastStateless(p: string): void }, event: CollabEvent) =>
    doc.broadcastStateless(JSON.stringify(event))

  // Voice rooms (voice.ts): blocking is checked in both directions, cached briefly per pair.
  const blockCache = new Map<string, { at: number; blocked: boolean }>()
  const voice = createVoiceRooms({
    async blocked(a, b) {
      const key = a < b ? `${a}|${b}` : `${b}|${a}`
      const hit = blockCache.get(key)
      if (hit && Date.now() - hit.at < 60_000) return hit.blocked
      const rows = await db
        .select({ x: blocks.blockerId })
        .from(blocks)
        .where(
          or(
            and(eq(blocks.blockerId, a), eq(blocks.blockedId, b)),
            and(eq(blocks.blockerId, b), eq(blocks.blockedId, a)),
          ),
        )
        .limit(1)
      if (blockCache.size > 10_000) blockCache.clear()
      blockCache.set(key, { at: Date.now(), blocked: rows.length > 0 })
      return rows.length > 0
    },
  })

  const server = new Server<ConnectionContext>({
    name: 'morrow-collab',
    port: env.COLLAB_PORT, // listen(0) is ignored by Hocuspocus v4; the port must be in config (spike S3)
    quiet: true,
    stopOnSignals: false,
    debounce: env.STORE_DEBOUNCE_MS,
    maxDebounce: env.STORE_MAX_DEBOUNCE_MS,

    async onUpgrade({ request, socket }) {
      const origin = request.headers.origin
      if (!origin || !env.ALLOWED_ORIGINS.includes(origin)) {
        log.warn({ ev: 'ws_origin_rejected', origin })
        socket.write('HTTP/1.1 403 Forbidden\r\nConnection: close\r\nContent-Length: 0\r\n\r\n')
        socket.destroy()
        handled() // never throw an Error here: it crashes the process (spike S3)
      }
    },

    async onAuthenticate({ token, documentName, connectionConfig, instance }) {
      let parsed: { ticket?: unknown; schemaVersion?: unknown }
      try {
        parsed = JSON.parse(token)
      } catch {
        throw reject('access_denied')
      }
      // Schema gate: an older editor would delete content it cannot represent, for every peer (spike S1/S2).
      if (typeof parsed.schemaVersion !== 'number' || parsed.schemaVersion < SCHEMA_VERSION)
        throw reject(`reload_required:${SCHEMA_VERSION}`)
      if (typeof parsed.ticket !== 'string') throw reject('access_denied')

      const verified = verifyTicket(env.TICKET_SECRET, parsed.ticket, documentName)
      if (!verified.ok) {
        log.info({ ev: 'ticket_rejected', reason: verified.error, doc: documentName })
        throw reject('access_denied')
      }
      const { userId, mode } = verified.claims

      // A ticket only proves a recent decision; membership is re-checked against the database now.
      const row = await loadDocumentAccess(db, documentName, userId)
      const access = row ? documentMode({ userId }, toAccessContext(row), row) : 'none'
      if (!row || access === 'none') throw reject('access_denied')
      const mayEdit = access === 'edit' && (await loadRestriction(db, userId)) !== 'suspended'

      const open = instance.documents.get(documentName)?.getConnectionsCount() ?? 0
      if (open >= env.ROOM_MAX_CONNECTIONS) throw reject('room_full')

      const readOnly = !(mayEdit && mode === 'edit')
      connectionConfig.readOnly = readOnly // enforced by the server: updates from read-only connections are dropped
      return { userId, workId: row.work.id, readOnly }
    },

    async connected({ connection, documentName, context, socketId }) {
      // Everyone on the chapter can see who's in its voice room (and join it).
      if (context?.userId)
        await voice.watch(documentName, socketId, context.userId, (m) => connection.sendStateless(m))
    },

    async onStateless({ connection, documentName, payload }) {
      const msg = parseVoiceMessage(payload)
      const userId = (connection.context as ConnectionContext | undefined)?.userId
      if (!msg || !userId) return
      await voice.handle(documentName, connection.socketId, userId, (m) => connection.sendStateless(m), msg)
    },

    async beforeHandleMessage({ connection, context, documentName }) {
      if (!context?.userId) return
      const last = lastAccessCheck.get(connection) ?? Date.now()
      if (!lastAccessCheck.has(connection)) {
        lastAccessCheck.set(connection, last)
        return
      }
      // Live connections are re-authorized at most every ACCESS_RECHECK_MS, on their next message. Clients send
      // presence heartbeats, so quiet connections are re-checked too. This closes the auth/revoke race (spike S3)
      // and bounds staleness if an API → collab revoke call is ever lost.
      if (Date.now() - last < env.ACCESS_RECHECK_MS) return
      lastAccessCheck.set(connection, Date.now())
      const mode = await currentMode(documentName, context.userId)
      if (mode === 'none' || (mode === 'read' && !context.readOnly)) {
        log.info({ ev: 'access_recheck_closed', doc: documentName, mode })
        closeForAccessChange(connection, mode)
        throw Object.assign(new Error('access changed'), { reason: 'access_denied' })
      }
    },

    async onLoadDocument({ documentName }) {
      // New chapters are seeded here, never by browser editors (see initialDocumentState).
      return (await store.load(documentName)) ?? initialDocumentState(documentName)
    },

    async onChange({ documentName, document, context, socketId, connection }) {
      // Edit sessions: trustworthy "who edited what, when" (attribution groundwork; never from Yjs client ids).
      if (connection && context?.userId && !context.readOnly) {
        const key = `${socketId}:${documentName}`
        const session = sessions.get(key) ?? {
          documentId: documentName,
          workId: context.workId,
          userId: context.userId,
          startedAt: new Date(),
          updates: 0,
        }
        session.updates++
        sessions.set(key, session)
      }
      const now = Date.now()
      const last = lastAutoSnapshot.get(documentName)
      if (last === undefined) {
        lastAutoSnapshot.set(documentName, now)
        return
      }
      if (now - last > AUTO_SNAPSHOT_INTERVAL_MS) {
        lastAutoSnapshot.set(documentName, now)
        await store
          .snapshot(documentName, context.workId, document, 'auto')
          .catch((err) => log.error({ ev: 'snapshot_failed', doc: documentName, err: String(err) }))
      }
    },

    async onStoreDocument({ documentName, document, lastContext }) {
      const workId = lastContext?.workId
      if (!workId) return // nothing authenticated ever touched this document
      const update = Y.encodeStateAsUpdate(document)
      for (let attempt = 0; ; attempt++) {
        try {
          const t0 = performance.now()
          const result = await store.store(documentName, workId, update)
          // Project from the merged stored state, not this instance's memory: if another instance also holds
          // the document, only the merged state contains everyone's edits.
          const merged = new Y.Doc()
          Y.applyUpdate(merged, result.state)
          const projection = await store.writeProjection(documentName, workId, merged, result.revision)
          merged.destroy()
          log.info({
            ev: 'stored',
            doc: documentName,
            ms: Math.round(performance.now() - t0),
            bytes: result.byteSize,
            revision: result.revision,
            compacted: result.compacted,
          })
          if (projection.duplicateBlockIds.length)
            repairDuplicateIds(document, projection.duplicateBlockIds, log, documentName)
          if (degraded.delete(documentName)) send(document, { v: 1, type: 'save_recovered' })
          return
        } catch (err) {
          log.error({ ev: 'store_failed', doc: documentName, attempt, err: String(err) })
          if (!degraded.has(documentName)) {
            degraded.add(documentName)
            send(document, { v: 1, type: 'save_degraded' })
          }
          // Keep retrying with capped backoff; unsaved state stays in memory and on every connected client.
          await new Promise((r) => setTimeout(r, Math.min(100 * 2 ** attempt, 5000)))
        }
      }
    },

    async onDisconnect({ documentName, document, clientsCount, context, socketId }) {
      await voice.drop(documentName, socketId, true)
      const key = `${socketId}:${documentName}`
      const session = sessions.get(key)
      if (session) {
        sessions.delete(key)
        await db
          .insert(editSessions)
          .values({ ...session, endedAt: new Date(), updateCount: session.updates })
          .catch((err) => log.error({ ev: 'edit_session_failed', doc: documentName, err: String(err) }))
      }
      if (clientsCount > 0 || !context?.workId || context.readOnly) return
      await store
        .snapshot(documentName, context.workId, document, 'auto')
        .catch((err) => log.error({ ev: 'snapshot_failed', doc: documentName, err: String(err) }))
    },

    async afterUnloadDocument({ documentName }) {
      lastAutoSnapshot.delete(documentName)
    },

    async onRequest({ request, response, instance }) {
      try {
        const url = new URL(request.url ?? '/', 'http://collab')
        if (url.pathname === '/healthz') return json(response, 200, { ok: true })
        if (url.pathname === '/readyz') {
          await db.execute('select 1')
          return json(response, 200, { ok: true })
        }
        if (!url.pathname.startsWith('/internal/')) return json(response, 404, { error: 'not_found' })

        const body = await readBody(request)
        if (
          !verifyInternal(
            env.INTERNAL_SECRET,
            header(request, INTERNAL_SIGNATURE_HEADER),
            request.method ?? '',
            url.pathname,
            body,
          )
        )
          return json(response, 401, { error: 'bad_signature' })

        if (url.pathname === '/internal/access/revoke' && request.method === 'POST') {
          const input = JSON.parse(body || '{}') as { workId?: string; userId?: string; documentId?: string }
          if (!input.workId || !input.userId)
            return json(response, 400, { error: 'workId and userId required' })
          let closed = 0
          for (const [documentName, document] of instance.documents) {
            if (input.documentId && documentName !== input.documentId) continue
            for (const conn of document.getConnections()) {
              const ctx = conn.context as ConnectionContext | undefined
              if (ctx?.userId !== input.userId || ctx.workId !== input.workId) continue
              const mode = await currentMode(documentName, input.userId)
              closeForAccessChange(conn, mode === 'none' ? 'none' : 'read')
              closed++
            }
          }
          log.info({ ev: 'access_revoked', workId: input.workId, closed })
          return json(response, 200, { closed })
        }

        const live = /^\/internal\/documents\/([0-9a-f-]{36})\/content$/.exec(url.pathname)
        if (live && request.method === 'POST') {
          // The text as it is this moment (stored projections lag behind by the store debounce).
          const input = JSON.parse(body || '{}') as { workId: string; userId: string }
          const conn = await instance.openDirectConnection(live[1]!, {
            userId: input.userId,
            workId: input.workId,
            readOnly: true,
          })
          try {
            return json(response, 200, { content: documentToJSON(conn.document!) })
          } finally {
            await conn.disconnect()
          }
        }

        const notify = /^\/internal\/documents\/([0-9a-f-]{36})\/feedback$/.exec(url.pathname)
        if (notify && request.method === 'POST') {
          // Tell connected readers that comments or reactions changed, so they refetch (nothing to do if none are).
          const input = JSON.parse(body || '{}') as { what?: string }
          const what = input.what === 'reactions' ? 'reactions' : 'comments'
          const doc = instance.documents.get(notify[1]!)
          if (doc) send(doc, { v: 1, type: 'feedback_changed', what })
          return json(response, 200, { delivered: doc?.getConnectionsCount() ?? 0 })
        }

        const fork = /^\/internal\/documents\/([0-9a-f-]{36})\/fork$/.exec(url.pathname)
        if (fork && request.method === 'POST') {
          // Branch creation (architecture §10): copy the *encoded Yjs state*, never re-imported JSON, so the copy
          // shares lineage with its source and a later merge stays possible. Merge-on-write makes this idempotent.
          const input = JSON.parse(body || '{}') as {
            targetDocumentId: string
            workId: string
            createdBy: string
            reason?: 'branch_fork' | 'proposal_base'
          }
          const conn = await instance.openDirectConnection(fork[1]!, {
            userId: input.createdBy,
            workId: input.workId,
            readOnly: true,
          })
          try {
            // Freeze first: the snapshot (the fork's base) and the copy must be the same state, even if writers keep
            // typing while the database calls below are in flight.
            const frozen = freeze(conn.document!)
            const state = Y.encodeStateAsUpdate(frozen)
            const snapshot = await store.snapshot(
              fork[1]!,
              input.workId,
              frozen,
              input.reason === 'proposal_base' ? 'proposal_base' : 'branch_fork',
              { createdBy: input.createdBy, label: null },
            )
            const stored = await store.store(input.targetDocumentId, input.workId, state)
            const copy = new Y.Doc()
            Y.applyUpdate(copy, stored.state)
            await store.writeProjection(input.targetDocumentId, input.workId, copy, stored.revision)
            copy.destroy()
            frozen.destroy()
            return json(response, 200, { forkSnapshotId: snapshot?.id ?? null })
          } finally {
            await conn.disconnect()
          }
        }

        const proposal = /^\/internal\/proposals\/(classify|apply|refresh)$/.exec(url.pathname)
        if (proposal && request.method === 'POST') {
          const input = JSON.parse(body || '{}') as {
            proposalId: string
            workId: string
            targetDocumentId: string
            workspaceDocumentId: string
            baseSnapshotId: string
            userId: string
            /** apply only: the reviewer chose to use the proposal's wording where both changed */
            resolve?: 'use_proposal'
          }
          const [baseRow] = await db
            .select({ state: documentSnapshots.state })
            .from(documentSnapshots)
            .where(
              and(
                eq(documentSnapshots.id, input.baseSnapshotId),
                // The base is a state both sides share: for proposals, the chapter when it started; for branch
                // merges after the first, the branch chapter as it was last merged.
                inArray(documentSnapshots.documentId, [input.targetDocumentId, input.workspaceDocumentId]),
              ),
            )
          if (!baseRow) return json(response, 404, { error: 'base_not_found' })
          const base = docFromState(baseRow.state)
          const action = proposal[1]
          const ctx = { userId: input.userId, workId: input.workId }
          const head = await instance.openDirectConnection(input.targetDocumentId, {
            ...ctx,
            readOnly: action !== 'apply',
          })
          const ws = await instance.openDirectConnection(input.workspaceDocumentId, {
            ...ctx,
            readOnly: action !== 'refresh',
          })
          try {
            if (action === 'classify') {
              return json(response, 200, {
                classification: classifyDocs(base, head.document!, ws.document!),
                base: documentToJSON(base),
                chapter: documentToJSON(head.document!),
                proposal: documentToJSON(ws.document!),
              })
            }
            if (action === 'apply') {
              // Apply from a frozen copy of the workspace, so we can record exactly what was applied (the next base).
              const applied = freeze(ws.document!)
              let result!: ReturnType<typeof applyProposal>
              await head.transact((doc) => {
                result =
                  input.resolve === 'use_proposal'
                    ? {
                        ...applyUsingProposal(doc, applied, base, input.proposalId),
                        classification: { kind: 'clean' },
                      }
                    : applyProposal(doc, applied, base, input.proposalId)
              })
              if (!result.applied && !result.alreadyApplied)
                return json(response, 409, { classification: result.classification })
              const snap = await store.snapshot(
                input.targetDocumentId,
                input.workId,
                freeze(head.document!),
                'proposal_applied',
                { createdBy: input.userId, label: null },
              )
              if (snap)
                send(head.document!, {
                  v: 1,
                  type: 'snapshot_created',
                  snapshotId: snap.id,
                  reason: 'proposal_applied',
                })
              const appliedFrom = await store.snapshot(
                input.workspaceDocumentId,
                input.workId,
                applied,
                'proposal_base',
                {
                  createdBy: input.userId,
                  label: null,
                },
              )
              applied.destroy()
              log.info({ ev: 'proposal_applied', proposal: input.proposalId, again: !result.applied })
              return json(response, 200, {
                appliedSnapshotId: snap?.id ?? null,
                /** the workspace state that was applied: a branch merge's next base */
                workspaceSnapshotId: appliedFrom?.id ?? null,
                alreadyApplied: !result.applied,
              })
            }
            // refresh: merge the chapter's newer text into the workspace, then re-base on exactly what was merged
            const chapter = freeze(head.document!)
            let outcome!: ReturnType<typeof refreshWorkspace>
            await ws.transact((doc) => {
              outcome = refreshWorkspace(doc, chapter, base)
            })
            const snap = await store.snapshot(
              input.targetDocumentId,
              input.workId,
              chapter,
              'proposal_base',
              {
                createdBy: input.userId,
                label: null,
              },
            )
            chapter.destroy()
            return json(response, 200, { baseSnapshotId: snap!.id, reference: outcome.reference })
          } finally {
            base.destroy()
            await ws.disconnect()
            await head.disconnect()
          }
        }

        const fromSnapshot = /^\/internal\/snapshots\/([0-9a-f-]{36})\/fork$/.exec(url.pathname)
        if (fromSnapshot && request.method === 'POST') {
          // Public participation (M6): an outside contributor's copy starts from the *published* version they read,
          // never the live draft. The snapshot's encoded state keeps Yjs lineage, so accepting works as usual.
          const input = JSON.parse(body || '{}') as {
            targetDocumentId: string
            workId: string
            fromWorkId?: string
          }
          const [snapRow] = await db
            .select({ state: documentSnapshots.state, workId: documentSnapshots.workId })
            .from(documentSnapshots)
            .where(eq(documentSnapshots.id, fromSnapshot[1]!))
          // Copies stay within a work, with one exception: a public-domain classic may be copied into someone's
          // retelling (P-063). Checked here too, not only by the API.
          let allowed = !!snapRow && snapRow.workId === input.workId
          if (snapRow && !allowed && input.fromWorkId === snapRow.workId) {
            const [src] = await db
              .select({ source: works.source })
              .from(works)
              .where(eq(works.id, snapRow.workId))
            allowed = (src?.source as { kind?: string } | null)?.kind === 'public_domain'
          }
          if (!snapRow || !allowed) return json(response, 404, { error: 'snapshot_not_found' })
          const stored = await store.store(input.targetDocumentId, input.workId, snapRow.state)
          const copy = docFromState(stored.state)
          await store.writeProjection(input.targetDocumentId, input.workId, copy, stored.revision)
          copy.destroy()
          return json(response, 200, { ok: true })
        }

        const restore = /^\/internal\/documents\/([0-9a-f-]{36})\/restore$/.exec(url.pathname)
        if (restore && request.method === 'POST') {
          const input = JSON.parse(body || '{}') as { snapshotId: string; workId: string; createdBy: string }
          const [target] = await db
            .select({ contentJson: documentSnapshots.contentJson })
            .from(documentSnapshots)
            .where(
              and(eq(documentSnapshots.id, input.snapshotId), eq(documentSnapshots.documentId, restore[1]!)),
            )
          if (!target) return json(response, 404, { error: 'snapshot_not_found' })
          const conn = await instance.openDirectConnection(restore[1]!, {
            userId: input.createdBy,
            workId: input.workId,
            readOnly: false,
          })
          try {
            // Keep what is being replaced: a restore can itself be undone.
            const before = await store.snapshot(restore[1]!, input.workId, conn.document!, 'pre_restore', {
              createdBy: input.createdBy,
              label: null,
            })
            await conn.transact((doc) =>
              replaceDocumentContent(doc, target.contentJson as PMNode, 'morrow:restore'),
            )
            if (before)
              send(conn.document!, {
                v: 1,
                type: 'snapshot_created',
                snapshotId: before.id,
                reason: 'manual',
              })
            return json(response, 200, { preRestoreSnapshotId: before?.id ?? null })
          } finally {
            await conn.disconnect()
          }
        }

        const snap = /^\/internal\/documents\/([0-9a-f-]{36})\/snapshots$/.exec(url.pathname)
        if (snap && request.method === 'POST') {
          const input = JSON.parse(body || '{}') as {
            workId: string
            label?: string | null
            createdBy?: string | null
            reason?: 'manual' | 'publish'
          }
          const reason = input.reason === 'publish' ? 'publish' : 'manual'
          const conn = await instance.openDirectConnection(snap[1]!, {
            userId: input.createdBy ?? 'system',
            workId: input.workId,
            readOnly: false,
          })
          try {
            const row = await store.snapshot(snap[1]!, input.workId, conn.document!, reason, input)
            if (row) send(conn.document!, { v: 1, type: 'snapshot_created', snapshotId: row.id, reason })
            return json(
              response,
              201,
              row && {
                id: row.id,
                documentId: row.documentId,
                reason: row.reason,
                label: row.label,
                wordCount: row.wordCount,
                createdBy: row.createdBy,
                createdAt: row.createdAt.toISOString(),
              },
            )
          } finally {
            await conn.disconnect()
          }
        }
        return json(response, 404, { error: 'not_found' })
      } catch (err) {
        if (err === null) throw err
        log.error({ ev: 'request_failed', err: String(err) })
        if (!response.headersSent) json(response, 500, { error: 'internal' })
        else handled()
      }
    },
  })

  await server.listen()
  log.info({ ev: 'listening', port: server.address.port })
  return server
}

/** UniqueID only de-duplicates on real paste/drop; any other path can duplicate ids (spike S2). */
function repairDuplicateIds(document: Y.Doc, ids: string[], log: Logger, documentName: string) {
  const seen = new Set<string>()
  document.transact(() => {
    for (const node of document.getXmlFragment(CONTENT_FIELD).toArray()) {
      if (!(node instanceof Y.XmlElement)) continue
      const id = node.getAttribute('id')
      if (typeof id !== 'string' || !ids.includes(id)) continue
      if (seen.has(id)) node.setAttribute('id', randomUUID())
      seen.add(id)
    }
  }, 'morrow:repair-ids')
  log.warn({ ev: 'repaired_duplicate_block_ids', doc: documentName, count: ids.length })
}

function header(req: IncomingMessage, name: string): string | undefined {
  const v = req.headers[name]
  return Array.isArray(v) ? v[0] : v
}

function readBody(req: IncomingMessage, limit = 64 * 1024): Promise<string> {
  return new Promise((resolve, reject) => {
    let size = 0
    const chunks: Buffer[] = []
    req.on('data', (c: Buffer) => {
      size += c.length
      if (size > limit) {
        reject(new Error('body too large'))
        req.destroy()
      } else chunks.push(c)
    })
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    req.on('error', reject)
  })
}

function json(res: ServerResponse, status: number, body: unknown): never {
  res.writeHead(status, { 'content-type': 'application/json' })
  res.end(JSON.stringify(body))
  return handled()
}

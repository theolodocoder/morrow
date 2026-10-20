'use client'
import { useEffect, useMemo, useRef, useState } from 'react'
import * as Y from 'yjs'
import { HocuspocusProvider } from '@hocuspocus/provider'
import { CollabEvent, type CollabTicket } from '@morrow/contracts'
import { SCHEMA_VERSION } from '@morrow/editor'
import { api, ClientApiError } from '@/lib/client-api'
import type { PresenceUser } from '@/lib/presence'

/** What the writer needs to know about the safety of their words (design system §11). */
export type CollabStatus =
  | 'connecting'
  | 'saved'
  | 'saving'
  | 'offline'
  | 'reconnecting'
  | 'degraded'
  | 'read-only'
  | 'denied'
  | 'reload-required'

export interface Collab {
  doc: Y.Doc
  provider: HocuspocusProvider
  status: CollabStatus
  synced: boolean
  readOnly: boolean
  onSnapshot: (cb: () => void) => () => void
  /** someone added or changed comments or reactions on this document (FR-016/017) */
  onFeedback: (cb: (what: 'comments' | 'reactions') => void) => () => void
}

/** Shows "Saving…" only when saving takes longer than this, so typing never causes flicker. */
const SAVING_DELAY_MS = 1000

export function useCollab(documentId: string, collabUrl: string, me: PresenceUser): Collab | null {
  const [collab, setCollab] = useState<Omit<Collab, 'status' | 'synced' | 'readOnly'> | null>(null)
  const [status, setStatus] = useState<CollabStatus>('connecting')
  const [synced, setSynced] = useState(false)
  const [readOnly, setReadOnly] = useState(false)
  const snapshotListeners = useRef(new Set<() => void>())
  const feedbackListeners = useRef(new Set<(what: 'comments' | 'reactions') => void>())
  // Bumped when the server says our access changed: the effect rebuilds the connection with a fresh ticket.
  const [generation, setGeneration] = useState(0)

  useEffect(() => {
    const doc = new Y.Doc()
    let mode: CollabTicket['mode'] = 'edit'
    let degraded = false,
      terminal = false
    let savingTimer: ReturnType<typeof setTimeout> | undefined
    const settle = (s: CollabStatus) => {
      if (!terminal) setStatus(degraded && (s === 'saved' || s === 'saving') ? 'degraded' : s)
    }

    const provider = new HocuspocusProvider({
      url: collabUrl,
      name: documentId,
      document: doc,
      // Called on every (re)connect: a fresh 60-second ticket each time (architecture §8).
      token: async () => {
        try {
          const t = await api<CollabTicket>('/collab/tickets', { method: 'POST', body: { documentId } })
          mode = t.mode
          return JSON.stringify({ ticket: t.ticket, schemaVersion: SCHEMA_VERSION })
        } catch (err) {
          // No ticket means no access any more (removed, or the work was deleted).
          if (err instanceof ClientApiError && (err.status === 404 || err.status === 401)) {
            terminal = true
            setStatus('denied')
            provider.disconnect()
          }
          throw err
        }
      },
      onStatus: ({ status: s }) => {
        if (s === 'disconnected') settle(navigator.onLine ? 'reconnecting' : 'offline')
      },
      onSynced: ({ state }) => {
        if (!state) return
        setSynced(true)
        setReadOnly(mode === 'read')
        settle(mode === 'read' ? 'read-only' : 'saved')
      },
      onUnsyncedChanges: ({ number }) => {
        clearTimeout(savingTimer)
        if (mode === 'read') return
        if (number === 0) settle('saved')
        else savingTimer = setTimeout(() => settle('saving'), SAVING_DELAY_MS)
      },
      onAuthenticationFailed: ({ reason }) => {
        terminal = true
        setStatus(reason.startsWith('reload_required') ? 'reload-required' : 'denied')
        provider.disconnect()
      },
      onStateless: ({ payload }) => {
        const event = CollabEvent.safeParse(JSON.parse(payload))
        if (!event.success) return
        if (event.data.type === 'save_degraded') {
          degraded = true
          settle('degraded')
        }
        if (event.data.type === 'save_recovered') {
          degraded = false
          settle('saved')
        }
        if (event.data.type === 'snapshot_created') snapshotListeners.current.forEach((cb) => cb())
        if (event.data.type === 'feedback_changed') {
          const what = event.data.what
          feedbackListeners.current.forEach((cb) => cb(what))
        }
        if (event.data.type === 'access_changed') {
          if (event.data.mode === 'none') {
            terminal = true
            setStatus('denied')
            provider.disconnect()
          } else setGeneration((g) => g + 1) // reconnect: the new ticket carries the new role
        }
      },
    })
    // Shared with collaborators through awareness: never persisted, never logged (architecture §8).
    provider.setAwarenessField('user', { id: me.id, name: me.name, color: me.color })
    const offline = () => settle('offline'),
      online = () => settle('reconnecting')
    window.addEventListener('offline', offline)
    window.addEventListener('online', online)
    setCollab({
      doc,
      provider,
      onSnapshot: (cb) => {
        snapshotListeners.current.add(cb)
        return () => snapshotListeners.current.delete(cb)
      },
      onFeedback: (cb) => {
        feedbackListeners.current.add(cb)
        return () => feedbackListeners.current.delete(cb)
      },
    })

    return () => {
      clearTimeout(savingTimer)
      window.removeEventListener('offline', offline)
      window.removeEventListener('online', online)
      provider.destroy()
      doc.destroy()
      setCollab(null)
      setSynced(false)
      setStatus('connecting')
    }
  }, [documentId, collabUrl, generation, me.id, me.name, me.color])

  // Stable identity between renders that change nothing, so effects depending on it don't re-run (and refetch).
  return useMemo(
    () => (collab ? { ...collab, status, synced, readOnly } : null),
    [collab, status, synced, readOnly],
  )
}

'use client'
import { useEffect, useMemo, useRef, useState } from 'react'
import * as Y from 'yjs'
import { HocuspocusProvider } from '@hocuspocus/provider'
import { IndexeddbPersistence } from 'y-indexeddb'
import { CollabEvent, type CollabTicket } from '@morrow/contracts'
import { SCHEMA_VERSION } from '@morrow/editor'
import { api, ClientApiError } from '@/lib/client-api'
import {
  deleteDeviceCopy,
  deviceCopyName,
  deviceStorageWorks,
  isPendingWriting,
  rememberDeviceCopy,
  setPendingWriting,
} from '@/lib/device-copies'
import type { PresenceUser } from '@/lib/presence'

/** What the writer needs to know about the safety of their words (design system §11). */
export type CollabStatus =
  | 'connecting'
  | 'saved'
  | 'saving'
  /** offline (or disconnected) with changes the server hasn't got yet, kept safely on this device */
  | 'on-device'
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
  /** the chapter's voice room (P-064): messages to and from collab over this same connection */
  voice: {
    send: (message: object) => void
    /** hears every voice message; replays the latest roster straight away */
    on: (cb: (message: VoiceMessage) => void) => () => void
  }
}

/** What collab sends about the voice room (see apps/collab/src/voice.ts). */
export type VoiceMessage =
  | {
      v: 1
      type: 'voice'
      op: 'roster'
      you: string | null
      peers: { peerId: string; userId: string; muted: boolean }[]
    }
  | { v: 1; type: 'voice'; op: 'full'; max: number }
  | { v: 1; type: 'voice'; op: 'signal'; from: string; fromUserId: string; data: unknown }

/** Shows "Saving…" only when saving takes longer than this, so typing never causes flicker. */
const SAVING_DELAY_MS = 1000
/** A slow or broken IndexedDB must never keep the writer from their chapter. */
const DEVICE_LOAD_MAX_MS = 1500

export function useCollab(documentId: string, collabUrl: string, me: PresenceUser): Collab | null {
  const [collab, setCollab] = useState<Omit<Collab, 'status' | 'synced' | 'readOnly'> | null>(null)
  const [status, setStatus] = useState<CollabStatus>('connecting')
  const [synced, setSynced] = useState(false)
  const [readOnly, setReadOnly] = useState(false)
  const snapshotListeners = useRef(new Set<() => void>())
  const feedbackListeners = useRef(new Set<(what: 'comments' | 'reactions') => void>())
  const voiceListeners = useRef(new Set<(m: VoiceMessage) => void>())
  const lastRoster = useRef<VoiceMessage | null>(null)
  // Bumped when the server says our access changed: the effect rebuilds the connection with a fresh ticket.
  const [generation, setGeneration] = useState(0)

  useEffect(() => {
    const doc = new Y.Doc()
    let mode: CollabTicket['mode'] = 'edit'
    let degraded = false,
      terminal = false,
      cancelled = false,
      // the facts the label is made from
      socketUp = false,
      serverSynced = false,
      unsynced = 0,
      onDevice = false, // this document's IndexedDB store is open and takes every change
      // the device copy holds changes the server hasn't confirmed (kept across tabs and visits, for sign-out)
      pending = isPendingWriting(me.id, documentId)
    let savingTimer: ReturnType<typeof setTimeout> | undefined
    let live: HocuspocusProvider | null = null
    const settle = (s: CollabStatus) => {
      if (!terminal) setStatus(degraded && (s === 'saved' || s === 'saving') ? 'degraded' : s)
    }
    const markPending = (p: boolean) => {
      if (p === pending) return
      pending = p
      setPendingWriting(me.id, documentId, p)
    }
    // One place turns the facts into the label, so no single event can leave a stale one behind.
    const refresh = () => {
      clearTimeout(savingTimer)
      // Only the server's confirmation after a sync clears it: every unsent change has been applied there.
      if (mode !== 'read' && serverSynced && unsynced === 0) markPending(false)
      if (!navigator.onLine || !socketUp) {
        if (mode !== 'read' && (unsynced > 0 || pending) && onDevice) settle('on-device')
        else settle(navigator.onLine ? 'reconnecting' : 'offline')
      } else if (mode === 'read') {
        if (serverSynced) settle('read-only')
      } else if (serverSynced && unsynced === 0) settle('saved')
      // (Re)syncing words the server hasn't got yet: say so straight away, never "Saved" until it confirms.
      else if (!serverSynced && pending) settle('saving')
      else if (unsynced > 0) savingTimer = setTimeout(() => settle('saving'), SAVING_DELAY_MS)
    }
    window.addEventListener('offline', refresh)
    window.addEventListener('online', refresh)
    // Without a device copy, unsent words live only in this tab: ask before it closes.
    const leaving = (e: BeforeUnloadEvent) => {
      if (!onDevice && unsynced > 0 && mode !== 'read') e.preventDefault()
    }
    window.addEventListener('beforeunload', leaving)

    // Words written offline are kept on the device until the server has them, so closing the tab can't lose them.
    // Never cleared here on errors or "denied": sign-out clears it, and a view-only session drops it.
    const name = deviceCopyName(me.id, documentId)
    let local: IndexeddbPersistence | null = null
    const openDeviceCopy = async () => {
      // Without IndexedDB editing works as before, minus the device copy (and the tab asks before closing).
      if (!(await deviceStorageWorks()) || cancelled || mode === 'read') return
      let copy: IndexeddbPersistence
      try {
        copy = local = new IndexeddbPersistence(name, doc)
      } catch {
        return
      }
      rememberDeviceCopy(name)
      await copy._db.then(
        (db) => {
          if (local !== copy) return // dropped while opening (a view-only session, or unmounted): already closing
          onDevice = true
          // Another tab deleting the store (sign-out) closes it: stop writing to it instead of failing every edit.
          db.onversionchange = () => dropDeviceCopy(false)
        },
        () => {},
      )
      if (onDevice) await copy.whenSynced
    }
    const dropDeviceCopy = (remove: boolean) => {
      const l = local
      local = null
      onDevice = false
      void Promise.resolve(l?.destroy())
        .catch(() => {})
        .then(() => (remove ? deleteDeviceCopy(name) : undefined))
    }
    // Your own edits mark the copy pending; the server's updates and the copy's own reload (before connecting) don't.
    const onUpdate = (_: Uint8Array, origin: unknown) => {
      if (origin === live || (origin === local && !live) || mode === 'read' || !onDevice) return
      markPending(true)
    }
    doc.on('update', onUpdate)
    // Load the device copy first, so unsent words are part of the first sync with the server.
    const loaded = Promise.race([
      openDeviceCopy(),
      new Promise((resolve) => setTimeout(resolve, DEVICE_LOAD_MAX_MS)),
    ])

    void loaded.then(() => {
      if (cancelled) return
      const provider = (live = new HocuspocusProvider({
        url: collabUrl,
        name: documentId,
        document: doc,
        // Called on every (re)connect: a fresh 60-second ticket each time (architecture §8).
        token: async () => {
          try {
            const t = await api<CollabTicket>('/collab/tickets', { method: 'POST', body: { documentId } })
            mode = t.mode
            // A viewer can't have unsent edits: keep nothing on the device (unless it still holds earlier ones).
            if (mode === 'read') dropDeviceCopy(!pending)
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
          socketUp = s === 'connected'
          if (s !== 'connecting') refresh()
        },
        onSynced: ({ state }) => {
          serverSynced = state
          if (!state) return
          setSynced(true)
          setReadOnly(mode === 'read')
          refresh()
        },
        onUnsyncedChanges: ({ number }) => {
          unsynced = number
          refresh()
        },
        onAuthenticationFailed: ({ reason }) => {
          terminal = true
          setStatus(reason.startsWith('reload_required') ? 'reload-required' : 'denied')
          provider.disconnect()
        },
        onStateless: ({ payload }) => {
          const raw = JSON.parse(payload) as { type?: string; op?: string }
          if (raw.type === 'voice') {
            if (raw.op === 'roster') lastRoster.current = raw as VoiceMessage
            voiceListeners.current.forEach((cb) => cb(raw as VoiceMessage))
            return
          }
          const event = CollabEvent.safeParse(raw)
          if (!event.success) return
          if (event.data.type === 'save_degraded') {
            degraded = true
            settle('degraded')
          }
          if (event.data.type === 'save_recovered') {
            degraded = false
            refresh()
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
      }))
      // Shared with collaborators through awareness: never persisted, never logged (architecture §8).
      provider.setAwarenessField('user', { id: me.id, name: me.name, color: me.color })
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
        voice: {
          send: (message) => provider.sendStateless(JSON.stringify({ v: 1, type: 'voice', ...message })),
          on: (cb) => {
            voiceListeners.current.add(cb)
            if (lastRoster.current) cb(lastRoster.current)
            return () => voiceListeners.current.delete(cb)
          },
        },
      })
    })

    return () => {
      cancelled = true
      clearTimeout(savingTimer)
      window.removeEventListener('offline', refresh)
      window.removeEventListener('online', refresh)
      window.removeEventListener('beforeunload', leaving)
      live?.destroy()
      doc.off('update', onUpdate)
      dropDeviceCopy(false)
      doc.destroy()
      setCollab(null)
      lastRoster.current = null
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

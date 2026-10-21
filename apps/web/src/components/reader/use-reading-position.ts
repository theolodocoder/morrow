'use client'
import { useEffect } from 'react'
import type { ReadingPositions } from '@morrow/contracts'
import { aheadOf, mergePositions, type Position } from '@morrow/domain'

/** What this device remembers for one work: each chapter's furthest point and the chapter read last. */
type Saved = { last: string | null; items: Position[] }

const key = (publicPath: string) => `morrow:pos:${publicPath}`
const url = (publicPath: string) => `/api/v1/me/reading/${encodeURIComponent(publicPath)}/positions`
const SERVER_EVERY_MS = 5000
/** the API takes 50 a save; one place is kept for the chapter being read */
const MERGE_LIMIT = 49

/** The device's saved positions; anything unreadable counts as nothing saved (storage is only a convenience). */
function readLocal(publicPath: string): Saved {
  try {
    const raw = localStorage.getItem(key(publicPath))
    if (raw) {
      const v = JSON.parse(raw) as Partial<Saved> | null
      const items = Array.isArray(v?.items) ? (v?.items ?? []) : []
      // no chapter list here, so nothing is dropped as stale; malformed entries are, by the merge
      const slugs = items
        .map((p) => (p as Partial<Position> | null)?.chapterSlug)
        .filter((s) => typeof s === 'string')
      return { last: typeof v?.last === 'string' ? v.last : null, items: mergePositions(items, [], slugs) }
    }
    // before paragraphs were remembered, only the last chapter was
    return { last: localStorage.getItem(`morrow:reading:${publicPath}`), items: [] }
  } catch {
    return { last: null, items: [] }
  }
}

function writeLocal(publicPath: string, saved: Saved) {
  try {
    localStorage.setItem(key(publicPath), JSON.stringify(saved))
    localStorage.removeItem(`morrow:reading:${publicPath}`)
  } catch {
    /* storage full or blocked: the account (if any) still has it */
  }
}

/** The account's positions, or null when signed out (401) or unreachable: then the device's are all there is. */
async function fetchServer(publicPath: string): Promise<ReadingPositions | null> {
  try {
    const res = await fetch(url(publicPath), { credentials: 'same-origin' })
    return res.ok ? ((await res.json()) as ReadingPositions) : null
  } catch {
    return null
  }
}

/** Whether the account took the save; a failure (rate limit, outage, offline) is retried on the next flush. */
function sendServer(publicPath: string, items: Position[]): Promise<boolean> {
  // keepalive lets the last save outlive the page; same-origin, so the session cookie goes with it
  return fetch(url(publicPath), {
    method: 'PUT',
    credentials: 'same-origin',
    keepalive: true,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ items }),
  }).then(
    (res) => res.ok,
    () => false,
  )
}

/**
 * Read-only, for the work's front page: how far this reader got in each chapter and the one to continue. The account's
 * (merged with this device's) when signed in, this device's otherwise. `liveSlugs` are every chapter readers can open,
 * versions' included; positions for anything else are dropped, here and from the device.
 */
export async function loadReadingPositions(
  publicPath: string,
  liveSlugs: string[],
): Promise<{ items: Position[]; last: string | null }> {
  const local = readLocal(publicPath)
  const server = await fetchServer(publicPath)
  const items = mergePositions(local.items, server?.items ?? [], liveSlugs)
  const last = [server?.last, local.last].find((s): s is string => !!s && liveSlugs.includes(s)) ?? null
  // prune the device's stale entries, without leaving an empty record for every work page visited
  if (local.items.length || local.last) writeLocal(publicPath, { last, items })
  return { items, last }
}

/**
 * Remembers where the reader is in this chapter, to the paragraph (spec "Resume"): the top-most paragraph on screen
 * and how far through the text they are, furthest point kept. Saved on the device at once and, when signed in, to
 * the account every few seconds and as the page goes. Opening a chapter part-read returns to that paragraph.
 */
export function useReadingPosition(publicPath: string, chapterSlug: string, liveSlugs: string[]) {
  // a stable dependency: the page hands over a new array each render
  const live = liveSlugs.join(' ')
  useEffect(() => {
    const liveList = live.split(' ')
    const body = document.querySelector<HTMLElement>('.reading-body')
    const blocks = [...document.querySelectorAll<HTMLElement>('.reading-body [data-block]')]
    const local = readLocal(publicPath)
    // where an earlier visit got to (kept apart from `here`, which this visit moves on from the top of the page)
    let resume = local.items.find((p) => p.chapterSlug === chapterSlug)
    let here: Position = resume ?? { chapterSlug, blockId: null, percent: 0 }
    // the device's points the account hasn't got yet, sent with the first save after signing in
    let pending: Position[] = []
    let signedIn = false
    let dirty = false
    let readerMoved = false
    let alive = true

    const saveLocal = () => {
      const items = readLocal(publicPath).items.filter((p) => p.chapterSlug !== chapterSlug)
      writeLocal(publicPath, { last: chapterSlug, items: [...items, here] })
    }
    // Cleared only once the account has the save, so a failed one goes again with the next flush (every few
    // seconds at most, never in a loop). Saves are idempotent, so one sent twice does no harm.
    const flush = () => {
      if (!signedIn || !dirty) return
      const sent = { here, pending }
      void sendServer(publicPath, [...pending, here]).then((ok) => {
        if (!ok) return
        if (pending === sent.pending) pending = []
        if (here === sent.here) dirty = false
      })
    }
    const hidden = () => document.visibilityState === 'hidden' && flush()

    const percent = () => {
      if (!body) return 100
      // 100 when the text's end reaches the bottom of the screen, not the discussion below it
      const end = body.getBoundingClientRect().bottom + window.scrollY - window.innerHeight
      return end > 0 ? Math.round(Math.min(1, Math.max(0, window.scrollY / end)) * 100) : 100
    }
    const visible = new Set<Element>()
    const record = () => {
      const top = blocks.find((b) => visible.has(b))
      const p = percent()
      if (p < here.percent || (p === here.percent && (top?.dataset.block ?? null) === here.blockId)) return
      here = { chapterSlug, blockId: top?.dataset.block ?? here.blockId, percent: p }
      dirty = true
      saveLocal()
    }
    const io = new IntersectionObserver((entries) => {
      for (const e of entries) visible[e.isIntersecting ? 'add' : 'delete'](e.target)
      record()
    })
    blocks.forEach((b) => io.observe(b))
    window.addEventListener('scroll', record, { passive: true })
    saveLocal()

    // Restore only if the reader hasn't started moving (or followed a link to a spot) by the time we know where to go.
    const moved = () => (readerMoved = true)
    const intents = ['wheel', 'touchmove', 'keydown', 'pointerdown'] as const
    intents.forEach((t) => window.addEventListener(t, moved, { passive: true, once: true }))
    void fetchServer(publicPath).then((server) => {
      if (!alive) return
      if (server) {
        signedIn = true
        const mine = server.items.find((p) => p.chapterSlug === chapterSlug)
        if (mine && mine.percent > (resume?.percent ?? -1)) resume = mine
        if (mine && mine.percent > here.percent) here = mine
        // the account keeps the furthest of each, so sending what this device has is the whole merge
        pending = aheadOf(
          local.items.filter((p) => p.chapterSlug !== chapterSlug),
          server.items,
          liveList,
          MERGE_LIMIT,
        )
        writeLocal(publicPath, {
          last: chapterSlug,
          items: mergePositions(local.items, [...server.items, here], liveList),
        })
        dirty = true
        flush()
      }
      // only part-read chapters: a finished one (or one barely opened) starts again from its title
      const target =
        resume?.blockId && resume.percent > 0 && resume.percent < 100
          ? document.querySelector(`[data-block="${CSS.escape(resume.blockId)}"]`)
          : null
      if (!target || readerMoved || window.scrollY > 0 || location.hash) return
      const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
      target.scrollIntoView({ block: 'start', behavior: reduce ? 'instant' : 'smooth' })
    })

    const timer = window.setInterval(flush, SERVER_EVERY_MS)
    window.addEventListener('pagehide', flush)
    // a phone often never fires pagehide: the tab is hidden, then discarded
    document.addEventListener('visibilitychange', hidden)
    return () => {
      alive = false
      flush() // leaving for another chapter in the app fires no pagehide
      window.clearInterval(timer)
      window.removeEventListener('pagehide', flush)
      document.removeEventListener('visibilitychange', hidden)
      window.removeEventListener('scroll', record)
      intents.forEach((t) => window.removeEventListener(t, moved))
      io.disconnect()
    }
  }, [publicPath, chapterSlug, live])
}

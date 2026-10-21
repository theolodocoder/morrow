'use client'
import { useEffect, useState } from 'react'
import Link from 'next/link'
import { continueFrom } from '@morrow/domain'
import { routes } from '@/lib/routes'
import { loadReadingPositions, useReadingPosition } from './use-reading-position'

/** A hairline that fills as the reader moves through the chapter; remembers the paragraph for "continue reading". */
export function ReadingProgress({
  publicPath,
  chapterSlug,
  liveSlugs,
}: {
  publicPath: string
  chapterSlug: string
  /** every chapter readers can open, versions' included: saved places for anything else are stale */
  liveSlugs: string[]
}) {
  const [progress, setProgress] = useState(0)
  useReadingPosition(publicPath, chapterSlug, liveSlugs)
  useEffect(() => {
    const onScroll = () => {
      const max = document.documentElement.scrollHeight - window.innerHeight
      setProgress(max > 0 ? Math.min(1, window.scrollY / max) : 1)
    }
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    window.addEventListener('resize', onScroll)
    return () => {
      window.removeEventListener('scroll', onScroll)
      window.removeEventListener('resize', onScroll)
    }
  }, [publicPath, chapterSlug])
  return (
    <div aria-hidden="true" className="fixed inset-x-0 top-0 z-40 h-0.5 bg-transparent">
      <div className="h-full origin-left bg-action" style={{ transform: `scaleX(${progress})` }} />
    </div>
  )
}

type WorkProgress = Awaited<ReturnType<typeof loadReadingPositions>>
/** the button and the contents mount together: one request serves both */
const loading = new Map<string, Promise<WorkProgress>>()

/** On the work page: this reader's place in each chapter, once known (null while loading, and on the server). */
export function useWorkProgress(publicPath: string, liveSlugs: string[]): WorkProgress | null {
  const [progress, setProgress] = useState<WorkProgress | null>(null)
  // a stable dependency: the page hands over a new array each render
  const live = liveSlugs.join(' ')
  useEffect(() => {
    let alive = true
    let p = loading.get(publicPath)
    if (!p) {
      p = loadReadingPositions(publicPath, live.split(' ')).finally(() => loading.delete(publicPath))
      loading.set(publicPath, p)
    }
    void p.then((r) => alive && setProgress(r))
    return () => {
      alive = false
    }
  }, [publicPath, live])
  return progress
}

type Summary = { slug: string; title: string }
type Version = { chapters: Summary[] }
/** every chapter readers can open: positions anywhere else are stale */
export const liveSlugsOf = (chapters: Summary[], versions: Version[]) =>
  [...chapters, ...versions.flatMap((v) => v.chapters)].map((c) => c.slug)
/** main's chapters, then each version's own, for Continue to follow the path the reader was on */
export const runsOf = (chapters: Summary[], versions: Version[]) => [
  chapters,
  ...versions.map((v) => v.chapters),
]

/**
 * The work page's one big button: Start reading, or Continue to the chapter read last (its paragraph comes back on
 * opening). Signed-out readers learn their place is kept on this device only.
 */
export function StartReading({
  publicPath,
  chapters,
  versions,
}: {
  publicPath: string
  chapters: Summary[]
  versions: Version[]
}) {
  const progress = useWorkProgress(publicPath, liveSlugsOf(chapters, versions))
  const at = progress && continueFrom(runsOf(chapters, versions), progress.items, progress.last)
  const target = at?.chapter ?? chapters[0]
  if (!target) return null
  return (
    <div className="flex flex-col gap-2.5">
      <Link
        href={routes.readChapter(publicPath, target.slug)}
        className="press flex min-h-12 w-full items-center justify-center rounded-full bg-action px-6 py-2.5 text-center font-ui text-[15px] font-semibold text-action-fg transition-colors hover:bg-action-hover sm:w-auto sm:self-start"
      >
        {at ? `Continue · ${at.chapter.title} · ${at.percent}%` : 'Start reading'}
      </Link>
      {progress?.signedIn !== true && (
        // Kept in the layout until the answer comes, so the page below doesn't jump for most first-time readers.
        <p
          className={`text-center font-ui text-[13px] text-secondary sm:text-left ${progress ? '' : 'invisible'}`}
        >
          Read without an account.{' '}
          <Link
            href={`/sign-in?next=${encodeURIComponent(routes.publicWork(publicPath))}`}
            className="rounded-sm text-primary underline underline-offset-2"
          >
            Sign in
          </Link>{' '}
          to keep your place on every device.
        </p>
      )}
    </div>
  )
}

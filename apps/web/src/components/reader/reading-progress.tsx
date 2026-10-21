'use client'
import { useEffect, useState } from 'react'
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

/** On the work page: a link back to where this reader left off, if they have started. */
export function ContinueReading({
  publicPath,
  chapters,
}: {
  publicPath: string
  chapters: { slug: string; title: string }[]
}) {
  const [last, setLast] = useState<{ slug: string; title: string } | null>(null)
  useEffect(() => {
    let alive = true
    void loadReadingPositions(
      publicPath,
      chapters.map((c) => c.slug),
    ).then(({ last }) => alive && setLast(chapters.find((c) => c.slug === last) ?? null))
    return () => {
      alive = false
    }
  }, [publicPath, chapters])
  if (!last) return null
  return (
    <a
      href={`/works/${publicPath}/read/${last.slug}`}
      className="inline-flex h-10 items-center rounded-full border border-control px-4 text-sm text-primary hover:bg-hover"
    >
      Continue: {last.title}
    </a>
  )
}

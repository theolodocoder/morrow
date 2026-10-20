'use client'
import { useCallback, useEffect, useRef, useState } from 'react'
import type { Feed, FeedItem } from '@morrow/contracts'
import { Button } from '@/components/ui/button'
import { api } from '@/lib/client-api'
import { FeedPost } from './feed-post'
import { SignupPrompt } from './signup-wall'
import { SkeletonPost } from '@/components/ui/skeleton'

/**
 * The scrolling feed: more loads as you near the end. Everyone can scroll and read as far as they like (P-049);
 * signing up is only asked for when a visitor wants to take part (like, comment, follow, contribute).
 */
export function FeedList({
  initial,
  query,
  empty,
}: {
  initial: Feed
  query: string
  empty: React.ReactNode
}) {
  const [items, setItems] = useState<FeedItem[]>(initial.items)
  const [cursor, setCursor] = useState(initial.nextCursor)
  const [loading, setLoading] = useState(false)
  const [failed, setFailed] = useState(false)
  const [prompt, setPrompt] = useState<string | null>(null)
  const sentinel = useRef<HTMLDivElement>(null)

  // A new filter or sort: start over from what the server rendered.
  useEffect(() => {
    setItems(initial.items)
    setCursor(initial.nextCursor)
  }, [initial])

  const more = useCallback(async () => {
    if (!cursor || loading) return
    setLoading(true)
    setFailed(false)
    try {
      const page = await api<Feed>(
        `/public/feed?${query}${query ? '&' : ''}cursor=${encodeURIComponent(cursor)}`,
      )
      setItems((xs) => {
        const known = new Set(xs.map((x) => x.publicPath))
        return [...xs, ...page.items.filter((x) => !known.has(x.publicPath))]
      })
      setCursor(page.nextCursor)
    } catch {
      setFailed(true)
    } finally {
      setLoading(false)
    }
  }, [cursor, loading, query])

  // Load the next page before the reader reaches the end.
  useEffect(() => {
    const el = sentinel.current
    if (!el) return
    const io = new IntersectionObserver((es) => es.some((e) => e.isIntersecting) && void more(), {
      rootMargin: '600px 0px',
    })
    io.observe(el)
    return () => io.disconnect()
  }, [more])

  if (!items.length) return <>{empty}</>
  return (
    <>
      <div aria-busy={loading} className="flex flex-col">
        {items.map((item) => (
          <FeedPost key={item.publicPath} item={item} onNeedAccount={setPrompt} />
        ))}
      </div>
      <div ref={sentinel} aria-hidden="true" className="h-px" />
      {loading && (
        <>
          <SkeletonPost />
          <SkeletonPost />
        </>
      )}
      <div className="flex justify-center py-8 text-[13px] text-secondary" role="status">
        {loading ? (
          <span className="sr-only">Loading more…</span>
        ) : failed ? (
          <Button size="sm" onPress={() => void more()}>
            Couldn’t load more. Try again
          </Button>
        ) : cursor ? null : (
          'You’re all caught up.'
        )}
      </div>
      <SignupPrompt isOpen={prompt !== null} onClose={() => setPrompt(null)} action={prompt ?? ''} />
    </>
  )
}

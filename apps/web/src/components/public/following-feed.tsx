'use client'
import { useEffect, useState } from 'react'
import type { DiscoveryWork } from '@morrow/contracts'
import { api } from '@/lib/client-api'
import { WorkCard } from './work-card'

/** "From people you follow": only for signed-in readers who follow someone. Fetched in the browser (public page). */
export function FollowingFeed() {
  const [items, setItems] = useState<DiscoveryWork[]>([])
  useEffect(
    () =>
      void api<{ items: DiscoveryWork[] }>('/me/feed').then(
        (r) => setItems(r.items),
        () => {},
      ),
    [],
  )
  if (!items.length) return null
  return (
    <section aria-labelledby="following" className="flex flex-col gap-3">
      <h2 id="following" className="font-display text-[24px] text-primary">
        From people you follow
      </h2>
      <div className="shelf -mx-4 flex gap-5 overflow-x-auto px-4 pb-2">
        {items.map((w) => (
          <WorkCard key={w.publicPath} w={w} />
        ))}
      </div>
    </section>
  )
}

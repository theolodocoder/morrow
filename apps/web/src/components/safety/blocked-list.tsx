'use client'
import { useEffect, useState } from 'react'
import { EmptyState } from '@/components/brand/spots'
import { Avatar } from '@/components/profile/avatar'
import { Button } from '@/components/ui/button'
import { toast } from '@/components/ui/toast'
import { api } from '@/lib/client-api'

type Blocked = { username: string; displayName: string }

export function BlockedList() {
  const [items, setItems] = useState<Blocked[] | null>(null)
  const load = () => api<{ items: Blocked[] }>('/me/blocks').then((r) => setItems(r.items))
  useEffect(() => void load(), [])
  if (!items)
    return (
      <ul aria-hidden="true" className="flex flex-col gap-3 py-3">
        {[0, 1].map((i) => (
          <li key={i} className="flex items-center gap-3">
            <span className="skeleton size-9 rounded-full" />
            <span className="skeleton h-3.5 w-40 rounded-sm" />
          </li>
        ))}
      </ul>
    )
  if (!items.length)
    return (
      <EmptyState
        spot="together"
        title="You haven’t blocked anyone."
        body="Block someone from their profile’s ⋯ menu. They won’t be told."
      />
    )
  return (
    <ul className="divide-y divide-subtle border-y border-subtle">
      {items.map((b) => (
        <li key={b.username} className="flex items-center gap-3 py-3">
          <Avatar name={b.displayName} seed={b.username} size={36} />
          <span className="min-w-0 flex-1 truncate text-sm text-primary">
            {b.displayName} <span className="font-mono text-[12px] text-tertiary">@{b.username}</span>
          </span>
          <Button
            size="sm"
            variant="secondary"
            onPress={async () => {
              await api('/me/blocks', { method: 'DELETE', body: { username: b.username } })
              toast(`${b.displayName} is unblocked`)
              void load()
            }}
          >
            Unblock
          </Button>
        </li>
      ))}
    </ul>
  )
}

'use client'
import { useState } from 'react'
import { CheckIcon, PlusIcon } from '@/components/ui/icons'
import { api } from '@/lib/client-api'

/** Return a follow, right from the activity list. */
export function FollowBack({
  username,
  name,
  initial,
}: {
  username: string
  name: string
  initial: boolean
}) {
  const [on, setOn] = useState(initial)
  const [busy, setBusy] = useState(false)
  return (
    <button
      type="button"
      disabled={busy}
      aria-pressed={on}
      aria-label={on ? `Following ${name}` : `Follow ${name} back`}
      onClick={async () => {
        setBusy(true)
        try {
          await api('/me/follows', { method: on ? 'DELETE' : 'PUT', body: { type: 'author', username } })
          setOn(!on)
        } finally {
          setBusy(false)
        }
      }}
      className="inline-flex h-7 shrink-0 items-center gap-1 rounded-full border border-control px-2.5 text-[12px] text-primary outline-none hover:bg-hover focus-visible:ring-2 focus-visible:ring-focus aria-pressed:border-subtle aria-pressed:text-secondary disabled:opacity-50"
    >
      {on ? <CheckIcon size={14} /> : <PlusIcon size={14} />}
      {on ? 'Following' : 'Follow back'}
    </button>
  )
}

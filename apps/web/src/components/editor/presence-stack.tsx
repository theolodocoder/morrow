'use client'
import { useEffect, useState } from 'react'
import type { HocuspocusProvider } from '@hocuspocus/provider'
import { initials, type PresenceUser } from '@/lib/presence'

const MAX_SHOWN = 4

/** Who else is in this chapter right now (design system §11). Derived from awareness; nothing is stored. */
export function PresenceStack({ provider, me }: { provider: HocuspocusProvider; me: PresenceUser }) {
  const [others, setOthers] = useState<PresenceUser[]>([])

  useEffect(() => {
    const awareness = provider.awareness
    if (!awareness) return
    const update = () => {
      const seen = new Map<string, PresenceUser>()
      awareness.getStates().forEach((state, clientId) => {
        const u = (state as { user?: PresenceUser }).user
        if (!u?.id || clientId === awareness.clientID || u.id === me.id) return
        seen.set(u.id, u) // one entry per person, even with several tabs open
      })
      setOthers([...seen.values()])
    }
    update()
    awareness.on('change', update)
    return () => awareness.off('change', update)
  }, [provider, me.id])

  if (others.length === 0) return null
  const shown = others.slice(0, MAX_SHOWN)
  const names = others.map((o) => o.name).join(', ')
  return (
    <div
      className="flex items-center"
      role="group"
      aria-label={`Also here: ${names}`}
      title={`Also here: ${names}`}
    >
      {shown.map((u) => (
        <span
          key={u.id}
          className="-ml-1 grid size-7 place-items-center rounded-full border-2 bg-canvas text-[11px] font-semibold text-primary first:ml-0"
          style={{ borderColor: u.color }}
        >
          {initials(u.name)}
        </span>
      ))}
      {others.length > MAX_SHOWN && (
        <span className="ml-1 font-mono text-[11px] text-tertiary">+{others.length - MAX_SHOWN}</span>
      )}
      <span className="sr-only" aria-live="polite">
        {names} {others.length === 1 ? 'is' : 'are'} here
      </span>
    </div>
  )
}

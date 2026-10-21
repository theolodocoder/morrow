'use client'
import { useEffect, useState } from 'react'
import { Button as AriaButton, Dialog, DialogTrigger, Popover } from 'react-aria-components'
import type { HocuspocusProvider } from '@hocuspocus/provider'
import { AvatarConfig } from '@morrow/contracts'
import { Avatar } from '@/components/profile/avatar'
import type { PresenceUser } from '@/lib/presence'

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
        // Awareness is whatever a peer's client sent: draw only a well-formed face, else their initials.
        const avatar = AvatarConfig.safeParse(u.avatar)
        seen.set(u.id, {
          ...u,
          avatarSeed: typeof u.avatarSeed === 'string' ? u.avatarSeed : u.id,
          avatar: avatar.success ? avatar.data : null,
        }) // one entry per person, even with several tabs open
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
  const face = (u: PresenceUser, size: number) => (
    <Avatar name={u.name} seed={u.avatarSeed ?? u.id} avatar={u.avatar ?? null} size={size} />
  )
  return (
    <div className="flex items-center" role="group" aria-label={`Also here: ${names}`}>
      <DialogTrigger>
        <AriaButton
          aria-label={`Who's here: ${names}`}
          className="press flex items-center rounded-full p-0.5 outline-none hover:bg-hover data-[focus-visible]:ring-2 data-[focus-visible]:ring-focus"
        >
          {shown.map((u) => (
            <span
              key={u.id}
              className="-ml-1 grid size-7 place-items-center rounded-full border-2 bg-canvas first:ml-0"
              style={{ borderColor: u.color }}
            >
              {face(u, 24)}
            </span>
          ))}
          {others.length > MAX_SHOWN && (
            <span className="ml-1 font-mono text-[11px] text-tertiary">+{others.length - MAX_SHOWN}</span>
          )}
        </AriaButton>
        <Popover
          placement="bottom end"
          className="popover w-64 rounded-lg border border-subtle bg-raised p-2 shadow-[0_2px_4px_rgb(34_34_31/.06),0_12px_32px_rgb(34_34_31/.14)]"
        >
          <Dialog aria-label="People in this chapter" className="outline-none">
            <p className="px-2 pb-1 pt-1 font-mono text-[11px] uppercase tracking-[0.08em] text-tertiary">
              In this chapter now
            </p>
            <ul>
              {[{ ...me, you: true }, ...others.map((o) => ({ ...o, you: false }))].map((u) => (
                <li key={u.id} className="flex items-center gap-2.5 rounded-md px-2 py-1.5">
                  <span className="rounded-full border-2" style={{ borderColor: u.color }}>
                    {face(u, 28)}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-[14px] text-primary">
                    {u.name}
                    {u.you && <span className="text-tertiary"> (you)</span>}
                  </span>
                </li>
              ))}
            </ul>
          </Dialog>
        </Popover>
      </DialogTrigger>
      <span className="sr-only" aria-live="polite">
        {names} {others.length === 1 ? 'is' : 'are'} here
      </span>
    </div>
  )
}

'use client'
import { useEffect, useState } from 'react'
import { Button as AriaButton, Dialog, DialogTrigger, Popover } from 'react-aria-components'
import type { PresenceUser } from '@/lib/presence'
import { Button } from '@/components/ui/button'
import { HeadphonesIcon, MicIcon, MicOffIcon, PhoneOffIcon } from '@/components/ui/icons'
import type { Collab } from './use-collab'
import { useVoice } from './use-voice'

const isMac = () => typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform)

/**
 * Voice in the editor bar (P-064). The headphones show how many people are talking in this chapter; open them to
 * join (muted), unmute (or press ⌘/Ctrl+Shift+M), see who's speaking, and leave. Everyone on the chapter can see
 * who's in voice; only people who join hear anything.
 */
export function VoiceControl({ collab, me }: { collab: Collab; me: PresenceUser }) {
  const { peers, status, muted, join, leave, toggleMute } = useVoice(collab)
  const [people, setPeople] = useState<Map<string, PresenceUser>>(new Map())
  const joined = status === 'joined'

  // Names and colours come from presence (who's on the chapter); the room itself only knows user ids.
  useEffect(() => {
    const awareness = collab.provider.awareness
    if (!awareness) return
    const update = () => {
      const m = new Map<string, PresenceUser>()
      awareness.getStates().forEach((s) => {
        const u = (s as { user?: PresenceUser }).user
        if (u?.id) m.set(u.id, u)
      })
      setPeople(m)
    }
    update()
    awareness.on('change', update)
    return () => awareness.off('change', update)
  }, [collab.provider])

  useEffect(() => {
    if (!joined) return
    const on = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key.toLowerCase() === 'm') {
        e.preventDefault()
        toggleMute()
      }
    }
    window.addEventListener('keydown', on)
    return () => window.removeEventListener('keydown', on)
  }, [joined, toggleMute])

  const named = (userId: string) => (userId === me.id ? me : people.get(userId))
  const count = peers.length
  const label = joined
    ? `Voice: you’re in, ${muted ? 'muted' : 'speaking'}${count > 1 ? `, with ${count - 1} more` : ''}`
    : count
      ? `Voice: ${count} talking`
      : 'Voice'
  const shortcut = `${isMac() ? '⌘' : 'Ctrl'}+Shift+M`
  // Writing alone, there's no one to talk to: the button appears once someone else is on the chapter (or in voice).
  const others = [...people.keys()].filter((id) => id !== me.id).length
  if (!others && !count && status === 'idle') return null

  return (
    <DialogTrigger>
      <AriaButton
        aria-label={label}
        data-voice-status={status}
        className={`press relative grid size-9 place-items-center rounded-full outline-none data-[focus-visible]:ring-2 data-[focus-visible]:ring-focus ${joined ? 'bg-selected text-accent' : 'text-secondary hover:bg-hover hover:text-primary'}`}
      >
        {joined && !muted ? <MicIcon size={18} /> : <HeadphonesIcon size={18} />}
        {count > 0 && (
          <span
            aria-hidden="true"
            className="absolute -right-0.5 -top-0.5 grid min-w-4 place-items-center rounded-full bg-action px-1 text-[10px] font-semibold leading-4 text-action-fg"
          >
            {count}
          </span>
        )}
      </AriaButton>
      <Popover
        placement="bottom end"
        className="popover w-72 max-w-[calc(100vw-1.5rem)] rounded-lg border border-subtle bg-raised p-4 shadow-[0_2px_4px_rgb(34_34_31/.06),0_12px_32px_rgb(34_34_31/.14)]"
      >
        <Dialog aria-label="Voice" className="flex flex-col gap-3 outline-none" data-voice-status={status}>
          <div>
            <p className="text-[15px] font-semibold text-primary">Talk while you write</p>
            <p className="text-[12px] text-secondary">
              Everyone on this chapter can join. Audio goes straight between you and isn’t recorded.
            </p>
          </div>
          {peers.length > 0 && (
            <ul aria-label="In voice" className="flex flex-col gap-1.5">
              {peers.map((p) => {
                const u = named(p.userId)
                return (
                  <li
                    key={p.peerId}
                    data-voice-peer={p.me ? 'me' : p.userId}
                    data-peer-state={p.state}
                    className="flex items-center gap-2.5 text-[13px]"
                  >
                    <span
                      aria-hidden="true"
                      className={`voice-avatar grid size-8 shrink-0 place-items-center rounded-full text-[12px] font-semibold text-white ${p.speaking ? 'voice-speaking' : ''}`}
                      style={{ background: u?.color ?? '#6B675F' }}
                    >
                      {(u?.name ?? '?').slice(0, 1).toUpperCase()}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-primary">
                      {p.me ? 'You' : (u?.name ?? 'Someone')}
                      {!p.me && p.state !== 'connected' && joined && (
                        <span className="ml-1 text-tertiary">· connecting</span>
                      )}
                    </span>
                    {p.muted ? (
                      <MicOffIcon size={15} className="text-tertiary" />
                    ) : (
                      <MicIcon size={15} className="text-accent" />
                    )}
                    <span className="sr-only">{p.muted ? 'Muted' : 'Unmuted'}</span>
                  </li>
                )
              })}
            </ul>
          )}
          {status === 'denied' && (
            <p role="alert" className="rounded-md bg-app px-3 py-2 text-[13px] text-primary">
              Morrow can’t use your microphone. Allow it in your browser’s site settings, then try again.
            </p>
          )}
          {status === 'full' && (
            <p role="alert" className="rounded-md bg-app px-3 py-2 text-[13px] text-primary">
              This room is full (8 people). You can still write together; try again when someone leaves.
            </p>
          )}
          {status === 'unsupported' && (
            <p role="alert" className="rounded-md bg-app px-3 py-2 text-[13px] text-primary">
              This browser can’t make voice calls.
            </p>
          )}
          {joined ? (
            <div className="flex items-center gap-2">
              <Button
                variant={muted ? 'primary' : 'secondary'}
                aria-pressed={!muted}
                onPress={toggleMute}
                className="flex-1"
                aria-keyshortcuts={isMac() ? 'Meta+Shift+M' : 'Control+Shift+M'}
              >
                {muted ? <MicIcon size={16} /> : <MicOffIcon size={16} />}
                {muted ? 'Unmute' : 'Mute'}
              </Button>
              <Button variant="danger" onPress={leave} aria-label="Leave voice">
                <PhoneOffIcon size={16} />
              </Button>
            </div>
          ) : (
            <Button variant="primary" onPress={() => void join()} isDisabled={status === 'joining'}>
              <HeadphonesIcon size={16} />
              {status === 'joining' ? 'Joining…' : 'Join voice'}
            </Button>
          )}
          {joined && <p className="text-[11px] text-tertiary">{shortcut} mutes or unmutes you.</p>}
        </Dialog>
      </Popover>
    </DialogTrigger>
  )
}

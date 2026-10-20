'use client'
import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { InlineAlert } from '@/components/ui/inline-alert'
import { ShieldIcon } from '@/components/ui/icons'
import { api } from '@/lib/client-api'
import { SkeletonRows } from '@/components/ui/skeleton'

type Action = {
  id: string
  action: string
  targetType: string
  reason: string
  createdAt: string
  reversed: boolean
  appeal: { status: string; decision: string } | null
}
type Status = {
  restriction: { kind: 'suspended' | 'muted'; until: string | null; reason: string } | null
  actions: Action[]
}
const WHAT: Record<string, string> = {
  hide_work: 'A work of yours was hidden',
  remove_comment: 'A comment of yours was removed',
  restrict_account: 'Your account was restricted',
}
const when = new Intl.DateTimeFormat('en', { day: 'numeric', month: 'short', year: 'numeric' })

/** What moderation has done that affects you, and the appeal for each (FR-031 "appeals or review process"). */
export function ModerationStatus() {
  const [s, setS] = useState<Status | null>(null)
  const [error, setError] = useState<string | null>(null)
  const load = () => api<Status>('/me/moderation').then(setS, () => setError('Couldn’t load this.'))
  useEffect(() => void load(), [])
  if (error) return <InlineAlert>{error}</InlineAlert>
  if (!s) return <SkeletonRows count={2} avatar={false} />
  return (
    <div className="flex flex-col gap-6">
      {s.restriction ? (
        <div role="status" className="rounded-md border border-[var(--text-warning)] bg-canvas p-4">
          <p className="inline-flex items-center gap-1.5 font-medium text-primary">
            <ShieldIcon size={16} />
            {s.restriction.kind === 'suspended' ? 'Your account is read-only' : 'Your account is muted'}
            {s.restriction.until ? ` until ${when.format(new Date(s.restriction.until))}` : ''}
          </p>
          <p className="mt-1 text-sm text-secondary">
            {s.restriction.kind === 'suspended'
              ? 'You can read everything you could before, but not make changes.'
              : 'You can’t post comments, proposals or invitations.'}{' '}
            Reason: {s.restriction.reason}
          </p>
        </div>
      ) : (
        <p className="text-secondary">There are no restrictions on your account.</p>
      )}
      {s.actions.length > 0 && (
        <ul className="divide-y divide-subtle border-y border-subtle">
          {s.actions.map((a) => (
            <ActionRow key={a.id} a={a} onDone={() => void load()} />
          ))}
        </ul>
      )}
    </div>
  )
}

function ActionRow({ a, onDone }: { a: Action; onDone: () => void }) {
  const [msg, setMsg] = useState('')
  const [open, setOpen] = useState(false)
  const [error, setError] = useState<string | null>(null)
  return (
    <li className="py-4">
      <p className="font-medium text-primary">{WHAT[a.action] ?? a.action}</p>
      <p className="text-[13px] text-secondary">
        {when.format(new Date(a.createdAt))} · Reason: {a.reason}
        {a.reversed ? ' · Reversed' : ''}
      </p>
      {a.appeal ? (
        <p className="mt-2 text-sm text-primary">
          Appeal:{' '}
          {a.appeal.status === 'open'
            ? 'waiting for a moderator who wasn’t involved'
            : a.appeal.status === 'overturned'
              ? `successful. ${a.appeal.decision}`
              : `reviewed, decision stands. ${a.appeal.decision}`}
        </p>
      ) : (
        !a.reversed &&
        (open ? (
          <form
            onSubmit={async (e) => {
              e.preventDefault()
              setError(null)
              try {
                await api('/me/appeals', { method: 'POST', body: { actionId: a.id, message: msg } })
                onDone()
              } catch (err) {
                setError(err instanceof Error ? err.message : 'That didn’t send.')
              }
            }}
            className="mt-2 flex flex-col gap-2"
          >
            {error && <InlineAlert>{error}</InlineAlert>}
            <label className="flex flex-col gap-1.5">
              <span className="text-sm text-primary">Why should this be reconsidered?</span>
              <textarea
                value={msg}
                onChange={(e) => setMsg(e.target.value)}
                rows={3}
                minLength={10}
                maxLength={2000}
                className="rounded-sm border border-control bg-canvas px-3 py-2 text-base text-primary outline-none focus:ring-2 focus:ring-focus"
              />
            </label>
            <div className="flex justify-end gap-2">
              <Button variant="quiet" onPress={() => setOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" variant="primary" isDisabled={msg.trim().length < 10}>
                Send appeal
              </Button>
            </div>
          </form>
        ) : (
          <Button size="sm" variant="secondary" className="mt-2" onPress={() => setOpen(true)}>
            Appeal
          </Button>
        ))
      )}
    </li>
  )
}

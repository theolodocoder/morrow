'use client'
import { useState } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import { REPORT_CATEGORIES, REPORT_CATEGORY_LABELS } from '@morrow/contracts'
import { Button } from '@/components/ui/button'
import { ChoiceGroup } from '@/components/ui/choice'
import { Dialog } from '@/components/ui/dialog'
import { InlineAlert } from '@/components/ui/inline-alert'
import { BlockIcon, FlagIcon } from '@/components/ui/icons'
import { ClientApiError } from '@/lib/client-api'
import { routes } from '@/lib/routes'

type Category = (typeof REPORT_CATEGORIES)[number]
export type ReportTarget =
  | { type: 'work'; publicPath?: string; workId?: string }
  | { type: 'comment'; commentId: string }
  | { type: 'user'; username: string }
  | { type: 'proposal'; proposalId: string }
  | { type: 'reader_comment'; commentId: string }

/** Report something (FR-031). Says plainly what happens next; signed-out visitors are asked to sign in first. */
export function ReportButton({
  target,
  label = 'Report',
  compact,
}: {
  target: ReportTarget
  label?: string
  compact?: boolean
}) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={`inline-flex items-center gap-1 rounded-sm text-secondary outline-none hover:text-primary focus-visible:ring-2 focus-visible:ring-focus ${compact ? 'px-1.5 py-0.5 text-[12px]' : 'px-2 py-1 text-[13px]'}`}
      >
        <FlagIcon size={compact ? 14 : 16} />
        {label}
      </button>
      <ReportDialog target={target} isOpen={open} onOpenChange={setOpen} />
    </>
  )
}

/** The report form itself, so a menu item can open it too. */
export function ReportDialog({
  target,
  isOpen,
  onOpenChange,
}: {
  target: ReportTarget
  isOpen: boolean
  onOpenChange: (o: boolean) => void
}) {
  const router = useRouter()
  const path = usePathname()
  const [category, setCategory] = useState<Category>('spam')
  const [details, setDetails] = useState('')
  const [state, setState] = useState<'idle' | 'sending' | 'sent' | 'already'>('idle')
  const [error, setError] = useState<string | null>(null)
  const setOpen = (o: boolean) => {
    if (o) setState('idle')
    onOpenChange(o)
  }

  async function send() {
    setState('sending')
    setError(null)
    try {
      const res = await fetch('/api/v1/reports', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ target, category, details }),
      })
      if (res.status === 401) return router.push(`/sign-in?next=${encodeURIComponent(path)}`)
      if (!res.ok) throw new ClientApiError(res.status, await res.json().catch(() => ({})))
      setState(res.status === 200 ? 'already' : 'sent')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'That didn’t send.')
      setState('idle')
    }
  }
  return (
    <Dialog title="Report this" isOpen={isOpen} onOpenChange={setOpen}>
      {state === 'sent' || state === 'already' ? (
        <div className="flex flex-col gap-3" role="status">
          <p className="text-sm text-primary">
            {state === 'sent'
              ? 'Thank you. A moderator will review it.'
              : 'You’ve already reported this; it’s with a moderator.'}
          </p>
          <p className="text-[13px] text-secondary">
            You’ll be told the outcome. Follow it in{' '}
            <a className="text-accent underline underline-offset-2" href={routes.reports}>
              your reports
            </a>
            .
          </p>
          <div className="flex justify-end">
            <Button variant="primary" onPress={() => setOpen(false)}>
              Done
            </Button>
          </div>
        </div>
      ) : (
        <form
          onSubmit={(e) => {
            e.preventDefault()
            void send()
          }}
          className="flex max-h-[70dvh] flex-col gap-4 overflow-y-auto"
        >
          {error && <InlineAlert>{error}</InlineAlert>}
          <ChoiceGroup
            label="What’s wrong?"
            value={category}
            onChange={setCategory}
            options={REPORT_CATEGORIES.map((c) => ({ id: c, label: REPORT_CATEGORY_LABELS[c] }))}
          />
          <label className="flex flex-col gap-1.5">
            <span className="text-sm font-medium text-primary">
              Anything a moderator should know (optional)
            </span>
            <textarea
              value={details}
              onChange={(e) => setDetails(e.target.value)}
              rows={3}
              maxLength={2000}
              className="rounded-sm border border-control bg-canvas px-3 py-2 text-base text-primary outline-none focus:ring-2 focus:ring-focus"
            />
          </label>
          <p className="text-[12px] text-secondary">
            Moderators see what you reported as it is now, and your note. They don’t get access to anything
            else.
          </p>
          <div className="flex justify-end gap-2">
            <Button variant="quiet" onPress={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" isDisabled={state === 'sending'}>
              {state === 'sending' ? 'Sending…' : 'Send report'}
            </Button>
          </div>
        </form>
      )}
    </Dialog>
  )
}

/** Block or unblock a writer (FR-032), stating what blocking does. */
export function BlockButton({ username, name }: { username: string; name: string }) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1 rounded-sm px-2 py-1 text-[13px] text-secondary outline-none hover:text-primary focus-visible:ring-2 focus-visible:ring-focus"
      >
        <BlockIcon size={16} />
        Block
      </button>
      <BlockDialog username={username} name={name} isOpen={open} onOpenChange={setOpen} />
    </>
  )
}

/** The block confirmation itself, so a menu item can open it too. */
export function BlockDialog({
  username,
  name,
  isOpen,
  onOpenChange,
}: {
  username: string
  name: string
  isOpen: boolean
  onOpenChange: (o: boolean) => void
}) {
  const router = useRouter()
  const path = usePathname()
  const [done, setDone] = useState(false)
  const setOpen = onOpenChange
  return (
    <Dialog title={`Block ${name}?`} isOpen={isOpen} onOpenChange={setOpen}>
      {done ? (
        <div className="flex flex-col gap-3" role="status">
          <p className="text-sm text-primary">
            {name} is blocked. Undo it any time in{' '}
            <a className="text-accent underline underline-offset-2" href={routes.safetySettings}>
              Safety settings
            </a>
            .
          </p>
          <div className="flex justify-end">
            <Button variant="primary" onPress={() => setOpen(false)}>
              Done
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          <ul className="list-disc pl-5 text-sm text-primary">
            <li>Neither of you can follow the other; existing follows end.</li>
            <li>Neither of you can mention or invite the other.</li>
            <li>You won’t be notified about anything they do.</li>
          </ul>
          <p className="text-[13px] text-secondary">
            In works you both belong to, comments stay visible so moderators can act on them. They aren’t told
            you blocked them.
          </p>
          <div className="flex justify-end gap-2">
            <Button variant="quiet" onPress={() => setOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="danger"
              onPress={async () => {
                const res = await fetch('/api/v1/me/blocks', {
                  method: 'PUT',
                  credentials: 'same-origin',
                  headers: { 'content-type': 'application/json' },
                  body: JSON.stringify({ username }),
                })
                if (res.status === 401) return router.push(`/sign-in?next=${encodeURIComponent(path)}`)
                if (res.ok) setDone(true)
              }}
            >
              Block
            </Button>
          </div>
        </div>
      )}
    </Dialog>
  )
}

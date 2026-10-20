'use client'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import type { PublicationStatus, Work } from '@morrow/contracts'
import { Checkbox } from 'react-aria-components'
import { Button } from '@/components/ui/button'
import { ChoiceGroup } from '@/components/ui/choice'
import { Dialog } from '@/components/ui/dialog'
import { InlineAlert } from '@/components/ui/inline-alert'
import { api } from '@/lib/client-api'
import { routes } from '@/lib/routes'
import { VISIBILITY_OPTIONS } from '@/lib/work-options'

type Audience = 'public' | 'unlisted'
const AUDIENCES = VISIBILITY_OPTIONS.filter((o) => o.id !== 'private') as {
  id: Audience
  label: string
  description?: string
}[]

/**
 * Publish (PRD FR-023, Journey A). Publishing is a deliberate act with a stated consequence: readers get a frozen copy
 * of the chosen version as it is now; drafting continues privately until the next publish.
 */
export function PublishDialog({
  work,
  isOpen,
  onOpenChange,
}: {
  work: Work
  isOpen: boolean
  onOpenChange: (o: boolean) => void
}) {
  const router = useRouter()
  const [status, setStatus] = useState<PublicationStatus | null>(null)
  const [audience, setAudience] = useState<Audience>(work.visibility === 'unlisted' ? 'unlisted' : 'public')
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [completed, setCompleted] = useState(work.completed)

  /** Readers see "Complete" or "Ongoing"; finishing also earns The Finisher badge. */
  const markComplete = async (on: boolean) => {
    setCompleted(on)
    try {
      await api(`/works/${work.id}`, { method: 'PATCH', body: { completed: on } })
      router.refresh()
    } catch (e) {
      setCompleted(!on)
      setError(e instanceof Error ? e.message : 'That didn’t save.')
    }
  }

  useEffect(() => {
    if (!isOpen) return
    setConfirming(false)
    setError(null)
    setCopied(false)
    void api<PublicationStatus>(`/works/${work.id}/publication`)
      .then(setStatus)
      .catch(() => setStatus(null))
  }, [isOpen, work.id])

  const run = async (path: 'publish' | 'unpublish') => {
    setBusy(true)
    setError(null)
    try {
      setStatus(
        await api<PublicationStatus>(`/works/${work.id}/${path}`, {
          method: 'POST',
          body: path === 'publish' ? { visibility: audience } : {},
        }),
      )
      setConfirming(false)
      router.refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'That didn’t work.')
    } finally {
      setBusy(false)
    }
  }

  const url =
    status && typeof window !== 'undefined'
      ? `${window.location.origin}${routes.publicWork(status.publicPath)}`
      : ''
  const live = status?.published && status.visibility !== 'private'

  return (
    <Dialog
      title={live ? 'Published' : `Publish “${work.title}”`}
      isOpen={isOpen}
      onOpenChange={onOpenChange}
    >
      <div className="flex flex-col gap-5">
        {error && <InlineAlert>{error}</InlineAlert>}

        {live && (
          <div className="rounded-sm border border-subtle bg-app p-3" role="status">
            <p className="text-sm text-primary">
              {status.visibility === 'public' ? 'Anyone can read' : 'Anyone with the link can read'}{' '}
              {status.chapterCount === 1 ? '1 chapter' : `${status.chapterCount} chapters`}
              {status.branchName ? ` from the “${status.branchName}” version` : ''}.
            </p>
            <div className="mt-2 flex gap-2">
              <input
                readOnly
                value={url}
                aria-label="Public link"
                onFocus={(e) => e.currentTarget.select()}
                className="h-9 min-w-0 flex-1 rounded-sm border border-control bg-canvas px-2 font-mono text-[12px] text-primary"
              />
              <Button
                size="md"
                variant="secondary"
                onPress={async () => {
                  await navigator.clipboard.writeText(url)
                  setCopied(true)
                }}
              >
                {copied ? 'Copied' : 'Copy'}
              </Button>
            </div>
            <a
              href={status ? routes.publicWork(status.publicPath) : '#'}
              target="_blank"
              rel="noreferrer"
              className="mt-2 inline-block text-[13px] text-accent underline underline-offset-2"
            >
              Open the reading page
            </a>
            <Checkbox
              isSelected={completed}
              onChange={(v) => void markComplete(v)}
              className="group mt-3 flex cursor-default items-start gap-2.5 border-t border-subtle pt-3 text-sm text-primary outline-none"
            >
              <span
                aria-hidden="true"
                className="mt-0.5 grid size-4 shrink-0 place-items-center rounded-[3px] border border-control group-data-[selected]:border-action group-data-[selected]:bg-action group-data-[focus-visible]:ring-2 group-data-[focus-visible]:ring-focus"
              >
                <svg viewBox="0 0 12 12" className="hidden size-3 text-action-fg group-data-[selected]:block">
                  <path
                    d="M2.5 6.5l2.2 2.2 4.8-5"
                    stroke="currentColor"
                    strokeWidth="1.8"
                    fill="none"
                    strokeLinecap="round"
                  />
                </svg>
              </span>
              <span>
                This work is complete
                <span className="block text-[13px] text-secondary">
                  Readers see “Complete” instead of “Ongoing”. You can still publish changes.
                </span>
              </span>
            </Checkbox>
          </div>
        )}

        {!confirming ? (
          <>
            <ChoiceGroup
              label="Who can read it"
              value={audience}
              onChange={setAudience}
              options={AUDIENCES}
            />
            <p className="text-[13px] text-secondary">
              Readers get a copy of every chapter as it is right now. What you write afterwards stays private
              until you publish again.
              {work.contentWarnings.length === 0
                ? ' Consider adding content warnings in Work settings first.'
                : ''}
            </p>
            <div className="flex flex-wrap justify-end gap-2">
              {live && (
                <Button variant="quiet" isDisabled={busy} onPress={() => void run('unpublish')}>
                  Unpublish
                </Button>
              )}
              <Button variant="quiet" onPress={() => onOpenChange(false)}>
                {live ? 'Done' : 'Cancel'}
              </Button>
              <Button variant="primary" onPress={() => setConfirming(true)}>
                {live ? 'Publish latest' : 'Continue'}
              </Button>
            </div>
          </>
        ) : (
          <>
            <p className="text-sm text-primary">
              {audience === 'public'
                ? 'Anyone will be able to find and read'
                : 'Anyone with the link will be able to read'}{' '}
              “{work.title}” as it is now. You can unpublish at any time.
            </p>
            <div className="flex justify-end gap-2">
              <Button variant="quiet" isDisabled={busy} onPress={() => setConfirming(false)}>
                Back
              </Button>
              <Button variant="primary" isDisabled={busy} onPress={() => void run('publish')}>
                {busy ? 'Publishing…' : audience === 'public' ? 'Publish publicly' : 'Publish to link'}
              </Button>
            </div>
          </>
        )}
      </div>
    </Dialog>
  )
}

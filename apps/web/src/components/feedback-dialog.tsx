'use client'
import { useState } from 'react'
import { usePathname } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { ChoiceGroup } from '@/components/ui/choice'
import { Dialog } from '@/components/ui/dialog'
import { InlineAlert } from '@/components/ui/inline-alert'
import { api } from '@/lib/client-api'

type Kind = 'bug' | 'idea' | 'praise' | 'other'

/** Beta feedback (PRD Phase 7): what's wrong or what would help, with the page you were on (never its content). */
export function FeedbackDialog({
  isOpen,
  onOpenChange,
}: {
  isOpen: boolean
  onOpenChange: (o: boolean) => void
}) {
  const path = usePathname()
  const [kind, setKind] = useState<Kind>('bug')
  const [message, setMessage] = useState('')
  const [state, setState] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle')
  async function send() {
    setState('sending')
    try {
      await api('/feedback', { method: 'POST', body: { kind, message, path } })
      setState('sent')
      setMessage('')
    } catch {
      setState('error')
    }
  }
  return (
    <Dialog
      title="Send feedback"
      isOpen={isOpen}
      onOpenChange={(o) => {
        onOpenChange(o)
        if (!o) setState('idle')
      }}
    >
      {state === 'sent' ? (
        <div className="flex flex-col gap-3" role="status">
          <p className="text-sm text-primary">Thank you. It goes straight to the people building Morrow.</p>
          <div className="flex justify-end">
            <Button variant="primary" onPress={() => onOpenChange(false)}>
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
          className="flex flex-col gap-4"
        >
          {state === 'error' && <InlineAlert>That didn’t send. Try again in a moment.</InlineAlert>}
          <ChoiceGroup
            label="What is it?"
            value={kind}
            onChange={setKind}
            options={[
              { id: 'bug', label: 'Something’s broken' },
              { id: 'idea', label: 'An idea' },
              { id: 'praise', label: 'Something I love' },
              { id: 'other', label: 'Something else' },
            ]}
          />
          <label className="flex flex-col gap-1.5">
            <span className="text-sm font-medium text-primary">Tell us</span>
            <textarea
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              rows={4}
              minLength={3}
              maxLength={4000}
              required
              className="rounded-sm border border-control bg-canvas px-3 py-2 text-base text-primary outline-none focus:ring-2 focus:ring-focus"
            />
          </label>
          <p className="text-[12px] text-secondary">
            We include the page you’re on ({path}), not anything you’ve written.
          </p>
          <div className="flex justify-end gap-2">
            <Button variant="quiet" onPress={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button
              type="submit"
              variant="primary"
              isDisabled={state === 'sending' || message.trim().length < 3}
            >
              {state === 'sending' ? 'Sending…' : 'Send'}
            </Button>
          </div>
        </form>
      )}
    </Dialog>
  )
}

/** A quiet text button that opens it (for headers). */
export function FeedbackButton() {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="rounded-sm px-2 py-1 text-sm text-secondary outline-none hover:bg-hover hover:text-primary focus-visible:ring-2 focus-visible:ring-focus"
      >
        Send feedback
      </button>
      <FeedbackDialog isOpen={open} onOpenChange={setOpen} />
    </>
  )
}

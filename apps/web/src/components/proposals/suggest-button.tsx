'use client'
import { useState } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import { Form } from 'react-aria-components'
import type { ProposalDetail } from '@morrow/contracts'
import { Button } from '@/components/ui/button'
import { Dialog } from '@/components/ui/dialog'
import { InlineAlert } from '@/components/ui/inline-alert'
import { ProposeIcon } from '@/components/ui/icons'
import { TextField } from '@/components/ui/text-field'
import { ClientApiError } from '@/lib/client-api'
import { routes } from '@/lib/routes'

/**
 * "Suggest an edit" on a published chapter (public participation, M6). You edit a private copy of the published text;
 * the writer reviews it like any proposal. Signed-out readers are asked to sign in and brought back.
 */
export function SuggestButton({
  publicPath,
  chapterSlug,
  chapterTitle,
}: {
  publicPath: string
  chapterSlug: string
  chapterTitle: string
}) {
  const router = useRouter()
  const path = usePathname()
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function start(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const f = new FormData(e.currentTarget)
    setBusy(true)
    setError(null)
    const res = await fetch('/api/v1/suggestions', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        publicPath,
        chapterSlug,
        title: String(f.get('title') ?? ''),
        explanation: String(f.get('explanation') ?? ''),
      }),
    })
    if (res.status === 401) return router.push(`/sign-in?next=${encodeURIComponent(path)}`)
    if (!res.ok) {
      const problem = await res.json().catch(() => ({}))
      setError(new ClientApiError(res.status, problem).message)
      setBusy(false)
      return
    }
    const p = (await res.json()) as ProposalDetail
    router.push(routes.proposal(p.workId, p.id))
  }

  return (
    <>
      <Button size="sm" variant="secondary" onPress={() => setOpen(true)}>
        <ProposeIcon size={16} />
        Suggest an edit
      </Button>
      <Dialog title={`Suggest an edit to “${chapterTitle}”`} isOpen={open} onOpenChange={setOpen}>
        <Form onSubmit={start} className="flex flex-col gap-4">
          {error && <InlineAlert>{error}</InlineAlert>}
          <p className="text-sm text-secondary">
            You’ll get a private copy of this chapter as published to change. The writer reviews your
            suggestion, and you’re credited if they accept it.
          </p>
          <TextField
            name="title"
            label="What are you suggesting?"
            isRequired
            maxLength={200}
            placeholder="Tighten the opening"
          />
          <TextField name="explanation" label="Why (optional)" maxLength={4000} />
          <div className="flex justify-end gap-2">
            <Button variant="quiet" onPress={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" isDisabled={busy}>
              {busy ? 'Starting…' : 'Start editing'}
            </Button>
          </div>
        </Form>
      </Dialog>
    </>
  )
}

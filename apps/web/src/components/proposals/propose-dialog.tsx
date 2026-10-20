'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Form } from 'react-aria-components'
import type { ProposalDetail, ProposalSummary } from '@morrow/contracts'
import { Button } from '@/components/ui/button'
import { ChoiceGroup } from '@/components/ui/choice'
import { Dialog } from '@/components/ui/dialog'
import { InlineAlert } from '@/components/ui/inline-alert'
import { TextField } from '@/components/ui/text-field'
import { api, newIdempotencyKey } from '@/lib/client-api'
import { routes } from '@/lib/routes'
import { KIND_OPTIONS } from './labels'

/** Start a contribution (PRD FR-014). An edit opens a private copy of the current chapter to write in. */
export function ProposeDialog({
  workId,
  chapter,
  isOpen,
  onOpenChange,
}: {
  workId: string
  chapter: { id: string; title: string }
  isOpen: boolean
  onOpenChange: (o: boolean) => void
}) {
  const router = useRouter()
  const [kind, setKind] = useState<ProposalSummary['kind']>('edit')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [key] = useState(newIdempotencyKey)

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const f = new FormData(e.currentTarget)
    setBusy(true)
    setError(null)
    try {
      const p = await api<ProposalDetail>(`/works/${workId}/proposals`, {
        method: 'POST',
        headers: { 'idempotency-key': key },
        body: {
          kind,
          title: String(f.get('title') ?? ''),
          explanation: String(f.get('explanation') ?? ''),
          chapterId: chapter.id, // notes keep the chapter as context
        },
      })
      router.push(routes.proposal(workId, p.id))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'That didn’t work.')
      setBusy(false)
    }
  }

  return (
    <Dialog title="Propose a change" isOpen={isOpen} onOpenChange={onOpenChange}>
      <Form onSubmit={submit} className="flex max-h-[70dvh] flex-col gap-4 overflow-y-auto">
        {error && <InlineAlert>{error}</InlineAlert>}
        <ChoiceGroup
          label="What are you proposing?"
          value={kind}
          onChange={setKind}
          options={KIND_OPTIONS.map((k) =>
            k.id === 'edit' ? { ...k, label: `Edit “${chapter.title}”` } : k,
          )}
        />
        <TextField
          name="title"
          label="Title"
          isRequired
          maxLength={200}
          placeholder={kind === 'edit' ? 'A gentler opening' : 'The ferryman'}
        />
        <TextField
          name="explanation"
          label="Why (optional)"
          maxLength={4000}
          description="A line for the reviewer about what this changes and why."
        />
        <div className="flex justify-end gap-2">
          <Button variant="quiet" onPress={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" isDisabled={busy}>
            {busy ? 'Starting…' : kind === 'edit' ? 'Start editing' : 'Continue'}
          </Button>
        </div>
      </Form>
    </Dialog>
  )
}

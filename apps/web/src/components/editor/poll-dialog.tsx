'use client'
import { useEffect, useState } from 'react'
import { Form } from 'react-aria-components'
import type { Poll } from '@morrow/contracts'
import { Button } from '@/components/ui/button'
import { Dialog } from '@/components/ui/dialog'
import { InlineAlert } from '@/components/ui/inline-alert'
import { CloseIcon, PlusIcon } from '@/components/ui/icons'
import { TextField } from '@/components/ui/text-field'
import { toast } from '@/components/ui/toast'
import { api, ClientApiError } from '@/lib/client-api'

/**
 * "What if": ask readers a question at the end of this chapter (P-062). Two to four answers, optionally closing after
 * a few days. Readers see it once the chapter is published; you see the counts here.
 */
export function PollDialog({
  chapterId,
  isOpen,
  onOpenChange,
}: {
  chapterId: string
  isOpen: boolean
  onOpenChange: (o: boolean) => void
}) {
  const [poll, setPoll] = useState<Poll | null>(null)
  const [question, setQuestion] = useState('')
  const [options, setOptions] = useState(['', ''])
  const [days, setDays] = useState<number | null>(7)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!isOpen) {
      setQuestion('')
      setOptions(['', ''])
      return
    }
    setError(null)
    void api<{ poll: Poll | null }>(`/chapters/${chapterId}/poll`).then((r) => {
      setPoll(r.poll)
      // never overwrite what was typed while this loaded
      if (r.poll) {
        setQuestion((q) => q || r.poll!.question)
        setOptions((xs) => (xs.every((x) => !x) ? r.poll!.options.map((o) => o.label) : xs))
      }
    })
  }, [isOpen, chapterId])

  async function save(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const r = await api<{ poll: Poll }>(`/chapters/${chapterId}/poll`, {
        method: 'PUT',
        body: { question, options: options.map((o) => o.trim()).filter(Boolean), closesInDays: days },
      })
      setPoll(r.poll)
      toast('Poll saved. Readers see it at the end of the chapter once it’s published.')
      onOpenChange(false)
    } catch (err) {
      setError(
        err instanceof ClientApiError ? (err.problem.detail ?? err.message) : 'Couldn’t save the poll.',
      )
    } finally {
      setBusy(false)
    }
  }
  async function remove() {
    await api(`/chapters/${chapterId}/poll`, { method: 'DELETE' })
    setPoll(null)
    toast('Poll removed')
    onOpenChange(false)
  }

  const max = Math.max(1, ...(poll?.options.map((o) => o.votes ?? 0) ?? [1]))
  return (
    <Dialog title="Ask readers: what if?" isOpen={isOpen} onOpenChange={onOpenChange}>
      <Form onSubmit={save} className="flex flex-col gap-4">
        {error && <InlineAlert>{error}</InlineAlert>}
        {poll && poll.total > 0 && (
          <div className="flex flex-col gap-1.5 rounded-md bg-app p-3">
            <p className="text-[12px] font-medium text-secondary">
              {poll.total} {poll.total === 1 ? 'vote' : 'votes'} so far
            </p>
            {poll.options.map((o) => (
              <div key={o.label} className="flex items-center gap-2 text-[13px]">
                <span className="w-28 truncate text-primary">{o.label}</span>
                <span className="h-2 flex-1 overflow-hidden rounded-full bg-hover">
                  <span
                    className="block h-full bg-action"
                    style={{ width: `${((o.votes ?? 0) / max) * 100}%` }}
                  />
                </span>
                <span className="w-6 text-right tabular-nums text-secondary">{o.votes}</span>
              </div>
            ))}
          </div>
        )}
        <TextField
          label="Question"
          value={question}
          onChange={setQuestion}
          isRequired
          maxLength={200}
          placeholder="What should Ama do next?"
        />
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-1 text-sm font-medium text-primary">Answers</legend>
          {options.map((o, i) => (
            <div key={i} className="flex items-center gap-2">
              <input
                aria-label={`Answer ${i + 1}`}
                value={o}
                maxLength={80}
                required={i < 2}
                onChange={(e) => setOptions((xs) => xs.map((x, j) => (j === i ? e.target.value : x)))}
                className="h-10 flex-1 rounded-md border border-control bg-canvas px-3 text-base text-primary outline-none focus:ring-2 focus:ring-focus"
              />
              {options.length > 2 && (
                <Button
                  variant="quiet"
                  size="sm"
                  aria-label={`Remove answer ${i + 1}`}
                  onPress={() => setOptions((xs) => xs.filter((_, j) => j !== i))}
                >
                  <CloseIcon size={14} />
                </Button>
              )}
            </div>
          ))}
          {options.length < 4 && (
            <Button
              variant="quiet"
              size="sm"
              className="w-fit"
              onPress={() => setOptions((xs) => [...xs, ''])}
            >
              <PlusIcon size={14} />
              Add an answer
            </Button>
          )}
        </fieldset>
        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-medium text-primary">Closes</span>
          <select
            value={days ?? 'never'}
            onChange={(e) => setDays(e.target.value === 'never' ? null : Number(e.target.value))}
            className="h-10 rounded-md border border-control bg-canvas px-3 text-base text-primary outline-none focus:ring-2 focus:ring-focus"
          >
            <option value={3}>In 3 days</option>
            <option value={7}>In a week</option>
            <option value={14}>In two weeks</option>
            <option value="never">When I remove it</option>
          </select>
        </label>
        <div className="flex flex-wrap justify-between gap-2">
          {poll ? (
            <Button variant="danger" size="sm" onPress={() => void remove()}>
              Remove poll
            </Button>
          ) : (
            <span />
          )}
          <div className="flex gap-2">
            <Button variant="quiet" onPress={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" isDisabled={busy}>
              {busy ? 'Saving…' : poll ? 'Save poll' : 'Ask readers'}
            </Button>
          </div>
        </div>
      </Form>
    </Dialog>
  )
}

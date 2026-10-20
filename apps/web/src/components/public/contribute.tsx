'use client'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { Form } from 'react-aria-components'
import type { ContributionState, ProposalDetail } from '@morrow/contracts'
import { Button } from '@/components/ui/button'
import { InlineAlert } from '@/components/ui/inline-alert'
import { ArrowLeftIcon, CheckIcon, PenIcon, PeopleIcon, ProposeIcon } from '@/components/ui/icons'
import { Sheet } from '@/components/ui/sheet'
import { TextField } from '@/components/ui/text-field'
import { api, ClientApiError } from '@/lib/client-api'
import { routes } from '@/lib/routes'
import { SignupPrompt } from './signup-wall'

type Step = 'choose' | 'suggest' | 'chain' | 'ask' | 'sent'

const card =
  'press group flex w-full items-start gap-3 rounded-lg border border-subtle bg-canvas p-4 text-left outline-none transition-colors hover:border-control focus-visible:ring-2 focus-visible:ring-focus disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:border-subtle'

/**
 * Contribute (P-050): the way into a published work for anyone who isn't part of it yet. Two paths, side by side:
 * suggest an edit to a chapter (when the writer allows it), or ask to collaborate (the writer decides; if they
 * accept, you join as a contributor). Signed-out visitors are invited to join first, then brought back.
 */
export function ContributeButton({
  publicPath,
  title,
  authorName,
  chapters,
}: {
  publicPath: string
  title: string
  authorName: string
  chapters: { title: string; slug: string }[]
}) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [join, setJoin] = useState(false)
  const [state, setState] = useState<ContributionState | null>(null)
  const [step, setStep] = useState<Step>('choose')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [chapter, setChapter] = useState(chapters[0]?.slug ?? '')

  async function start() {
    setError(null)
    setStep('choose')
    try {
      setState(
        await api<ContributionState>(`/contributions/state?publicPath=${encodeURIComponent(publicPath)}`),
      )
      setOpen(true)
    } catch (e) {
      if (e instanceof ClientApiError && e.status === 401) setJoin(true)
      else setError('Couldn’t open that just now. Try again.')
    }
  }

  async function suggest(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const f = new FormData(e.currentTarget)
    setBusy(true)
    setError(null)
    try {
      const p = await api<ProposalDetail>('/suggestions', {
        method: 'POST',
        body: {
          publicPath,
          chapterSlug: chapter,
          title: String(f.get('title') ?? ''),
          explanation: String(f.get('explanation') ?? ''),
        },
      })
      router.push(routes.proposal(p.workId, p.id))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'That didn’t work.')
      setBusy(false)
    }
  }

  async function chain(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const f = new FormData(e.currentTarget)
    setBusy(true)
    setError(null)
    try {
      const p = await api<ProposalDetail>('/suggestions', {
        method: 'POST',
        body: {
          publicPath,
          kind: 'chapter',
          title: String(f.get('title') ?? ''),
          explanation: String(f.get('explanation') ?? ''),
          body: String(f.get('body') ?? ''),
        },
      })
      router.push(routes.proposal(p.workId, p.id))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'That didn’t work.')
      setBusy(false)
    }
  }

  async function ask(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      await api('/contribution-requests', {
        method: 'POST',
        body: { publicPath, message: String(new FormData(e.currentTarget).get('message') ?? '') },
      })
      setState((s) => (s ? { ...s, pending: true } : s))
      setStep('sent')
    } catch (err) {
      setError(err instanceof ClientApiError ? (err.problem.detail ?? err.message) : 'That didn’t send.')
    } finally {
      setBusy(false)
    }
  }

  const back = (
    <button
      type="button"
      onClick={() => setStep('choose')}
      className="press -ml-1 mb-1 inline-flex items-center gap-1 rounded-full px-1.5 py-1 text-[13px] text-secondary hover:text-primary"
    >
      <ArrowLeftIcon size={15} /> Other ways to help
    </button>
  )

  return (
    <>
      <Button size="lg" variant="secondary" onPress={() => void start()} className="h-11">
        <PeopleIcon size={17} />
        Contribute
      </Button>
      {error && !open && <InlineAlert>{error}</InlineAlert>}
      <Sheet title={`Help shape “${title}”`} isOpen={open} onOpenChange={setOpen}>
        <div className="flex flex-col gap-4">
          {error && <InlineAlert>{error}</InlineAlert>}
          {state?.member ? (
            <p className="text-secondary">
              You’re already part of this work. Find it in <span className="text-primary">You → Works</span>.
            </p>
          ) : step === 'choose' ? (
            <>
              <p className="text-[14px] text-secondary">
                Anyone can help. {authorName} reviews every contribution, and you’re credited for what’s
                accepted.
              </p>
              <button
                type="button"
                className={card}
                disabled={!state?.openToSuggestions || !chapters.length}
                onClick={() => setStep('suggest')}
              >
                <span className="grid size-10 shrink-0 place-items-center rounded-full bg-selected text-accent">
                  <ProposeIcon size={18} />
                </span>
                <span className="min-w-0">
                  <span className="block font-medium text-primary">Suggest an edit</span>
                  <span className="block text-[13px] text-secondary">
                    {state?.openToSuggestions
                      ? 'Change a chapter in your own private copy. Nothing changes until it’s accepted.'
                      : `${authorName} isn’t taking edit suggestions right now. You can still ask to collaborate.`}
                  </span>
                </span>
              </button>
              {state?.openToSuggestions && (
                <button type="button" className={card} onClick={() => setStep('chain')}>
                  <span className="grid size-10 shrink-0 place-items-center rounded-full bg-selected text-accent">
                    <PenIcon size={18} />
                  </span>
                  <span className="min-w-0">
                    <span className="block font-medium text-primary">Write the next chapter</span>
                    <span className="block text-[13px] text-secondary">
                      Keep the story going. If {authorName} accepts it, it joins the work, credited to you.
                    </span>
                  </span>
                </button>
              )}
              <button type="button" className={card} disabled={state?.pending} onClick={() => setStep('ask')}>
                <span className="grid size-10 shrink-0 place-items-center rounded-full bg-selected text-accent">
                  <PeopleIcon size={18} />
                </span>
                <span className="min-w-0">
                  <span className="block font-medium text-primary">Ask to collaborate</span>
                  <span className="block text-[13px] text-secondary">
                    {state?.pending
                      ? `Request sent. ${authorName} will see it in their Activity.`
                      : 'Say what you’d bring. If accepted, you join as a contributor and can propose changes from inside the work.'}
                  </span>
                </span>
              </button>
            </>
          ) : step === 'suggest' ? (
            <Form onSubmit={suggest} className="flex flex-col gap-4">
              {back}
              <label className="flex flex-col gap-1.5">
                <span className="text-sm font-medium text-primary">Chapter</span>
                <select
                  value={chapter}
                  onChange={(e) => setChapter(e.target.value)}
                  className="h-10 rounded-md border border-control bg-canvas px-3 text-base text-primary outline-none focus:ring-2 focus:ring-focus"
                >
                  {chapters.map((c, i) => (
                    <option key={c.slug} value={c.slug}>
                      {i + 1}. {c.title}
                    </option>
                  ))}
                </select>
              </label>
              <TextField
                name="title"
                label="What are you suggesting?"
                isRequired
                maxLength={200}
                placeholder="Tighten the opening"
              />
              <TextField name="explanation" label="Why (optional)" maxLength={4000} />
              <Button type="submit" variant="primary" isDisabled={busy} className="self-end">
                {busy ? 'Starting…' : 'Start editing'}
              </Button>
            </Form>
          ) : step === 'chain' ? (
            <Form onSubmit={chain} className="flex flex-col gap-4">
              {back}
              <TextField
                name="title"
                label="Chapter title"
                isRequired
                maxLength={200}
                placeholder="What happened next"
              />
              <label className="flex flex-col gap-1.5">
                <span className="text-sm font-medium text-primary">The chapter</span>
                <textarea
                  name="body"
                  required
                  rows={10}
                  maxLength={60000}
                  placeholder="Leave a blank line between paragraphs."
                  className="rounded-md border border-control bg-canvas px-3 py-2 font-manuscript text-base text-primary outline-none placeholder:text-tertiary focus:ring-2 focus:ring-focus"
                />
              </label>
              <TextField name="explanation" label={`A note to ${authorName} (optional)`} maxLength={4000} />
              <p className="text-[13px] text-secondary">
                You can keep editing it before you submit it for review.
              </p>
              <Button type="submit" variant="primary" isDisabled={busy} className="self-end">
                {busy ? 'Saving…' : 'Continue'}
              </Button>
            </Form>
          ) : step === 'ask' ? (
            <Form onSubmit={ask} className="flex flex-col gap-4">
              {back}
              <TextField
                name="message"
                label={`A note to ${authorName} (optional)`}
                maxLength={1000}
                placeholder="I write dialogue and I’d love to help with the middle chapters."
              />
              <Button type="submit" variant="primary" isDisabled={busy} className="self-end">
                {busy ? 'Sending…' : 'Send request'}
              </Button>
            </Form>
          ) : (
            <div role="status" className="flex flex-col items-center gap-3 py-4 text-center">
              <span className="badge-pop grid size-14 place-items-center rounded-full bg-[var(--text-success)] text-canvas">
                <CheckIcon size={26} />
              </span>
              <p className="font-display text-[22px] text-primary">Request sent</p>
              <p className="max-w-[36ch] text-[14px] text-secondary">
                {authorName} will see it in their Activity. You’ll hear back here when they answer.
              </p>
              <Button variant="secondary" onPress={() => setOpen(false)}>
                Done
              </Button>
            </div>
          )}
        </div>
      </Sheet>
      <SignupPrompt isOpen={join} onClose={() => setJoin(false)} action="contribute" />
    </>
  )
}

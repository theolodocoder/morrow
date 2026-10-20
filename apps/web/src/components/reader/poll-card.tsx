'use client'
import { useEffect, useState } from 'react'
import type { Poll } from '@morrow/contracts'
import { SignupPrompt } from '@/components/public/signup-wall'
import { CheckIcon } from '@/components/ui/icons'
import { api, ClientApiError } from '@/lib/client-api'

/**
 * The writer's "what if" at the end of a chapter (P-062). Tap an answer to vote; the bars fill in once you have
 * (counts stay hidden until then, so early votes don't steer later ones). You can change your vote while it's open.
 */
export function PollCard({ publicPath, chapterSlug }: { publicPath: string; chapterSlug: string }) {
  const [poll, setPoll] = useState<Poll | null>(null)
  const [join, setJoin] = useState(false)
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    void api<{ poll: Poll | null }>(`/public/reading/${publicPath}/chapters/${chapterSlug}/poll`).then(
      (r) => setPoll(r.poll),
      () => {},
    )
  }, [publicPath, chapterSlug])
  if (!poll) return null

  async function vote(option: number) {
    setBusy(true)
    try {
      setPoll(
        await api<Poll>(`/reading/${publicPath}/chapters/${chapterSlug}/poll/vote`, {
          method: 'POST',
          body: { option },
        }),
      )
    } catch (e) {
      if (e instanceof ClientApiError && e.status === 401) setJoin(true)
    } finally {
      setBusy(false)
    }
  }

  const shown = poll.options.some((o) => o.votes !== null)
  const total = Math.max(1, poll.total)
  return (
    <section aria-labelledby="poll-q" className="mt-12 rounded-xl border border-subtle bg-app p-5 font-ui">
      <p className="font-mono text-[11px] uppercase tracking-[0.1em] text-accent">
        What if · {poll.closed ? 'closed' : 'the writer asks'}
      </p>
      <h2 id="poll-q" className="mt-1 font-display text-[24px] leading-tight text-primary">
        {poll.question}
      </h2>
      <ul className="mt-4 flex flex-col gap-2">
        {poll.options.map((o, i) => {
          const share = o.votes === null ? 0 : Math.round((o.votes / total) * 100)
          const mine = poll.myVote === i
          return (
            <li key={o.label}>
              <button
                type="button"
                disabled={poll.closed || busy}
                aria-pressed={mine}
                onClick={() => void vote(i)}
                className={`press relative flex w-full items-center justify-between overflow-hidden rounded-lg border px-4 py-3 text-left text-[15px] outline-none transition-colors focus-visible:ring-2 focus-visible:ring-focus disabled:cursor-default ${mine ? 'border-action text-primary' : 'border-control text-primary hover:border-action'}`}
              >
                {shown && (
                  <span
                    aria-hidden="true"
                    className="poll-fill absolute inset-y-0 left-0 bg-selected"
                    style={{ width: `${share}%` }}
                  />
                )}
                <span className="relative flex items-center gap-2">
                  {mine && <CheckIcon size={15} className="text-accent" />}
                  {o.label}
                </span>
                {shown && <span className="relative tabular-nums text-secondary">{share}%</span>}
              </button>
            </li>
          )
        })}
      </ul>
      <p className="mt-3 text-[12px] text-tertiary">
        {shown
          ? `${poll.total} ${poll.total === 1 ? 'vote' : 'votes'}${poll.closed ? '' : ' · you can change yours'}`
          : 'Vote to see how others answered.'}
      </p>
      <SignupPrompt isOpen={join} onClose={() => setJoin(false)} action="vote" />
    </section>
  )
}

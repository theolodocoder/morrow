'use client'
import Link from 'next/link'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import type { ProposalDetail } from '@morrow/contracts'
import type { BlockChange } from '@morrow/editor'
import { Button } from '@/components/ui/button'
import { InlineAlert } from '@/components/ui/inline-alert'
import { ConnectionStatus } from '@/components/editor/connection-status'
import { ManuscriptCanvas } from '@/components/editor/manuscript-canvas'
import { useCollab } from '@/components/editor/use-collab'
import { api, ClientApiError, newIdempotencyKey } from '@/lib/client-api'
import { presenceColor, type PresenceUser } from '@/lib/presence'
import { routes } from '@/lib/routes'
import { DiffView } from '@/components/diff/diff-view'
import { ReportButton } from '@/components/safety/report-dialog'
import { Avatar } from '@/components/profile/avatar'
import { KIND_LABEL, STATUS_LABEL, StatusPill } from './labels'
import {
  ArrowLeftIcon,
  CheckIcon,
  CloseIcon,
  CommentIcon,
  PencilIcon,
  ReopenIcon,
  ResolveIcon,
} from '@/components/ui/icons'

type Action = ProposalDetail['actions'][number]
const when = new Intl.DateTimeFormat('en', {
  day: 'numeric',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit',
})

/**
 * One proposal (PRD FR-014/015). The author writes in a private copy of the chapter until they submit; reviewers
 * compare, discuss and decide. Every button shown comes from the server's `actions` list.
 */
export function ProposalView({
  initial,
  chapterNumber,
  collabUrl,
  user,
}: {
  initial: ProposalDetail
  chapterNumber: number
  collabUrl: string
  user: { id: string; name: string }
}) {
  const router = useRouter()
  const [p, setP] = useState(initial)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<Action | 'save' | null>(null)
  const [confirmAccept, setConfirmAccept] = useState(false)
  const [reference, setReference] = useState<number | null>(null)
  const note = useRef<HTMLTextAreaElement>(null)
  useEffect(() => setP(initial), [initial])

  const can = (a: Action) => p.actions.includes(a)
  const writing = p.kind === 'edit' && can('edit') && !!p.workspaceDocumentId
  const isAuthor = p.author.id === user.id

  async function run(action: Action, path: string, body: object = {}, headers?: Record<string, string>) {
    setBusy(action)
    setError(null)
    try {
      const next = await api<ProposalDetail>(`/proposals/${p.id}/${path}`, {
        method: 'POST',
        body,
        ...(headers ? { headers } : {}),
      })
      setP(next)
      setConfirmAccept(false)
      if (note.current) note.current.value = ''
      router.refresh()
    } catch (e) {
      setError(
        e instanceof ClientApiError && e.problem.type?.endsWith('/proposal-conflict')
          ? 'The chapter changed in the same places as this proposal, so it can’t be applied as is. Ask the author to update it with the latest text.'
          : e instanceof Error
            ? e.message
            : 'That didn’t work.',
      )
    } finally {
      setBusy(null)
    }
  }
  const noteText = () => note.current?.value.trim() ?? ''

  async function refresh() {
    setBusy('refresh')
    setError(null)
    try {
      const r = await api<{ reference: unknown[] }>(`/proposals/${p.id}/refresh`, { method: 'POST' })
      setReference(r.reference.length)
      setP(await api<ProposalDetail>(`/proposals/${p.id}`))
    } catch (e) {
      setError(e instanceof Error ? e.message : 'That didn’t work.')
    } finally {
      setBusy(null)
    }
  }

  async function saveDetails(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const f = new FormData(e.currentTarget)
    setBusy('save')
    setError(null)
    try {
      setP(
        await api<ProposalDetail>(`/proposals/${p.id}`, {
          method: 'PATCH',
          body: {
            title: String(f.get('title') ?? ''),
            explanation: String(f.get('explanation') ?? ''),
            ...(p.kind !== 'edit' ? { body: String(f.get('body') ?? '') } : {}),
          },
        }),
      )
    } catch (err) {
      setError(err instanceof Error ? err.message : 'That didn’t save.')
    } finally {
      setBusy(null)
    }
  }

  const classification = p.review?.classification
  const conflict = classification?.kind === 'conflict'

  return (
    <div className="flex min-h-dvh flex-col bg-app lg:h-dvh">
      <header className="flex h-12 shrink-0 items-center gap-2 border-b border-subtle bg-canvas px-2">
        <Link
          href={p.viewerSeesDrafts ? routes.proposals(p.workId) : routes.suggestions}
          aria-label={p.viewerSeesDrafts ? 'Back to proposals' : 'Back to your suggestions'}
          className="press inline-flex h-9 items-center gap-1.5 rounded-full px-2.5 text-sm text-secondary hover:bg-hover hover:text-primary"
        >
          <ArrowLeftIcon size={18} />
          <span className="hidden sm:inline">{p.viewerSeesDrafts ? 'Proposals' : 'Your suggestions'}</span>
        </Link>
        <span aria-hidden="true" className="hidden h-5 w-px bg-[var(--border-subtle)] sm:block" />
        <p className="min-w-0 flex-1 truncate text-sm font-medium">{p.title}</p>
        <StatusPill status={p.status} />
      </header>

      <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
        <main id="main" className="min-w-0 flex-1 overflow-y-auto bg-canvas">
          <div className="mx-auto max-w-[68ch] px-5 pt-8">
            <p className="font-mono text-[11px] uppercase tracking-[0.08em] text-tertiary">
              {KIND_LABEL[p.kind]}
              {p.chapter ? ` · ${p.chapter.title}` : ''}
            </p>
            {writing ? (
              <p className="mt-2 text-[13px] text-secondary">
                {p.viewerSeesDrafts
                  ? 'You’re writing in a private copy of this chapter. Nothing changes in the work until a reviewer accepts it.'
                  : 'You’re editing a private copy of the published chapter. The writer reviews your suggestion; nothing changes until they accept it.'}
              </p>
            ) : null}
          </div>
          {writing ? (
            <Workspace
              documentId={p.workspaceDocumentId!}
              collabUrl={collabUrl}
              user={user}
              workId={p.workId}
              title={p.chapter?.title ?? p.title}
              chapterNumber={chapterNumber}
            />
          ) : p.kind === 'edit' && p.review ? (
            <div className="mx-auto max-w-[68ch] px-5 pb-24 pt-6">
              <DiffView
                changes={p.review.changes as BlockChange[]}
                chapterVersions={p.review.chapterVersions}
              />
            </div>
          ) : (
            <NoteBody p={p} />
          )}
        </main>

        <aside
          aria-label="Proposal details"
          className="flex w-full shrink-0 flex-col gap-6 overflow-y-auto border-t border-subtle bg-sidebar p-5 lg:w-[380px] lg:border-l lg:border-t-0"
        >
          {error && <InlineAlert>{error}</InlineAlert>}

          <Progress status={p.status} />

          <section className="flex items-center gap-3 text-[13px] text-secondary">
            <Avatar name={p.author.name} seed={p.author.id} size={36} />
            <div className="min-w-0">
              <p>
                By <span className="text-primary">{isAuthor ? 'you' : p.author.name}</span>
                {p.submittedAt
                  ? ` · submitted ${when.format(new Date(p.submittedAt))}`
                  : ` · started ${when.format(new Date(p.createdAt))}`}
              </p>
              {p.reviewer && (
                <p>
                  Reviewer:{' '}
                  <span className="text-primary">{p.reviewer.id === user.id ? 'you' : p.reviewer.name}</span>
                </p>
              )}
            </div>
          </section>

          {classification && (
            <section
              role="status"
              className={`flex gap-2.5 rounded-md border-l-[3px] bg-canvas p-3 text-[13px] ${conflict ? 'border-[var(--text-warning)]' : 'border-[var(--text-success)]'}`}
            >
              <span
                aria-hidden="true"
                className={`mt-px shrink-0 ${conflict ? 'text-warning' : 'text-success'}`}
              >
                {conflict ? <BranchGlyph /> : <ResolveIcon size={16} />}
              </span>
              <div>
                {conflict ? (
                  <>
                    <p className="font-medium text-primary">Overlaps with newer changes</p>
                    <p className="mt-1 text-secondary">
                      The chapter changed in {classification.blockIds.length || 'some'} of the same places
                      since this proposal started.
                      {isAuthor
                        ? ' Update it with the latest text, then check the marked paragraphs.'
                        : ' Compare the marked paragraphs below with the chapter’s current text: ask for changes, or accept using their wording there.'}
                    </p>
                  </>
                ) : (
                  <p className="text-secondary">
                    <span className="font-medium text-primary">Applies cleanly.</span>{' '}
                    {classification.kind === 'fast-forward'
                      ? 'The chapter hasn’t changed since this started.'
                      : 'The chapter changed elsewhere; both sets of changes will be kept.'}
                  </p>
                )}
              </div>
            </section>
          )}

          {reference !== null && (
            <p role="status" className="text-[13px] text-secondary">
              {reference
                ? `Updated. ${reference} paragraph${reference === 1 ? ' was' : 's were'} changed in both places: your version is kept; compare it with the chapter before submitting.`
                : 'Updated with the latest chapter text.'}
            </p>
          )}

          {(can('edit') || p.explanation) && (
            <section className="flex flex-col gap-3">
              {can('edit') ? (
                <form onSubmit={saveDetails} className="flex flex-col gap-3">
                  <label className="flex flex-col gap-1.5">
                    <span className="text-sm font-medium text-primary">Title</span>
                    <input
                      name="title"
                      defaultValue={p.title}
                      required
                      maxLength={200}
                      className="h-10 rounded-md border border-control bg-canvas px-3 text-base text-primary outline-none focus:ring-2 focus:ring-focus"
                    />
                  </label>
                  <label className="flex flex-col gap-1.5">
                    <span className="text-sm font-medium text-primary">Why</span>
                    <textarea
                      name="explanation"
                      defaultValue={p.explanation}
                      rows={3}
                      maxLength={4000}
                      className="rounded-md border border-control bg-canvas px-3 py-2 text-base text-primary outline-none focus:ring-2 focus:ring-focus"
                    />
                  </label>
                  {p.kind !== 'edit' && (
                    <label className="flex flex-col gap-1.5">
                      <span className="text-sm font-medium text-primary">{KIND_LABEL[p.kind]}</span>
                      <textarea
                        name="body"
                        defaultValue={p.body}
                        rows={10}
                        maxLength={20000}
                        className="rounded-md border border-control bg-canvas px-3 py-2 font-manuscript text-base text-primary outline-none focus:ring-2 focus:ring-focus"
                      />
                    </label>
                  )}
                  <Button type="submit" variant="secondary" isDisabled={busy !== null}>
                    {busy === 'save' ? 'Saving…' : 'Save details'}
                  </Button>
                </form>
              ) : (
                <div>
                  <p className="text-[12px] font-medium uppercase tracking-[0.08em] text-tertiary">Why</p>
                  <p className="mt-1 whitespace-pre-line text-sm text-primary">{p.explanation}</p>
                </div>
              )}
            </section>
          )}

          {/* Author actions */}
          {(can('submit') || can('refresh') || can('withdraw')) && (
            <section className="flex flex-col gap-2">
              {can('submit') && (
                <Button
                  variant="primary"
                  isDisabled={busy !== null}
                  onPress={() => void run('submit', 'submit')}
                >
                  <CheckIcon size={16} />
                  {busy === 'submit'
                    ? 'Submitting…'
                    : p.status === 'changes_requested'
                      ? 'Resubmit for review'
                      : 'Submit for review'}
                </Button>
              )}
              {can('refresh') && p.kind === 'edit' && (
                <Button variant="secondary" isDisabled={busy !== null} onPress={() => void refresh()}>
                  <ReopenIcon size={16} />
                  {busy === 'refresh' ? 'Updating…' : 'Update with latest chapter text'}
                </Button>
              )}
              {can('withdraw') && (
                <Button
                  variant="quiet"
                  isDisabled={busy !== null}
                  onPress={() => void run('withdraw', 'withdraw')}
                >
                  <CloseIcon size={16} />
                  Withdraw
                </Button>
              )}
            </section>
          )}

          {/* Reviewer actions */}
          {(can('accept') || can('request_changes') || can('reject')) && (
            <section className="flex flex-col gap-2">
              <label className="flex flex-col gap-1.5">
                <span className="text-sm font-medium text-primary">Note to {p.author.name} (optional)</span>
                <textarea
                  ref={note}
                  rows={3}
                  maxLength={4000}
                  className="rounded-md border border-control bg-canvas px-3 py-2 text-base text-primary outline-none focus:ring-2 focus:ring-focus"
                />
              </label>
              {confirmAccept ? (
                <div className="popover rounded-md border border-subtle bg-canvas p-3 shadow-sm">
                  <p className="text-sm text-primary">
                    {conflict
                      ? `Apply it using ${p.author.name}’s wording in the ${classification.blockIds.length || ''} paragraph(s) you both changed (shown above, with the chapter’s current text)? Your other changes stay. ${p.author.name} is credited.`
                      : p.kind === 'edit'
                        ? `Apply these changes to “${p.chapter?.title}”? Writers in the chapter will see them straight away. ${p.author.name} is credited.`
                        : `Accept this ${KIND_LABEL[p.kind].toLowerCase()}? ${p.author.name} is credited.`}
                  </p>
                  <div className="mt-3 flex justify-end gap-2">
                    <Button variant="quiet" onPress={() => setConfirmAccept(false)}>
                      Back
                    </Button>
                    <Button
                      variant="primary"
                      isDisabled={busy !== null}
                      onPress={() =>
                        void run(
                          'accept',
                          'accept',
                          // A conflict is only ever resolved by this explicit choice, never silently.
                          conflict ? { note: noteText(), resolve: 'use_proposal' } : { note: noteText() },
                          { 'idempotency-key': newIdempotencyKey() },
                        )
                      }
                    >
                      {busy === 'accept' ? 'Accepting…' : 'Accept'}
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="flex flex-wrap gap-2">
                  {can('accept') && (
                    <Button
                      variant="primary"
                      isDisabled={busy !== null}
                      onPress={() => setConfirmAccept(true)}
                    >
                      <CheckIcon size={16} />
                      {conflict ? 'Accept using their wording…' : 'Accept…'}
                    </Button>
                  )}
                  {can('request_changes') && (
                    <Button
                      variant="secondary"
                      isDisabled={busy !== null}
                      onPress={() => void run('request_changes', 'request-changes', { note: noteText() })}
                    >
                      <PencilIcon size={16} />
                      Request changes
                    </Button>
                  )}
                  {can('reject') && (
                    <Button
                      variant="quiet"
                      isDisabled={busy !== null}
                      onPress={() => void run('reject', 'reject', { note: noteText() })}
                    >
                      <CloseIcon size={16} />
                      Reject
                    </Button>
                  )}
                </div>
              )}
              {can('start_review') && (
                <StartReview onStart={() => void run('start_review', 'start-review')} />
              )}
            </section>
          )}

          {!isAuthor && (
            <ReportButton target={{ type: 'proposal', proposalId: p.id }} label="Report this proposal" />
          )}
          <Timeline
            p={p}
            meId={user.id}
            onComment={can('comment') ? (body) => run('comment', 'comments', { body }) : undefined}
          />
        </aside>
      </div>
    </div>
  )
}

/**
 * Where the proposal is on its way, as four stops. Decorative (the status pill in the header says it in words), so
 * its labels avoid the status names themselves.
 */
const STOPS = ['Drafted', 'Sent', 'Reviewed', 'Decided'] as const
function Progress({ status }: { status: ProposalDetail['status'] }) {
  const at =
    status === 'draft'
      ? 0
      : status === 'submitted'
        ? 1
        : status === 'under_review' || status === 'changes_requested'
          ? 2
          : 3
  const ended = status === 'rejected' || status === 'withdrawn' || status === 'superseded'
  return (
    <ol aria-hidden="true" className="grid grid-cols-4">
      {STOPS.map((label, i) => (
        <li key={label} className="relative flex flex-col items-center gap-1.5">
          {i > 0 && (
            <span
              className={`absolute right-1/2 top-[7px] h-0.5 w-full origin-left ${i <= at ? 'progress-line bg-action' : 'bg-[var(--border-subtle)]'}`}
            />
          )}
          <span
            className={`relative z-10 grid size-4 place-items-center rounded-full border-2 ${i < at || (i === at && i === 3 && !ended) ? 'border-[var(--action-primary-bg)] bg-action text-action-fg' : i === at ? 'border-[var(--action-primary-bg)] bg-canvas' : 'border-[var(--border-control)] bg-canvas'}`}
          >
            {i === at && i < 3 && <span className="badge-pop size-1.5 rounded-full bg-action" />}
          </span>
          <span className={`text-[11px] ${i <= at ? 'text-primary' : 'text-tertiary'}`}>{label}</span>
        </li>
      ))}
    </ol>
  )
}

/** Two lines meeting: the same places changed on both sides. */
const BranchGlyph = () => (
  <svg
    viewBox="0 0 20 20"
    width="16"
    height="16"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.5"
    strokeLinecap="round"
  >
    <path d="M4 4v4c0 3 3 4 6 4s6 1 6 4M16 4v4c0 3-3 4-6 4" />
  </svg>
)

/** A reviewer opening a submitted proposal marks it "In review", so the author knows someone is looking. */
function StartReview({ onStart }: { onStart: () => void }) {
  const started = useRef(false)
  useEffect(() => {
    if (started.current) return
    started.current = true
    onStart()
  }, [onStart])
  return null
}

function Workspace({
  documentId,
  collabUrl,
  user,
  workId,
  title,
  chapterNumber,
}: {
  documentId: string
  collabUrl: string
  user: { id: string; name: string }
  workId: string
  title: string
  chapterNumber: number
}) {
  const me: PresenceUser = useMemo(
    () => ({ id: user.id, name: user.name, color: presenceColor(user.id, workId) }),
    [user.id, user.name, workId],
  )
  const collab = useCollab(documentId, collabUrl, me)
  return (
    <div>
      <div className="mx-auto flex max-w-[68ch] justify-end px-5">
        {collab && <ConnectionStatus status={collab.status} />}
      </div>
      {collab?.synced ? (
        <ManuscriptCanvas
          key={documentId}
          collab={collab}
          chapterTitle={title}
          chapterNumber={chapterNumber}
          me={me}
        />
      ) : (
        <p className="mx-auto max-w-[68ch] px-5 pt-16 font-manuscript italic text-tertiary">
          Opening your copy…
        </p>
      )}
    </div>
  )
}

function NoteBody({ p }: { p: ProposalDetail }) {
  return (
    <div className="mx-auto max-w-[68ch] px-5 pb-24 pt-6">
      <h1 className="font-display text-[32px] leading-tight text-primary">{p.title}</h1>
      {p.body ? (
        <p className="mt-6 whitespace-pre-line font-manuscript text-[18px] leading-relaxed text-primary">
          {p.body}
        </p>
      ) : (
        <p className="mt-6 font-manuscript italic text-tertiary">
          {p.actions.includes('edit') ? 'Write it in the panel, then submit.' : 'Nothing written yet.'}
        </p>
      )}
    </div>
  )
}

function Timeline({
  p,
  meId,
  onComment,
}: {
  p: ProposalDetail
  meId: string
  onComment?: (body: string) => Promise<void>
}) {
  const [text, setText] = useState('')
  if (!p.events.length && !onComment) return null
  return (
    <section aria-labelledby="history" className="flex flex-col gap-3">
      <h2 id="history" className="text-[12px] font-medium uppercase tracking-[0.08em] text-tertiary">
        History
      </h2>
      <ol className="relative flex flex-col gap-4 before:absolute before:bottom-2 before:left-[13px] before:top-2 before:w-px before:bg-[var(--border-subtle)]">
        {p.events.map((e) => (
          <li key={e.id} className="relative flex gap-3 text-[13px]">
            <span className="relative z-10 shrink-0 rounded-full ring-4 ring-[var(--bg-sidebar)]">
              {e.type === 'comment' ? (
                <Avatar name={e.actor.name} seed={e.actor.id} size={26} />
              ) : (
                <span
                  aria-hidden="true"
                  className={`grid size-[26px] place-items-center rounded-full ${e.toStatus === 'accepted' ? 'bg-[var(--text-success)] text-canvas' : e.toStatus === 'rejected' || e.toStatus === 'changes_requested' ? 'bg-[var(--text-warning)] text-canvas' : 'bg-selected text-accent'}`}
                >
                  {e.toStatus === 'accepted' ? (
                    <CheckIcon size={13} />
                  ) : e.toStatus === 'rejected' ? (
                    <CloseIcon size={13} />
                  ) : (
                    <span className="size-2 rounded-full bg-current" />
                  )}
                </span>
              )}
            </span>
            <div className="min-w-0 flex-1 pt-1">
              <p className="text-secondary">
                <span className="text-primary">{e.actor.id === meId ? 'You' : e.actor.name}</span>{' '}
                {e.type === 'comment'
                  ? 'commented'
                  : e.fromStatus === e.toStatus
                    ? 'updated it'
                    : `→ ${STATUS_LABEL[e.toStatus!]}`}
                <span className="text-tertiary"> · {when.format(new Date(e.createdAt))}</span>
              </p>
              {e.body && (
                <p className="mt-1.5 whitespace-pre-line rounded-md rounded-tl-none border border-subtle bg-canvas px-3 py-2 text-primary">
                  {e.body}
                </p>
              )}
            </div>
          </li>
        ))}
      </ol>
      {onComment && (
        <form
          onSubmit={(e) => {
            e.preventDefault()
            if (!text.trim()) return
            void onComment(text).then(() => setText(''))
          }}
          className="flex flex-col gap-2"
        >
          <label className="sr-only" htmlFor="comment">
            Add a comment
          </label>
          <textarea
            id="comment"
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={2}
            maxLength={4000}
            placeholder="Add a comment"
            className="rounded-md border border-control bg-canvas px-3 py-2 text-base text-primary outline-none placeholder:text-tertiary focus:ring-2 focus:ring-focus"
          />
          <div className="flex justify-end">
            <Button type="submit" size="sm" variant="secondary" isDisabled={!text.trim()}>
              <CommentIcon size={16} />
              Comment
            </Button>
          </div>
        </form>
      )}
    </section>
  )
}

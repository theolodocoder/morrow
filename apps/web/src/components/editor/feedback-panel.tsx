'use client'
import { useCallback, useEffect, useMemo, useState } from 'react'
import type { Editor } from '@tiptap/react'
import {
  REACTION_LABELS,
  type Comment,
  type CommentThread,
  type ReactionKind,
  type ReactionsSummary,
} from '@morrow/contracts'
import { Button } from '@/components/ui/button'
import { InlineAlert } from '@/components/ui/inline-alert'
import { api } from '@/lib/client-api'
import { setFeedback, type FeedbackStorage } from './feedback-highlights'
import type { CommentDraft } from './manuscript-canvas'
import type { Collab } from './use-collab'
import { MentionField } from './mention-field'
import { ReportButton } from '@/components/safety/report-dialog'
import {
  CheckIcon,
  CommentIcon,
  PencilIcon,
  ReopenIcon,
  ReplyIcon,
  ResolveIcon,
  TrashIcon,
} from '@/components/ui/icons'

const when = new Intl.DateTimeFormat('en', {
  day: 'numeric',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit',
})
const storageOf = (editor: Editor) =>
  (editor.storage as unknown as { feedbackHighlights: FeedbackStorage }).feedbackHighlights

/**
 * Comments and reactions on this chapter (PRD FR-016/017). Opened deliberately, so feedback never interrupts
 * writing. Threads follow their passages through edits; one whose passage is gone is listed as detached.
 */
export function FeedbackPanel({
  workId,
  documentId,
  editor,
  collab,
  draft,
  onDraftDone,
  meId,
}: {
  workId: string
  documentId: string
  editor: Editor | null
  collab: Collab
  draft: CommentDraft | null
  onDraftDone: () => void
  meId: string
}) {
  const [threads, setThreads] = useState<CommentThread[]>([])
  const [canComment, setCanComment] = useState(false)
  const [reactions, setReactions] = useState<ReactionsSummary | null>(null)
  const [positions, setPositions] = useState<Map<string, { from: number; to: number } | null>>(new Map())
  const [activeId, setActiveId] = useState<string | null>(null)
  const [showResolved, setShowResolved] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const loadComments = useCallback(async () => {
    const r = await api<{ items: CommentThread[]; canComment: boolean }>(`/documents/${documentId}/comments`)
    setThreads(r.items)
    setCanComment(r.canComment)
    setError(null)
  }, [documentId])
  const loadReactions = useCallback(
    async () => setReactions(await api<ReactionsSummary>(`/documents/${documentId}/reactions`)),
    [documentId],
  )

  // Subscribe through the stable `onFeedback`: the collab object itself changes with every save-status flip.
  const onFeedback = collab.onFeedback
  useEffect(() => {
    void loadComments().catch(() => setError('Couldn’t load comments.'))
    void loadReactions().catch(() => {})
    // Live: collab tells every reader of this chapter when feedback changes.
    return onFeedback((what) => void (what === 'comments' ? loadComments() : loadReactions()).catch(() => {}))
  }, [onFeedback, loadComments, loadReactions])

  // Draw highlights and chips in the manuscript while the panel is open.
  useEffect(() => {
    if (!editor) return
    const storage = storageOf(editor)
    storage.onActivate = (id) => setActiveId(id)
    storage.onPositions = (p) => setPositions(new Map(p))
    const chips: Record<string, string> = {}
    for (const [blockId, counts] of Object.entries(reactions?.counts ?? {}))
      chips[blockId] = Object.entries(counts)
        .map(([k, n]) => `${REACTION_LABELS[k as ReactionKind]} ${n}`)
        .join(' · ')
    setFeedback(editor.view, storage, {
      show: true,
      activeId,
      threads: threads.map((t) => ({ id: t.id, anchor: t.anchor, resolved: !!t.resolved })),
      reactions: chips,
    })
  }, [editor, threads, reactions, activeId])
  useEffect(
    () => () => {
      if (editor && !editor.isDestroyed) setFeedback(editor.view, storageOf(editor), { show: false })
    },
    [editor],
  )

  const act = async (fn: () => Promise<unknown>) => {
    setError(null)
    try {
      await fn()
      await loadComments()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'That didn’t work.')
    }
  }

  const jump = (t: CommentThread) => {
    setActiveId(t.id)
    const r = positions.get(t.id)
    if (editor && r) editor.chain().setTextSelection(r).scrollIntoView().run()
  }

  // Reading order for anchored threads; detached ones (passage gone) last, clearly marked.
  const { open, detached, resolved } = useMemo(() => {
    const live = threads.filter((t) => !t.resolved)
    const pos = (t: CommentThread) => positions.get(t.id)?.from ?? Infinity
    return {
      open: live.filter((t) => positions.get(t.id) !== null).sort((a, b) => pos(a) - pos(b)),
      detached: live.filter((t) => positions.get(t.id) === null),
      resolved: threads.filter((t) => t.resolved),
    }
  }, [threads, positions])

  return (
    <div className="flex h-full flex-col overflow-y-auto p-4">
      <h2 className="mb-3 font-mono text-[11px] uppercase tracking-[0.08em] text-tertiary">Feedback</h2>
      {error && <InlineAlert>{error}</InlineAlert>}

      {draft && canComment && (
        <NewComment
          workId={workId}
          draft={draft}
          onCancel={onDraftDone}
          onSave={(body) =>
            act(async () => {
              const t = await api<CommentThread>(`/documents/${documentId}/comments`, {
                method: 'POST',
                body: { body, anchor: { ...draft.anchor, quote: draft.quote, blockId: draft.blockId } },
              })
              setActiveId(t.id)
              onDraftDone()
            })
          }
        />
      )}

      <section aria-label="Comments" className="flex flex-col gap-3">
        {open.length === 0 && detached.length === 0 && !draft && (
          <p className="text-[13px] text-secondary">
            {canComment ? 'No open comments. Select a passage and choose Comment.' : 'No open comments.'}
          </p>
        )}
        {open.map((t) => (
          <Thread
            workId={workId}
            key={t.id}
            t={t}
            meId={meId}
            active={t.id === activeId}
            onJump={() => jump(t)}
            act={act}
            canReply={canComment}
          />
        ))}
        {detached.length > 0 && (
          <>
            <p className="mt-2 text-[12px] font-medium text-primary">
              Detached: the passage was changed or removed
            </p>
            {detached.map((t) => (
              <Thread
                workId={workId}
                key={t.id}
                t={t}
                meId={meId}
                active={t.id === activeId}
                detached
                act={act}
                canReply={canComment}
              />
            ))}
          </>
        )}
        {resolved.length > 0 && (
          <button
            type="button"
            onClick={() => setShowResolved((v) => !v)}
            aria-expanded={showResolved}
            className="self-start text-[13px] text-accent underline underline-offset-2"
          >
            {showResolved ? 'Hide' : 'Show'} {resolved.length} resolved
          </button>
        )}
        {showResolved &&
          resolved.map((t) => (
            <Thread
              workId={workId}
              key={t.id}
              t={t}
              meId={meId}
              active={false}
              act={act}
              canReply={canComment}
            />
          ))}
      </section>

      {reactions && reactions.kinds.length > 0 && (
        <Reactions
          summary={reactions}
          editor={editor}
          onToggle={async (blockId, kind, on) => {
            setError(null)
            try {
              setReactions(
                await api<ReactionsSummary>(`/documents/${documentId}/reactions`, {
                  method: on ? 'PUT' : 'DELETE',
                  body: { blockId, kind },
                }),
              )
            } catch (e) {
              setError(e instanceof Error ? e.message : 'That didn’t work.')
            }
          }}
        />
      )}
    </div>
  )
}

const field =
  'w-full rounded-sm border border-control bg-canvas px-2 py-1.5 text-[15px] text-primary outline-none placeholder:text-tertiary focus:ring-2 focus:ring-focus'
const iconAction =
  'inline-flex items-center gap-1 rounded-sm px-1.5 py-0.5 text-[12px] text-secondary outline-none hover:bg-hover hover:text-primary focus-visible:ring-2 focus-visible:ring-focus'

function NewComment({
  workId,
  draft,
  onSave,
  onCancel,
}: {
  workId: string
  draft: CommentDraft
  onSave: (body: string) => Promise<void>
  onCancel: () => void
}) {
  const [body, setBody] = useState('')
  const save = () => body.trim() && void onSave(body)
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        save()
      }}
      className="mb-4 flex flex-col gap-2 rounded-sm border border-control bg-canvas p-3"
    >
      <blockquote className="border-l-2 border-ornament pl-2 font-manuscript text-[14px] italic text-secondary">
        {draft.quote}
      </blockquote>
      <label htmlFor="new-comment" className="sr-only">
        Your comment
      </label>
      <MentionField
        workId={workId}
        id="new-comment"
        autoFocus
        value={body}
        onChange={setBody}
        placeholder="Your comment. Type @ to mention someone."
        className={field}
        onSubmitShortcut={save}
      />
      <div className="flex justify-end gap-2">
        <Button size="sm" variant="quiet" onPress={onCancel}>
          Cancel
        </Button>
        <Button size="sm" type="submit" variant="primary" isDisabled={!body.trim()}>
          <CommentIcon size={16} />
          Comment
        </Button>
      </div>
    </form>
  )
}

function Body({ c }: { c: Comment }) {
  if (c.deleted) return <p className="text-[13px] italic text-tertiary">Comment deleted</p>
  const names = new Set(c.mentions.map((m) => m.username))
  return (
    <p className="whitespace-pre-line text-[14px] text-primary">
      {c.body.split(/(@[a-z0-9_]{3,30})/gi).map((part, i) =>
        part.startsWith('@') && names.has(part.slice(1).toLowerCase()) ? (
          <span key={i} className="rounded-sm bg-selected px-0.5 font-medium text-accent">
            {part}
          </span>
        ) : (
          <span key={i}>{part}</span>
        ),
      )}
    </p>
  )
}

function Thread({
  workId,
  t,
  meId,
  active,
  detached,
  onJump,
  act,
  canReply,
}: {
  workId: string
  t: CommentThread
  meId: string
  active: boolean
  detached?: boolean
  onJump?: () => void
  act: (fn: () => Promise<unknown>) => Promise<void>
  canReply: boolean
}) {
  const [reply, setReply] = useState('')
  const [editing, setEditing] = useState<string | null>(null)
  const [draft, setDraft] = useState('')
  const sendReply = () => {
    if (reply.trim())
      void act(() => api(`/comments/${t.id}/replies`, { method: 'POST', body: { body: reply } })).then(() =>
        setReply(''),
      )
  }
  return (
    <article
      aria-label={`Comment on “${t.anchor.quote.slice(0, 40)}”`}
      className={`rounded-sm border bg-canvas p-3 ${active ? 'border-action' : 'border-subtle'}`}
    >
      <button type="button" onClick={onJump} disabled={!onJump} className="mb-2 block w-full text-left">
        <blockquote
          className={`border-l-2 pl-2 font-manuscript text-[13px] italic ${detached ? 'border-[var(--text-warning)] text-tertiary line-through' : 'border-ornament text-secondary'}`}
        >
          {t.anchor.quote || '…'}
        </blockquote>
      </button>
      <ol className="flex flex-col gap-2.5">
        {t.comments.map((c) => (
          <li key={c.id}>
            <p className="text-[12px] text-secondary">
              <span className="font-medium text-primary">{c.author.id === meId ? 'You' : c.author.name}</span>{' '}
              · {when.format(new Date(c.createdAt))}
              {c.editedAt && ' · edited'}
            </p>
            {editing === c.id ? (
              <form
                onSubmit={(e) => {
                  e.preventDefault()
                  void act(() => api(`/comments/${c.id}`, { method: 'PATCH', body: { body: draft } })).then(
                    () => setEditing(null),
                  )
                }}
                className="mt-1 flex flex-col gap-1"
              >
                <label htmlFor={`edit-${c.id}`} className="sr-only">
                  Edit comment
                </label>
                <MentionField
                  workId={workId}
                  id={`edit-${c.id}`}
                  value={draft}
                  onChange={setDraft}
                  rows={2}
                  className={field}
                />
                <div className="flex justify-end gap-1">
                  <Button size="sm" variant="quiet" onPress={() => setEditing(null)}>
                    Cancel
                  </Button>
                  <Button size="sm" type="submit" variant="secondary" isDisabled={!draft.trim()}>
                    <CheckIcon size={16} />
                    Save
                  </Button>
                </div>
              </form>
            ) : (
              <Body c={c} />
            )}
            {!c.deleted && c.author.id !== meId && editing !== c.id && (
              <div className="mt-0.5">
                <ReportButton compact target={{ type: 'comment', commentId: c.id }} />
              </div>
            )}
            {(c.canEdit || c.canDelete) && editing !== c.id && (
              <div className="mt-0.5 flex gap-1">
                {c.canEdit && (
                  <button
                    type="button"
                    className={iconAction}
                    onClick={() => {
                      setEditing(c.id)
                      setDraft(c.body)
                    }}
                  >
                    <PencilIcon size={14} />
                    Edit
                  </button>
                )}
                {c.canDelete && (
                  <button
                    type="button"
                    className={iconAction}
                    onClick={() => void act(() => api(`/comments/${c.id}`, { method: 'DELETE' }))}
                  >
                    <TrashIcon size={14} />
                    Delete
                  </button>
                )}
              </div>
            )}
          </li>
        ))}
      </ol>
      {t.resolved && (
        <p className="mt-2 inline-flex items-center gap-1 text-[12px] text-success">
          <ResolveIcon size={14} />
          Resolved by {t.resolved.by.id === meId ? 'you' : t.resolved.by.name}
        </p>
      )}
      <div className="mt-2 flex flex-col gap-2">
        {canReply && (
          <form
            onSubmit={(e) => {
              e.preventDefault()
              sendReply()
            }}
            className="flex items-start gap-2"
          >
            <label htmlFor={`reply-${t.id}`} className="sr-only">
              Reply
            </label>
            <div className="min-w-0 flex-1">
              <MentionField
                workId={workId}
                id={`reply-${t.id}`}
                multiline={false}
                value={reply}
                onChange={setReply}
                placeholder="Reply"
                className={`${field} h-8 py-0 text-[14px]`}
              />
            </div>
            <Button size="sm" type="submit" variant="secondary" isDisabled={!reply.trim()}>
              <ReplyIcon size={16} />
              Reply
            </Button>
          </form>
        )}
        {t.canResolve && (
          <Button
            size="sm"
            variant="quiet"
            className="self-start"
            onPress={() =>
              void act(() =>
                api(`/comments/${t.id}/${t.resolved ? 'reopen' : 'resolve'}`, { method: 'POST' }),
              )
            }
          >
            {t.resolved ? <ReopenIcon size={16} /> : <ResolveIcon size={16} />}
            {t.resolved ? 'Reopen' : 'Resolve'}
          </Button>
        )}
      </div>
    </article>
  )
}

/** Reactions per paragraph, listed accessibly (the chips in the margin are decorative). */
function Reactions({
  summary,
  editor,
  onToggle,
}: {
  summary: ReactionsSummary
  editor: Editor | null
  onToggle: (blockId: string, kind: ReactionKind, on: boolean) => void
}) {
  const textOf = (blockId: string) => {
    let text = ''
    editor?.state.doc.forEach((n) => {
      if (n.attrs.id === blockId) text = n.textContent
    })
    return text
  }
  const blocks = Object.entries(summary.counts)
  return (
    <section aria-labelledby="reactions-heading" className="mt-6 flex flex-col gap-2">
      <h3 id="reactions-heading" className="font-mono text-[11px] uppercase tracking-[0.08em] text-tertiary">
        Reactions
      </h3>
      {blocks.length === 0 ? (
        <p className="text-[13px] text-secondary">
          {summary.canReact ? 'None yet. Select a passage and choose React.' : 'None yet.'}
        </p>
      ) : (
        blocks.map(([blockId, counts]) => {
          const text = textOf(blockId)
          return (
            <div key={blockId} className="rounded-sm border border-subtle bg-canvas p-2">
              <p className="mb-1 truncate font-manuscript text-[13px] italic text-secondary">
                {text || 'A paragraph that was removed'}
              </p>
              <ul className="flex flex-wrap gap-1.5">
                {Object.entries(counts).map(([k, n]) => {
                  const kind = k as ReactionKind
                  const mine = summary.mine[blockId]?.includes(kind) ?? false
                  return (
                    <li key={k}>
                      <button
                        type="button"
                        aria-pressed={mine}
                        disabled={!summary.canReact}
                        onClick={() => onToggle(blockId, kind, !mine)}
                        className="rounded-full border border-subtle px-2 py-0.5 text-[12px] text-primary aria-pressed:border-action aria-pressed:bg-selected disabled:cursor-default"
                      >
                        {REACTION_LABELS[kind]} {n}
                        <span className="sr-only">{mine ? ', including you' : ''}</span>
                      </button>
                    </li>
                  )
                })}
              </ul>
            </div>
          )
        })
      )}
    </section>
  )
}

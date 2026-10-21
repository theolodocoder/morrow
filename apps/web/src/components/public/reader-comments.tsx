'use client'
import Link from 'next/link'
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { TextArea, TextField } from 'react-aria-components'
import type { ReaderComment, ReaderReply } from '@morrow/contracts'
import { Avatar } from '@/components/profile/avatar'
import { ReportButton } from '@/components/safety/report-dialog'
import { Button } from '@/components/ui/button'
import { InlineAlert } from '@/components/ui/inline-alert'
import { ReplyIcon, TrashIcon } from '@/components/ui/icons'
import { api, ClientApiError } from '@/lib/client-api'
import { timeAgo } from '@/lib/format'
import { routes } from '@/lib/routes'
import { SignupPrompt } from './signup-wall'

/** A chapter's discussion, or with `blockId` one paragraph's thread (P-054). */
export type Anchor = { chapterSlug: string; blockId?: string }
export type CommentList = {
  items: ReaderComment[]
  total: number
  nextCursor: string | null
  canComment: boolean
}

function Composer({
  publicPath,
  anchor,
  parentId,
  label,
  onPosted,
  onCancel,
  autoFocus,
  placeholder = 'What did it make you think or feel?',
}: {
  publicPath: string
  anchor?: Anchor | undefined
  parentId?: string
  label: string
  onPosted: () => void
  onCancel?: () => void
  autoFocus?: boolean
  placeholder?: string | undefined
}) {
  const [body, setBody] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  return (
    <form
      className="flex flex-col gap-2"
      onSubmit={async (e) => {
        e.preventDefault()
        if (!body.trim()) return
        setBusy(true)
        setError(null)
        try {
          await api(`/reading/${publicPath}/comments`, {
            method: 'POST',
            body: { body, ...(parentId ? { parentId } : {}), ...(anchor && !parentId ? anchor : {}) },
          })
          setBody('')
          onPosted()
        } catch (err) {
          setError(err instanceof ClientApiError ? (err.problem.detail ?? err.message) : 'That didn’t post.')
        } finally {
          setBusy(false)
        }
      }}
    >
      {error && <InlineAlert>{error}</InlineAlert>}
      <TextField value={body} onChange={setBody} aria-label={label} className="flex flex-col">
        <TextArea
          rows={parentId ? 2 : 3}
          maxLength={2000}
          autoFocus={autoFocus}
          placeholder={parentId ? 'Write a reply…' : placeholder}
          className="w-full resize-y rounded-sm border border-control bg-app px-3 py-2 text-[15px] text-primary outline-none placeholder:text-tertiary focus:ring-2 focus:ring-focus"
        />
      </TextField>
      <div className="flex justify-end gap-2">
        {onCancel && (
          <Button size="sm" variant="quiet" onPress={onCancel}>
            Cancel
          </Button>
        )}
        <Button size="sm" variant="primary" type="submit" isDisabled={busy || !body.trim()}>
          {busy ? 'Posting…' : parentId ? 'Reply' : 'Post comment'}
        </Button>
      </div>
    </form>
  )
}

function CommentBody({
  c,
  quoted,
  onDelete,
  onReply,
}: {
  c: ReaderReply
  /** show the paragraph it was made on (not inside that paragraph's own thread, which quotes it once on top) */
  quoted?: boolean
  onDelete: () => void
  onReply?: () => void
}) {
  if (c.removed) return <p className="py-1 text-[14px] italic text-tertiary">This comment was removed.</p>
  const name = c.author.username ? (
    <Link href={routes.author(c.author.username)} className="font-medium text-primary hover:underline">
      {c.author.displayName}
    </Link>
  ) : (
    <span className="font-medium text-primary">{c.author.displayName}</span>
  )
  return (
    <div className="flex gap-3">
      <Avatar
        name={c.author.displayName}
        seed={c.author.avatarSeed}
        avatar={c.author.avatar}
        badge={c.author.badge}
        size={32}
      />
      <div className="min-w-0 flex-1">
        <p className="text-[13px] text-secondary">
          {name}
          {c.byAuthor && (
            <span className="ml-1.5 rounded-full bg-selected px-1.5 py-px text-[11px] text-primary">
              Writer
            </span>
          )}
          <span className="ml-1.5 text-tertiary">
            · <time dateTime={c.createdAt}>{timeAgo(c.createdAt)}</time>
          </span>
        </p>
        {quoted && c.quote && (
          <blockquote className="my-1 border-l-2 border-subtle pl-2 font-manuscript text-[14px] italic text-secondary">
            “{c.quote}”
          </blockquote>
        )}
        <p className="mt-0.5 whitespace-pre-wrap break-words text-[15px] text-primary">{c.body}</p>
        <div className="-ml-2 mt-1 flex items-center gap-1">
          {onReply && (
            <Button size="sm" variant="quiet" onPress={onReply}>
              <ReplyIcon size={15} />
              Reply
            </Button>
          )}
          {c.canDelete && (
            <Button size="sm" variant="quiet" onPress={onDelete} aria-label="Delete comment">
              <TrashIcon size={15} />
            </Button>
          )}
          <ReportButton target={{ type: 'reader_comment', commentId: c.id }} label="Report" compact />
        </div>
      </div>
    </div>
  )
}

/**
 * A thread readers can join: the composer (or the way in for signed-out readers), the comments with their replies,
 * and more on request. Shared by the work page, a paragraph's sheet and a chapter's discussion.
 */
export function CommentThread({
  publicPath,
  anchor,
  initial,
  label,
  placeholder,
  empty,
  heading,
  onChange,
}: {
  publicPath: string
  anchor?: Anchor | undefined
  /** the first page, already fetched as the viewer by the server */
  initial?: CommentList | null | undefined
  /** the composer's accessible name */
  label: string
  placeholder?: string
  empty: string
  heading?: (list: CommentList | null) => ReactNode
  /** after posting or deleting (e.g. to update a paragraph's count) */
  onChange?: (() => void) | undefined
}) {
  const q = anchor
    ? `chapter=${encodeURIComponent(anchor.chapterSlug)}${anchor.blockId ? `&block=${encodeURIComponent(anchor.blockId)}` : ''}`
    : ''
  const [list, setList] = useState<CommentList | null>(initial ?? null)
  const [replyTo, setReplyTo] = useState<string | null>(null)
  const [prompt, setPrompt] = useState(false)
  const [signedIn, setSignedIn] = useState<boolean | null>(null)

  const load = useCallback(async () => {
    setList(await api<CommentList>(`/public/reading/${publicPath}/comments${q ? `?${q}` : ''}`))
  }, [publicPath, q])
  const preloaded = useRef(!!initial)
  useEffect(() => {
    if (!preloaded.current) void load()
    preloaded.current = false
    api('/me').then(
      () => setSignedIn(true),
      () => setSignedIn(false),
    )
  }, [load])

  const more = async () => {
    if (!list?.nextCursor) return
    const page = await api<CommentList>(
      `/public/reading/${publicPath}/comments?cursor=${encodeURIComponent(list.nextCursor)}${q ? `&${q}` : ''}`,
    )
    setList({ ...page, items: [...list.items, ...page.items] })
  }
  const remove = async (id: string) => {
    await api(`/reader-comments/${id}`, { method: 'DELETE' })
    await load()
    onChange?.()
  }
  const posted = () => {
    void load()
    onChange?.()
  }

  return (
    <>
      {heading?.(list)}
      <div className={heading ? 'mt-4' : ''}>
        {list?.canComment ? (
          <Composer
            publicPath={publicPath}
            anchor={anchor}
            label={label}
            placeholder={placeholder}
            onPosted={posted}
          />
        ) : signedIn === false ? (
          <button
            type="button"
            onClick={() => setPrompt(true)}
            className="w-full rounded-sm border border-control bg-app px-3 py-3 text-left text-[15px] text-tertiary outline-none hover:border-action focus-visible:ring-2 focus-visible:ring-focus"
          >
            Join the conversation…
          </button>
        ) : signedIn && list && !list.canComment ? (
          <p className="text-[14px] text-secondary">You can’t comment on this work.</p>
        ) : null}
      </div>
      <ol className="mt-6 flex flex-col divide-y divide-subtle">
        {list?.items.map((c) => (
          <li key={c.id} className="py-4">
            <CommentBody
              c={c}
              quoted={!anchor?.blockId}
              onDelete={() => void remove(c.id)}
              {...(list.canComment ? { onReply: () => setReplyTo(c.id) } : {})}
            />
            {(c.replies.length > 0 || replyTo === c.id) && (
              <ol className="ml-11 mt-3 flex flex-col gap-3 border-l border-subtle pl-4">
                {c.replies.map((r) => (
                  <li key={r.id}>
                    <CommentBody
                      c={r}
                      onDelete={() => void remove(r.id)}
                      {...(list.canComment ? { onReply: () => setReplyTo(c.id) } : {})}
                    />
                  </li>
                ))}
                {replyTo === c.id && (
                  <li>
                    <Composer
                      publicPath={publicPath}
                      anchor={anchor}
                      parentId={c.id}
                      label={`Reply to ${c.author.displayName}`}
                      autoFocus
                      onCancel={() => setReplyTo(null)}
                      onPosted={() => {
                        setReplyTo(null)
                        posted()
                      }}
                    />
                  </li>
                )}
              </ol>
            )}
          </li>
        ))}
      </ol>
      {list && !list.items.length && <p className="py-6 text-[14px] text-secondary">{empty}</p>}
      {list?.nextCursor && (
        <Button size="sm" onPress={() => void more()}>
          Show more comments
        </Button>
      )}
      <SignupPrompt isOpen={prompt} onClose={() => setPrompt(false)} action="join the conversation" />
    </>
  )
}

/** What readers say about a published work: open to read for everyone, open to write for anyone signed in. */
export function ReaderComments({
  publicPath,
  anchor,
  initial,
  onChange,
}: {
  publicPath: string
  /** a paragraph's thread instead of the work's comments */
  anchor?: Required<Anchor>
  /** the work's thread, first page, fetched by the page (which shows its count beside the like button too) */
  initial?: CommentList | null
  onChange?: () => void
}) {
  return anchor ? (
    <section aria-label="Comments on this paragraph">
      <CommentThread
        publicPath={publicPath}
        anchor={anchor}
        label="Comment on this paragraph"
        empty="Nobody has said anything about this paragraph yet."
        onChange={onChange}
      />
    </section>
  ) : (
    <section id="comments" aria-labelledby="comments-heading" className="scroll-mt-20">
      <CommentThread
        publicPath={publicPath}
        initial={initial}
        label="Add a comment"
        empty="No comments yet. Be the first to say what it made you feel."
        heading={(list) => (
          <h2 id="comments-heading" className="font-display text-[26px] text-primary">
            Comments{list ? <span className="ml-2 text-[18px] text-tertiary">{list.total}</span> : null}
          </h2>
        )}
        onChange={onChange}
      />
    </section>
  )
}

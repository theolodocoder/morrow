'use client'
import { useEffect, useState } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import { Button as AriaButton, Menu, MenuItem, MenuTrigger, Popover, Separator } from 'react-aria-components'
import type { FollowState } from '@morrow/contracts'
import { ReportDialog } from '@/components/safety/report-dialog'
import { BookmarkIcon, CommentIcon, HeartIcon, LinkIcon, MoreIcon } from '@/components/ui/icons'
import { toast } from '@/components/ui/toast'
import { api, ClientApiError } from '@/lib/client-api'
import { compact } from '@/lib/format'
import { SignupPrompt } from './signup-wall'

const icon =
  'press inline-flex h-10 min-w-10 items-center justify-center gap-1.5 rounded-full px-3 text-[14px] tabular-nums text-primary outline-none transition-colors hover:bg-hover focus-visible:ring-2 focus-visible:ring-focus disabled:opacity-50'
const menuItem =
  'flex cursor-default items-center gap-2.5 rounded-sm px-3 py-2 text-sm text-primary outline-none data-[focused]:bg-hover'

/**
 * What a reader can do with a published work (design/product-redesign.md §4): like, comment, save and share in sight;
 * following the work or its writer, and reporting, in ⋯. The page renders anonymously; your own state loads here.
 */
export function WorkActions({
  publicPath,
  title,
  likes: initialLikes,
  comments,
  author,
  commentsHref = '#comments',
}: {
  /** where the comment count goes (the reader links back to the work page's comments) */
  commentsHref?: string
  publicPath: string
  title: string
  likes: number
  comments: number
  author?: { username: string; name: string }
}) {
  const router = useRouter()
  const path = usePathname()
  const [state, setState] = useState<FollowState | null>(null)
  const [likes, setLikes] = useState(initialLikes)
  const [signedOut, setSignedOut] = useState(false)
  const [prompt, setPrompt] = useState<string | null>(null)
  const [report, setReport] = useState(false)
  const [pop, setPop] = useState(0)

  useEffect(() => {
    const q = new URLSearchParams({ work: publicPath })
    if (author) q.set('author', author.username)
    api<FollowState>(`/me/follow-state?${q}`).then(setState, (e) => {
      if (e instanceof ClientApiError && e.status === 401) setSignedOut(true)
    })
  }, [publicPath, author])

  const like = async () => {
    if (signedOut) return setPrompt('like this')
    if (!state) return
    const on = !state.liked
    setState({ ...state, liked: on })
    setLikes((n) => n + (on ? 1 : -1))
    if (on) setPop((n) => n + 1)
    try {
      const r = await api<{ liked: boolean; likes: number }>(`/reading/${publicPath}/like`, {
        method: on ? 'PUT' : 'DELETE',
      })
      setState((s) => (s ? { ...s, liked: r.liked } : s))
      setLikes(r.likes)
    } catch {
      setState((s) => (s ? { ...s, liked: !on } : s))
      setLikes((n) => n + (on ? -1 : 1))
    }
  }
  const save = async () => {
    if (signedOut) return setPrompt('save this for later')
    if (!state) return
    const on = !state.bookmarked
    setState({ ...state, bookmarked: on })
    await api('/me/bookmarks', { method: on ? 'PUT' : 'DELETE', body: { publicPath } })
    toast(on ? 'Saved to your reading list' : 'Removed from your reading list')
  }
  const follow = async (kind: 'work' | 'author') => {
    if (signedOut) return router.push(`/sign-in?next=${encodeURIComponent(path)}`)
    if (!state) return
    const on = kind === 'work' ? !state.followingWork : !state.followingAuthor
    await api('/me/follows', {
      method: on ? 'PUT' : 'DELETE',
      body: kind === 'work' ? { type: 'work', publicPath } : { type: 'author', username: author!.username },
    })
    setState(kind === 'work' ? { ...state, followingWork: on } : { ...state, followingAuthor: on })
    toast(
      kind === 'work'
        ? on
          ? 'You’ll hear when it’s updated'
          : 'Unfollowed this work'
        : on
          ? `Following ${author!.name}`
          : `Unfollowed ${author!.name}`,
    )
  }
  const share = async () => {
    const url = window.location.href.split('#')[0]!
    try {
      if (navigator.share) await navigator.share({ title, url })
      else {
        await navigator.clipboard.writeText(url)
        toast('Link copied')
      }
    } catch {
      // closed the share sheet
    }
  }
  const waiting = !state && !signedOut

  return (
    <div className="-ml-3 flex items-center gap-0.5">
      <button
        type="button"
        onClick={() => void like()}
        disabled={waiting}
        aria-pressed={state?.liked ?? false}
        aria-label={`${state?.liked ? 'Unlike' : 'Like'}, ${likes} ${likes === 1 ? 'like' : 'likes'}`}
        className={`${icon} ${state?.liked ? 'text-[var(--action-primary-bg)]' : ''}`}
      >
        <HeartIcon
          key={pop}
          size={20}
          className={state?.liked ? `fill-current ${pop ? 'like-pop' : ''}` : ''}
        />
        {compact(likes)}
      </button>
      <a
        href={commentsHref}
        className={icon}
        aria-label={`${comments} ${comments === 1 ? 'comment' : 'comments'}`}
      >
        <CommentIcon size={20} />
        {compact(comments)}
      </a>
      <button
        type="button"
        onClick={() => void save()}
        disabled={waiting}
        aria-pressed={state?.bookmarked ?? false}
        aria-label={state?.bookmarked ? 'Saved to your reading list' : 'Save to your reading list'}
        title={state?.bookmarked ? 'Saved' : 'Save'}
        className={icon}
      >
        <BookmarkIcon size={20} className={state?.bookmarked ? 'fill-current' : ''} />
      </button>
      <button type="button" onClick={() => void share()} aria-label="Share" title="Share" className={icon}>
        <LinkIcon size={20} />
      </button>
      <MenuTrigger>
        <AriaButton
          aria-label="More"
          className="press grid size-10 place-items-center rounded-full text-secondary outline-none hover:bg-hover hover:text-primary data-[focus-visible]:ring-2 data-[focus-visible]:ring-focus"
        >
          <MoreIcon size={20} />
        </AriaButton>
        <Popover
          placement="bottom end"
          className="popover min-w-56 rounded-md border border-subtle bg-raised p-1 shadow-[0_2px_4px_rgb(34_34_31/.06),0_12px_32px_rgb(34_34_31/.14)]"
        >
          <Menu
            aria-label="More"
            className="outline-none"
            onAction={(key) => {
              if (key === 'work') void follow('work')
              if (key === 'author') void follow('author')
              if (key === 'report') setReport(true)
            }}
          >
            {!state?.isMe && (
              <MenuItem id="work" className={menuItem}>
                {state?.followingWork ? 'Unfollow this work' : 'Follow this work'}
              </MenuItem>
            )}
            {author && !state?.isMe && (
              <MenuItem id="author" className={menuItem}>
                {state?.followingAuthor ? `Unfollow ${author.name}` : `Follow ${author.name}`}
              </MenuItem>
            )}
            {!state?.isMe && <Separator className="my-1 h-px bg-[var(--border-subtle)]" />}
            <MenuItem id="report" className={`${menuItem} text-danger`}>
              Report this work
            </MenuItem>
          </Menu>
        </Popover>
      </MenuTrigger>
      <ReportDialog target={{ type: 'work', publicPath }} isOpen={report} onOpenChange={setReport} />
      <SignupPrompt isOpen={prompt !== null} onClose={() => setPrompt(null)} action={prompt ?? ''} />
    </div>
  )
}

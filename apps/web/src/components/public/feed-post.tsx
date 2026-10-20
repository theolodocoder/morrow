'use client'
import Link from 'next/link'
import { useState } from 'react'
import { Button as AriaButton, Menu, MenuItem, MenuTrigger, Popover } from 'react-aria-components'
import type { FeedItem } from '@morrow/contracts'
import { Avatar, AvatarStack } from '@/components/profile/avatar'
import { WorkCover } from '@/components/work-cover'
import { BookmarkIcon, CommentIcon, EyeIcon, HeartIcon, MoreIcon } from '@/components/ui/icons'
import { toast } from '@/components/ui/toast'
import { api } from '@/lib/client-api'
import { compact, readingMinutes, timeAgo } from '@/lib/format'
import { routes } from '@/lib/routes'
import { CATEGORY_OPTIONS, labelOf } from '@/lib/work-options'

const action =
  'press inline-flex h-9 min-w-9 items-center justify-center gap-1.5 rounded-full px-2.5 text-[13px] tabular-nums text-secondary outline-none transition-colors hover:bg-hover hover:text-primary focus-visible:ring-2 focus-visible:ring-focus'
const menuItem =
  'flex cursor-default items-center gap-2.5 rounded-sm px-3 py-2 text-sm text-primary outline-none data-[focused]:bg-hover'

/** "with Tolu", "with Tolu and Bo", "with Tolu and 3 others" */
function withPeople(names: string[], total: number) {
  if (!names.length) return ''
  if (total === 1) return names[0]!
  if (total === 2 && names.length === 2) return `${names[0]} and ${names[1]}`
  return `${names[0]} and ${total - 1} others`
}

/**
 * A published piece in the feed (design/product-redesign.md §4): who and when, the title and its opening, and the
 * things readers do most (like, comment, save; reads are shown). Following the writer and sharing live in ⋯.
 * Signed-out visitors who try to act are invited to join (`onNeedAccount`).
 */
export function FeedPost({
  item,
  onNeedAccount,
}: {
  item: FeedItem
  onNeedAccount: (action: string) => void
}) {
  const [viewer, setViewer] = useState(item.viewer)
  const [likes, setLikes] = useState(item.likes)
  const [pop, setPop] = useState(0)
  const href = routes.publicWork(item.publicPath)
  const author = item.author
  const titleId = `post-${item.publicPath}`

  const like = async () => {
    if (!viewer) return onNeedAccount('like this')
    const on = !viewer.liked
    // Optimistic: the heart answers at once (and pops), then settles to the server's count.
    setViewer({ ...viewer, liked: on })
    setLikes((n) => n + (on ? 1 : -1))
    if (on) setPop((n) => n + 1)
    try {
      const r = await api<{ liked: boolean; likes: number }>(`/reading/${item.publicPath}/like`, {
        method: on ? 'PUT' : 'DELETE',
      })
      setViewer((v) => (v ? { ...v, liked: r.liked } : v))
      setLikes(r.likes)
    } catch {
      setViewer((v) => (v ? { ...v, liked: !on } : v))
      setLikes((n) => n + (on ? -1 : 1))
    }
  }
  const follow = async () => {
    if (!viewer) return onNeedAccount(`follow ${author.displayName}`)
    if (!author.username) return
    const on = !viewer.followingAuthor
    await api('/me/follows', {
      method: on ? 'PUT' : 'DELETE',
      body: { type: 'author', username: author.username },
    })
    setViewer({ ...viewer, followingAuthor: on })
    toast(on ? `Following ${author.displayName}` : `Unfollowed ${author.displayName}`)
  }
  const save = async () => {
    if (!viewer) return onNeedAccount('save this for later')
    const on = !viewer.bookmarked
    setViewer({ ...viewer, bookmarked: on })
    try {
      await api('/me/bookmarks', { method: on ? 'PUT' : 'DELETE', body: { publicPath: item.publicPath } })
      toast(on ? 'Saved to your reading list' : 'Removed from your reading list')
    } catch {
      setViewer((v) => (v ? { ...v, bookmarked: !on } : v))
    }
  }
  const share = async () => {
    const url = `${window.location.origin}${href}`
    try {
      if (navigator.share) await navigator.share({ title: item.title, url })
      else {
        await navigator.clipboard.writeText(url)
        toast('Link copied')
      }
    } catch {
      // the person closed the share sheet
    }
  }

  return (
    <article
      aria-labelledby={titleId}
      data-public-path={item.publicPath}
      className="feed-post lift relative px-4 py-5 transition-colors hover:bg-[color-mix(in_srgb,var(--bg-hover)_45%,transparent)] sm:px-6"
    >
      <header className="flex items-center gap-3">
        {author.username ? (
          <Link
            href={routes.author(author.username)}
            className="relative z-10 shrink-0 rounded-full"
            tabIndex={-1}
            aria-label={`${author.displayName}’s profile`}
          >
            <Avatar
              name={author.displayName}
              seed={author.avatarSeed}
              avatar={author.avatar}
              badge={author.badge}
              size={40}
            />
          </Link>
        ) : (
          <Avatar
            name={author.displayName}
            seed={author.avatarSeed}
            avatar={author.avatar}
            badge={author.badge}
            size={40}
          />
        )}
        <div className="min-w-0 flex-1">
          <p className="truncate text-[14px] text-primary">
            {author.username ? (
              <Link
                href={routes.author(author.username)}
                className="relative z-10 font-semibold hover:underline"
              >
                {author.displayName}
              </Link>
            ) : (
              <span className="font-semibold">{author.displayName}</span>
            )}
            {item.collaborators.length > 0 && (
              <span className="text-secondary">
                {' '}
                with{' '}
                {withPeople(
                  item.collaborators.map((c) => c.displayName),
                  item.collaboratorCount,
                )}
              </span>
            )}
          </p>
          <p className="truncate text-[12px] text-tertiary">
            <time dateTime={item.publishedAt} suppressHydrationWarning>
              {timeAgo(item.publishedAt)}
            </time>{' '}
            · {labelOf(CATEGORY_OPTIONS, item.category)} · {readingMinutes(item.wordCount)} min
            {item.completed && <span className="text-success"> · Complete</span>}
          </p>
        </div>
        {item.collaborators.length > 0 && <AvatarStack people={item.collaborators.slice(0, 3)} size={24} />}
        <MenuTrigger>
          <AriaButton
            aria-label={`More about ${item.title}`}
            className="press relative z-10 grid size-9 place-items-center rounded-full text-tertiary outline-none hover:bg-hover hover:text-primary data-[focus-visible]:ring-2 data-[focus-visible]:ring-focus"
          >
            <MoreIcon size={18} />
          </AriaButton>
          <Popover
            placement="bottom end"
            className="popover min-w-52 rounded-md border border-subtle bg-raised p-1 shadow-[0_2px_4px_rgb(34_34_31/.06),0_12px_32px_rgb(34_34_31/.14)]"
          >
            <Menu
              aria-label={`More about ${item.title}`}
              className="outline-none"
              onAction={(key) => {
                if (key === 'follow') void follow()
                if (key === 'share') void share()
              }}
            >
              {author.username && !viewer?.isAuthor && (
                <MenuItem id="follow" className={menuItem}>
                  {viewer?.followingAuthor
                    ? `Unfollow ${author.displayName}`
                    : `Follow ${author.displayName}`}
                </MenuItem>
              )}
              <MenuItem id="share" className={menuItem}>
                Share or copy link
              </MenuItem>
              {author.username && (
                <MenuItem id="profile" href={routes.author(author.username)} className={menuItem}>
                  View {author.displayName}’s profile
                </MenuItem>
              )}
            </Menu>
          </Popover>
        </MenuTrigger>
      </header>

      <div className="mt-3 sm:pl-[52px]">
        <div className="flex items-start gap-4">
          <div className="min-w-0 flex-1">
            {/* The whole card opens the piece; the links and buttons on it stay their own targets. */}
            <Link
              href={href}
              className="group block rounded-sm outline-none after:absolute after:inset-0 focus-visible:ring-2 focus-visible:ring-focus"
            >
              <h2
                id={titleId}
                className="font-display text-[24px] leading-tight text-primary group-hover:underline"
              >
                {item.title}
              </h2>
            </Link>
            {(item.excerpt || item.description) && (
              <p className="mt-1.5 line-clamp-3 font-manuscript text-[16px] leading-relaxed text-secondary">
                {item.excerpt || item.description}
              </p>
            )}
          </div>
          {/* the cover, as a small book beside the words; it lifts with the card */}
          <div className="lift-target mt-1 shrink-0">
            <WorkCover cover={item.cover} title={item.title} />
          </div>
        </div>
        <footer className="relative z-10 -ml-2.5 mt-2 flex items-center">
          <button
            type="button"
            onClick={() => void like()}
            aria-pressed={viewer?.liked ?? false}
            aria-label={`${viewer?.liked ? 'Unlike' : 'Like'}, ${likes} ${likes === 1 ? 'like' : 'likes'}`}
            className={`${action} ${viewer?.liked ? 'text-[var(--action-primary-bg)] hover:text-[var(--action-primary-bg)]' : ''}`}
          >
            <HeartIcon
              key={pop}
              size={18}
              className={viewer?.liked ? `fill-current ${pop ? 'like-pop' : ''}` : ''}
            />
            {likes > 0 && compact(likes)}
          </button>
          <Link
            href={`${href}#comments`}
            aria-label={`${item.comments} ${item.comments === 1 ? 'comment' : 'comments'}`}
            className={action}
          >
            <CommentIcon size={18} />
            {item.comments > 0 && compact(item.comments)}
          </Link>
          <span className="inline-flex h-9 items-center gap-1.5 px-2.5 text-[13px] tabular-nums text-tertiary">
            <EyeIcon size={18} />
            <span className="sr-only">Read </span>
            {compact(item.views)}
            <span className="sr-only"> times</span>
          </span>
          <button
            type="button"
            onClick={() => void save()}
            aria-pressed={viewer?.bookmarked ?? false}
            aria-label={viewer?.bookmarked ? 'Saved to your reading list' : 'Save to your reading list'}
            className={`${action} ml-auto ${viewer?.bookmarked ? 'text-primary' : ''}`}
          >
            <BookmarkIcon size={18} className={viewer?.bookmarked ? 'fill-current' : ''} />
          </button>
        </footer>
      </div>
    </article>
  )
}

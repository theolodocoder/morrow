'use client'
import { useCallback, useEffect, useState } from 'react'
import { EmptyState } from '@/components/brand/spots'
import { useRouter } from 'next/navigation'
import type { NotificationItem } from '@morrow/contracts'
import { Button } from '@/components/ui/button'
import { InlineAlert } from '@/components/ui/inline-alert'
import {
  AtIcon,
  CheckIcon,
  CommentIcon,
  InboxIcon,
  PeopleIcon,
  ProposeIcon,
  PublishIcon,
  SettingsIcon,
} from '@/components/ui/icons'
import { api } from '@/lib/client-api'
import { routes } from '@/lib/routes'
import { SkeletonRows } from '@/components/ui/skeleton'
import { ContributionRequests } from './contribution-requests'

type Category = NotificationItem['category']
const FILTERS: { id: Category | 'all'; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'mentions', label: 'Mentions' },
  { id: 'comments', label: 'Comments' },
  { id: 'proposals', label: 'Proposals' },
  { id: 'invitations', label: 'Invitations' },
  { id: 'activity', label: 'Activity' },
  { id: 'publishing', label: 'Following' },
]
const ICON: Record<Category, React.ReactNode> = {
  mentions: <AtIcon size={18} />,
  comments: <CommentIcon size={18} />,
  proposals: <ProposeIcon size={18} />,
  invitations: <PeopleIcon size={18} />,
  activity: <InboxIcon size={18} />,
  publishing: <PublishIcon size={18} />,
}
const when = new Intl.DateTimeFormat('en', {
  day: 'numeric',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit',
})

/** The notification center (FR-030): read and unread, by category, each linking to what it's about. */
/** Invitations waiting for you, at the top of Activity (they used to live on a page nothing linked to). */
function PendingInvitations() {
  const [n, setN] = useState(0)
  useEffect(() => {
    void api<{ items: unknown[] }>('/me/invitations').then(
      (r) => setN(r.items.length),
      () => {},
    )
  }, [])
  if (!n) return null
  return (
    <a
      href={routes.invitations}
      className="press flex items-center justify-between gap-3 rounded-lg border border-subtle bg-canvas px-4 py-3 hover:bg-hover"
    >
      <span className="text-[14px] text-primary">
        <span className="font-semibold">{n === 1 ? '1 invitation' : `${n} invitations`}</span> to write with
        others
      </span>
      <span className="text-[13px] font-medium text-accent">Review</span>
    </a>
  )
}

export function NotificationCenter() {
  const router = useRouter()
  const [filter, setFilter] = useState<Category | 'all'>('all')
  const [items, setItems] = useState<NotificationItem[] | null>(null)
  const [cursor, setCursor] = useState<string | null>(null)
  const [unread, setUnread] = useState(0)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(
    async (more?: string) => {
      const q = new URLSearchParams()
      if (filter !== 'all') q.set('category', filter)
      if (more) q.set('cursor', more)
      try {
        const r = await api<{ items: NotificationItem[]; nextCursor: string | null; unread: number }>(
          `/me/notifications?${q}`,
        )
        setItems((prev) => (more ? [...(prev ?? []), ...r.items] : r.items))
        setCursor(r.nextCursor)
        setUnread(r.unread)
      } catch {
        setError('Couldn’t load notifications.')
      }
    },
    [filter],
  )
  useEffect(() => {
    setItems(null)
    void load()
  }, [load])

  async function open(n: NotificationItem) {
    if (!n.read) void api('/me/notifications/read', { method: 'POST', body: { ids: [n.id] } }).catch(() => {})
    router.push(n.url)
  }
  async function readAll() {
    await api('/me/notifications/read', { method: 'POST', body: { all: true } })
    setItems((prev) => prev?.map((n) => ({ ...n, read: true })) ?? null)
    setUnread(0)
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-[28px] leading-tight sm:text-[36px]">Activity</h1>
          <p className="mt-1 text-[13px] text-secondary" role="status">
            {unread ? `${unread} unread` : 'All caught up.'}
          </p>
        </div>
        <div className="flex gap-1">
          <Button
            size="sm"
            variant="quiet"
            isDisabled={!unread}
            onPress={() => void readAll()}
            aria-label="Mark all as read"
            className="press size-9 rounded-full px-0"
          >
            <CheckIcon size={18} />
          </Button>
          <a
            href={routes.notificationSettings}
            aria-label="Notification settings"
            title="Notification settings"
            className="press grid size-9 place-items-center rounded-full text-secondary hover:bg-hover hover:text-primary"
          >
            <SettingsIcon size={18} />
          </a>
        </div>
      </div>
      <PendingInvitations />
      <ContributionRequests />
      <nav aria-label="Filter notifications" className="flex flex-wrap gap-1 border-b border-subtle">
        {FILTERS.map((f) => (
          <button
            key={f.id}
            type="button"
            aria-pressed={filter === f.id}
            onClick={() => setFilter(f.id)}
            className={`-mb-px border-b-2 px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-focus ${filter === f.id ? 'border-action text-primary' : 'border-transparent text-secondary hover:text-primary'}`}
          >
            {f.label}
          </button>
        ))}
      </nav>
      {error && <InlineAlert>{error}</InlineAlert>}
      {items === null ? (
        <SkeletonRows count={5} />
      ) : items.length === 0 ? (
        <EmptyState
          spot="inbox"
          title="Nothing here yet."
          body="Likes, comments, follows, proposals and mentions will arrive here."
        />
      ) : (
        <ul className="divide-y divide-subtle border-y border-subtle">
          {items.map((n) => (
            <li key={n.id}>
              <button
                type="button"
                onClick={() => void open(n)}
                className={`flex w-full items-start gap-3 px-2 py-3.5 text-left outline-none hover:bg-hover focus-visible:bg-hover ${n.read ? '' : 'bg-canvas'}`}
              >
                <span className={`mt-0.5 shrink-0 ${n.read ? 'text-tertiary' : 'text-accent'}`}>
                  {ICON[n.category]}
                </span>
                <span className="min-w-0 flex-1">
                  <span className={`block text-sm ${n.read ? 'text-secondary' : 'font-medium text-primary'}`}>
                    {n.title}
                  </span>
                  {n.body && (
                    <span className="mt-0.5 block truncate font-manuscript text-[14px] italic text-secondary">
                      {n.body}
                    </span>
                  )}
                  <span className="mt-0.5 block font-mono text-[11px] text-tertiary">
                    {when.format(new Date(n.createdAt))}
                  </span>
                </span>
                {!n.read && (
                  <span className="mt-1.5 size-2 shrink-0 rounded-full bg-action">
                    <span className="sr-only">Unread</span>
                  </span>
                )}
              </button>
            </li>
          ))}
        </ul>
      )}
      {cursor && (
        <Button variant="quiet" onPress={() => void load(cursor)}>
          Show older
        </Button>
      )}
    </div>
  )
}

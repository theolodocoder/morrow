'use client'
import Link from 'next/link'
import { useEffect, useState } from 'react'
import { BellIcon } from '@/components/ui/icons'
import { api } from '@/lib/client-api'
import { routes } from '@/lib/routes'

/**
 * The way into notifications (FR-030). Deliberately quiet: a count, never motion or pop-ups, because notifications
 * must not interrupt writing. Refreshes when the tab regains focus and once a minute.
 */
export function NotificationBell() {
  const [count, setCount] = useState(0)
  useEffect(() => {
    const load = () =>
      void api<{ count: number }>('/me/notifications/unread').then(
        (r) => setCount(r.count),
        () => {},
      )
    load()
    const timer = setInterval(load, 60_000)
    window.addEventListener('focus', load)
    return () => {
      clearInterval(timer)
      window.removeEventListener('focus', load)
    }
  }, [])
  return (
    <Link
      href={routes.notifications}
      aria-label={count ? `Notifications, ${count} unread` : 'Notifications'}
      className="relative inline-flex size-8 items-center justify-center rounded-sm text-secondary outline-none hover:bg-hover hover:text-primary focus-visible:ring-2 focus-visible:ring-focus"
    >
      <BellIcon />
      {count > 0 && (
        <span
          aria-hidden="true"
          className="absolute -right-0.5 -top-0.5 min-w-4 rounded-full bg-action px-1 text-center font-ui text-[10px] font-semibold leading-4 text-action-fg ring-2 ring-canvas"
        >
          {count > 99 ? '99+' : count}
        </span>
      )}
    </Link>
  )
}

'use client'
import { useEffect, useState } from 'react'
import { api } from '@/lib/client-api'

/** Unread activity, kept fresh: on load, when the tab regains focus, and once a minute. Quiet: a count, no pop-ups. */
export function useUnread() {
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
  return count
}

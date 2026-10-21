'use client'
import { useEffect, useState } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import type { FollowState } from '@morrow/contracts'
import { Button } from '@/components/ui/button'
import { BookmarkIcon, CheckIcon, PlusIcon } from '@/components/ui/icons'
import { api, ClientApiError } from '@/lib/client-api'

/**
 * Follow and bookmark (FR-022) on public pages, which render anonymously: state is fetched in the browser.
 * Signed-out visitors are sent to sign in and brought back here.
 */
export function FollowControls({
  author,
  work,
  bookmark = true,
}: {
  author?: { username: string; name: string }
  work?: { publicPath: string }
  /** off where a Save control is already in sight (the reader's chapter end) */
  bookmark?: boolean
}) {
  const router = useRouter()
  const path = usePathname()
  const [state, setState] = useState<FollowState | null>(null)
  const [signedOut, setSignedOut] = useState(false)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    const q = new URLSearchParams()
    if (author) q.set('author', author.username)
    if (work) q.set('work', work.publicPath)
    api<FollowState>(`/me/follow-state?${q}`).then(setState, (e) => {
      if (e instanceof ClientApiError && e.status === 401) setSignedOut(true)
    })
  }, [author, work])

  if (state?.isMe) return null
  const toggle = async (kind: 'author' | 'work' | 'bookmark') => {
    if (signedOut) return router.push(`/sign-in?next=${encodeURIComponent(path)}`)
    if (!state) return
    setBusy(true)
    try {
      if (kind === 'bookmark') {
        await api('/me/bookmarks', {
          method: state.bookmarked ? 'DELETE' : 'PUT',
          body: { publicPath: work!.publicPath },
        })
        setState({ ...state, bookmarked: !state.bookmarked })
      } else {
        const on = kind === 'author' ? state.followingAuthor : state.followingWork
        const body =
          kind === 'author'
            ? { type: 'author', username: author!.username }
            : { type: 'work', publicPath: work!.publicPath }
        await api('/me/follows', { method: on ? 'DELETE' : 'PUT', body })
        setState(kind === 'author' ? { ...state, followingAuthor: !on } : { ...state, followingWork: !on })
      }
    } finally {
      setBusy(false)
    }
  }
  const s = state ?? {
    followingAuthor: false,
    followingWork: false,
    bookmarked: false,
    liked: false,
    isMe: false,
  }
  // Until we know (state loaded, or signed out), a click would act on a guess: wait instead of silently doing nothing.
  const waiting = busy || (!state && !signedOut)
  return (
    <div className="flex flex-wrap gap-2">
      {author && (
        <Button
          size="sm"
          variant={s.followingAuthor ? 'secondary' : 'primary'}
          aria-pressed={s.followingAuthor}
          isDisabled={waiting}
          onPress={() => void toggle('author')}
        >
          {s.followingAuthor ? <CheckIcon size={16} /> : <PlusIcon size={16} />}
          {s.followingAuthor ? `Following ${author.name}` : `Follow ${author.name}`}
        </Button>
      )}
      {work && (
        <>
          <Button
            size="sm"
            variant="secondary"
            aria-pressed={s.followingWork}
            isDisabled={waiting}
            onPress={() => void toggle('work')}
          >
            {s.followingWork ? <CheckIcon size={16} /> : <PlusIcon size={16} />}
            {s.followingWork ? 'Following this work' : 'Follow this work'}
          </Button>
          {bookmark && (
            <Button
              size="sm"
              variant="quiet"
              aria-pressed={s.bookmarked}
              isDisabled={waiting}
              onPress={() => void toggle('bookmark')}
            >
              <BookmarkIcon size={16} className={s.bookmarked ? 'fill-current' : ''} />
              {s.bookmarked ? 'Bookmarked' : 'Bookmark'}
            </Button>
          )}
        </>
      )}
    </div>
  )
}

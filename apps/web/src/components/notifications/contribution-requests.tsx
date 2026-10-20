'use client'
import Link from 'next/link'
import { useEffect, useState } from 'react'
import type { ContributionRequest } from '@morrow/contracts'
import { Avatar } from '@/components/profile/avatar'
import { Button } from '@/components/ui/button'
import { toast } from '@/components/ui/toast'
import { api } from '@/lib/client-api'
import { routes } from '@/lib/routes'

/**
 * People asking to collaborate on your published works (P-050), at the top of Activity: who, on what, their note, and
 * Accept (they join as a contributor) or Decline. Answered requests leave the list with a toast.
 */
export function ContributionRequests() {
  const [items, setItems] = useState<ContributionRequest[]>([])
  const [busy, setBusy] = useState<string | null>(null)
  useEffect(() => {
    void api<{ items: ContributionRequest[] }>('/me/contribution-requests').then(
      (r) => setItems(r.items),
      () => {},
    )
  }, [])
  if (!items.length) return null

  async function answer(r: ContributionRequest, accept: boolean) {
    setBusy(r.id)
    try {
      await api(`/contribution-requests/${r.id}/${accept ? 'accept' : 'decline'}`, { method: 'POST' })
      setItems((xs) => xs.filter((x) => x.id !== r.id))
      toast(
        accept
          ? `${r.requester.displayName} joined “${r.work.title}”`
          : `Declined. ${r.requester.displayName.split(' ')[0]} won’t see why.`,
      )
    } catch (e) {
      toast(e instanceof Error ? e.message : 'That didn’t work.')
    } finally {
      setBusy(null)
    }
  }

  return (
    <section aria-labelledby="requests" className="flex flex-col gap-2">
      <h2 id="requests" className="text-[12px] font-medium uppercase tracking-[0.06em] text-tertiary">
        Asking to collaborate
      </h2>
      <ul className="flex flex-col gap-2">
        {items.map((r) => (
          <li key={r.id} className="rise-in flex gap-3 rounded-lg border border-subtle bg-canvas p-4">
            <Avatar
              name={r.requester.displayName}
              seed={r.requester.avatarSeed}
              avatar={r.requester.avatar}
              badge={r.requester.badge}
              size={40}
            />
            <div className="min-w-0 flex-1">
              <p className="text-[14px] text-primary">
                {r.requester.username ? (
                  <Link href={routes.author(r.requester.username)} className="font-semibold hover:underline">
                    {r.requester.displayName}
                  </Link>
                ) : (
                  <span className="font-semibold">{r.requester.displayName}</span>
                )}{' '}
                wants to help with{' '}
                <Link href={routes.publicWork(r.work.publicPath)} className="font-medium hover:underline">
                  “{r.work.title}”
                </Link>
              </p>
              {r.message && (
                <p className="mt-1.5 rounded-md rounded-tl-none bg-app px-3 py-2 text-[14px] text-primary">
                  {r.message}
                </p>
              )}
              <div className="mt-3 flex gap-2">
                <Button
                  size="sm"
                  variant="primary"
                  isDisabled={busy === r.id}
                  onPress={() => void answer(r, true)}
                  aria-label={`Accept ${r.requester.displayName}`}
                >
                  Accept
                </Button>
                <Button
                  size="sm"
                  variant="quiet"
                  isDisabled={busy === r.id}
                  onPress={() => void answer(r, false)}
                  aria-label={`Decline ${r.requester.displayName}`}
                >
                  Decline
                </Button>
              </div>
            </div>
          </li>
        ))}
      </ul>
    </section>
  )
}

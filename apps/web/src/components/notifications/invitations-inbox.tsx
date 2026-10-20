'use client'
import { useEffect, useState } from 'react'
import { EmptyState } from '@/components/brand/spots'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { InlineAlert } from '@/components/ui/inline-alert'
import { api } from '@/lib/client-api'
import { routes } from '@/lib/routes'
import { SkeletonRows } from '@/components/ui/skeleton'

type Inv = { id: string; workTitle: string; invitedByName: string; role: string; expiresAt: string }
const ROLE: Record<string, string> = {
  editor: 'an editor',
  collaborator: 'a collaborator',
  contributor: 'a contributor',
  viewer: 'a reader',
}

/** Invitations sent to your (verified) address, accepted in place. */
export function InvitationsInbox() {
  const router = useRouter()
  const [data, setData] = useState<{ items: Inv[]; verified: boolean } | null>(null)
  const [error, setError] = useState<string | null>(null)
  useEffect(
    () =>
      void api<{ items: Inv[]; verified: boolean }>('/me/invitations').then(setData, () =>
        setError('Couldn’t load invitations.'),
      ),
    [],
  )
  if (error) return <InlineAlert>{error}</InlineAlert>
  if (!data) return <SkeletonRows count={1} />
  if (!data.verified)
    return (
      <p className="max-w-prose text-secondary">
        Invitations appear here once your email address is verified. Until then, open the link in the
        invitation email: it works the same way.
      </p>
    )
  if (!data.items.length) return <EmptyState spot="together" title="No invitations waiting." />
  return (
    <ul className="divide-y divide-subtle border-y border-subtle">
      {data.items.map((i) => (
        <li key={i.id} className="flex items-center gap-4 py-4">
          <div className="min-w-0 flex-1">
            <p className="truncate font-medium text-primary">{i.workTitle}</p>
            <p className="text-[13px] text-secondary">
              {i.invitedByName} invited you as {ROLE[i.role] ?? i.role}
            </p>
          </div>
          <Button
            variant="primary"
            size="sm"
            onPress={async () => {
              try {
                const r = await api<{ workId: string }>(`/me/invitations/${i.id}/accept`, {
                  method: 'POST',
                  body: {},
                })
                router.push(routes.work(r.workId))
              } catch (e) {
                setError(e instanceof Error ? e.message : 'That didn’t work.')
              }
            }}
          >
            Accept
          </Button>
        </li>
      ))}
    </ul>
  )
}

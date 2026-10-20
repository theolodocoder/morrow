'use client'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { InlineAlert } from '@/components/ui/inline-alert'
import { api, ClientApiError } from '@/lib/client-api'
import { routes } from '@/lib/routes'

export function AcceptInvitation({ token, signedInAs }: { token: string; signedInAs: string }) {
  const router = useRouter()
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)
  return (
    <div className="flex flex-col gap-3">
      {error && <InlineAlert>{error}</InlineAlert>}
      <Button
        variant="primary"
        size="lg"
        isDisabled={pending}
        onPress={async () => {
          setPending(true)
          setError(null)
          try {
            const { workId } = await api<{ workId: string }>(
              `/invitations/${encodeURIComponent(token)}/accept`,
              { method: 'POST', body: {} },
            )
            router.push(routes.work(workId))
          } catch (e) {
            setError(
              e instanceof ClientApiError
                ? [e.problem.title, e.problem.detail].filter(Boolean).join(' ')
                : 'Couldn’t accept the invitation.',
            )
            setPending(false)
          }
        }}
      >
        {pending ? 'Joining…' : 'Accept invitation'}
      </Button>
      <p className="text-[13px] text-tertiary">Signed in as {signedInAs}.</p>
    </div>
  )
}

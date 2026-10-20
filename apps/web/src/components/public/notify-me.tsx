'use client'
import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { BellIcon, CheckIcon } from '@/components/ui/icons'
import { toast } from '@/components/ui/toast'
import { api, ClientApiError } from '@/lib/client-api'
import { SignupPrompt } from './signup-wall'

/** "Notify me when it's ready" for a coming feature. Signed out, it invites you to join first. */
export function NotifyMe({ feature, label }: { feature: 'comics'; label: string }) {
  const [waiting, setWaiting] = useState<boolean | null>(null)
  const [join, setJoin] = useState(false)
  useEffect(() => {
    void api<{ waiting: boolean }>(`/me/waitlist/${feature}`).then(
      (r) => setWaiting(r.waiting),
      () => setWaiting(false),
    )
  }, [feature])

  async function toggle() {
    try {
      const r = await api<{ waiting: boolean }>(`/me/waitlist/${feature}`, {
        method: waiting ? 'DELETE' : 'PUT',
      })
      setWaiting(r.waiting)
      toast(r.waiting ? 'We’ll tell you the moment it’s ready' : 'You won’t be notified')
    } catch (e) {
      if (e instanceof ClientApiError && e.status === 401) setJoin(true)
    }
  }

  return (
    <>
      <Button
        size="lg"
        variant={waiting ? 'secondary' : 'primary'}
        onPress={() => void toggle()}
        aria-pressed={!!waiting}
      >
        {waiting ? <CheckIcon size={17} /> : <BellIcon size={17} />}
        {waiting ? 'You’re on the list' : label}
      </Button>
      <SignupPrompt isOpen={join} onClose={() => setJoin(false)} action="hear when comics arrive" />
    </>
  )
}

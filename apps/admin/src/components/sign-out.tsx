'use client'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { api } from '@/lib/client-api'

export function SignOut() {
  const router = useRouter()
  return (
    <Button
      size="sm"
      variant="quiet"
      onPress={async () => {
        await api('/api/auth/sign-out', { method: 'POST', body: {} })
        router.replace('/sign-in')
      }}
    >
      Sign out
    </Button>
  )
}

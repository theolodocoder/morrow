'use client'
import Link from 'next/link'
import { useEffect, useState } from 'react'
import { ShieldIcon } from '@/components/ui/icons'
import { api } from '@/lib/client-api'
import { routes } from '@/lib/routes'

/** In the library: a restriction is never silent, and staff get their way to the console. */
export function StandingBanner() {
  const [restriction, setRestriction] = useState<{ kind: string } | null>(null)
  const [staff, setStaff] = useState(false)
  useEffect(() => {
    void api<{ restriction: { kind: string } | null }>('/me/moderation').then(
      (r) => setRestriction(r.restriction),
      () => {},
    )
    void api<{ role: string | null }>('/me/staff').then(
      (r) => setStaff(!!r.role),
      () => {},
    )
  }, [])
  return (
    <>
      {restriction && (
        <div
          role="status"
          className="mb-6 flex items-center gap-2 rounded-md border border-[var(--text-warning)] bg-canvas px-4 py-3 text-sm text-primary"
        >
          <ShieldIcon size={16} />
          {restriction.kind === 'suspended'
            ? 'Your account is read-only for now.'
            : 'Your account is muted for now.'}
          <Link href={routes.moderationStatus} className="ml-auto text-accent underline underline-offset-2">
            Details and appeal
          </Link>
        </div>
      )}
      {staff && (
        <p className="mb-6 text-right text-[13px]">
          <Link
            href={routes.moderation}
            className="inline-flex items-center gap-1 text-secondary hover:text-primary"
          >
            <ShieldIcon size={14} />
            Moderation console
          </Link>
        </p>
      )}
    </>
  )
}

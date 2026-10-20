'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { InlineAlert } from '@/components/ui/inline-alert'
import { ShieldIcon } from '@/components/ui/icons'
import { api } from '@/lib/client-api'

const field =
  'h-10 rounded-sm border border-control bg-canvas px-3 text-base text-primary outline-none focus:ring-2 focus:ring-focus'

/**
 * Required before any staff tool works: add Morrow to an authenticator app, keep the backup codes, prove a code.
 * The secret is shown as text (copy it into the app) and as an otpauth link (opens the app on a phone).
 */
export default function SetupTwoFactor() {
  const router = useRouter()
  const [enrolment, setEnrolment] = useState<{ uri: string; secret: string; backupCodes: string[] } | null>(
    null,
  )
  const [error, setError] = useState<string | null>(null)
  async function start(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setError(null)
    try {
      const r = await api<{ totpURI: string; backupCodes: string[] }>('/api/auth/two-factor/enable', {
        method: 'POST',
        body: { password: new FormData(e.currentTarget).get('password') },
      })
      setEnrolment({
        uri: r.totpURI,
        secret: new URL(r.totpURI).searchParams.get('secret') ?? '',
        backupCodes: r.backupCodes,
      })
    } catch {
      setError('That password didn’t match.')
    }
  }
  async function confirm(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setError(null)
    try {
      await api('/api/auth/two-factor/verify-totp', {
        method: 'POST',
        body: { code: String(new FormData(e.currentTarget).get('code') ?? '').replace(/\s/g, '') },
      })
      router.replace('/moderation')
      router.refresh()
    } catch {
      setError('That code didn’t work. Check the time on your phone and try the next code.')
    }
  }
  return (
    <main id="main" className="mx-auto flex max-w-lg flex-col gap-5 px-4 py-16">
      <p className="inline-flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.08em] text-tertiary">
        <ShieldIcon size={14} />
        Morrow admin
      </p>
      <h1 className="text-[28px] font-semibold">Set up two-factor sign-in</h1>
      <p className="text-secondary">
        Staff tools can change what millions of readers see, so a password alone isn’t enough.
      </p>
      {error && <InlineAlert>{error}</InlineAlert>}
      {!enrolment ? (
        <form onSubmit={start} className="flex flex-col gap-3">
          <label className="flex flex-col gap-1.5 text-sm font-medium">
            Confirm your password
            <input
              name="password"
              type="password"
              required
              autoComplete="current-password"
              className={field}
            />
          </label>
          <Button type="submit" variant="primary">
            Continue
          </Button>
        </form>
      ) : (
        <form onSubmit={confirm} className="flex flex-col gap-4">
          <div className="rounded-md border border-subtle bg-canvas p-4">
            <p className="text-sm font-medium">1. Add Morrow to your authenticator app with this key</p>
            <p
              aria-label="Setup key"
              className="mt-2 break-all font-mono text-[15px] tracking-wider"
              data-testid="totp-secret"
            >
              {enrolment.secret.match(/.{1,4}/g)?.join(' ')}
            </p>
            <a
              href={enrolment.uri}
              className="mt-2 inline-block text-[13px] text-accent underline underline-offset-2"
            >
              Open in an authenticator app
            </a>
          </div>
          <div className="rounded-md border border-subtle bg-canvas p-4">
            <p className="text-sm font-medium">2. Keep these backup codes somewhere safe</p>
            <ul className="mt-2 grid grid-cols-2 gap-1 font-mono text-[13px]">
              {enrolment.backupCodes.map((c) => (
                <li key={c}>{c}</li>
              ))}
            </ul>
            <p className="mt-2 text-[12px] text-secondary">Each works once if you lose your phone.</p>
          </div>
          <label className="flex flex-col gap-1.5 text-sm font-medium">
            3. Enter the 6-digit code it shows
            <input name="code" required inputMode="numeric" autoComplete="one-time-code" className={field} />
          </label>
          <Button type="submit" variant="primary">
            Turn on and continue
          </Button>
        </form>
      )}
    </main>
  )
}

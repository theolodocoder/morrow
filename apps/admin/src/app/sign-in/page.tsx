'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { InlineAlert } from '@/components/ui/inline-alert'
import { ShieldIcon } from '@/components/ui/icons'
import { api } from '@/lib/client-api'

const field =
  'h-10 rounded-sm border border-control bg-canvas px-3 text-base text-primary outline-none focus:ring-2 focus:ring-focus'

/** Staff sign-in: password, then the authenticator code (two-factor is required for every staff account). */
export default function SignIn() {
  const router = useRouter()
  const [step, setStep] = useState<'password' | 'code'>('password')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const f = new FormData(e.currentTarget)
    setBusy(true)
    setError(null)
    try {
      if (step === 'password') {
        const r = await api<{ twoFactorRedirect?: boolean }>('/api/auth/sign-in/email', {
          method: 'POST',
          body: { email: f.get('email'), password: f.get('password') },
        })
        if (r?.twoFactorRedirect) return setStep('code')
      } else {
        await api('/api/auth/two-factor/verify-totp', {
          method: 'POST',
          body: { code: String(f.get('code') ?? '').replace(/\s/g, '') },
        })
      }
      router.replace('/moderation')
      router.refresh()
    } catch {
      setError(step === 'code' ? 'That code didn’t work.' : 'That email and password don’t match.')
    } finally {
      setBusy(false)
    }
  }
  return (
    <main id="main" className="grid min-h-dvh place-items-center px-4">
      <form
        onSubmit={submit}
        className="flex w-full max-w-sm flex-col gap-4 rounded-md border border-subtle bg-canvas p-6"
      >
        <p className="inline-flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.08em] text-tertiary">
          <ShieldIcon size={14} />
          Morrow admin
        </p>
        <h1 className="text-[24px] font-semibold text-primary">
          {step === 'password' ? 'Staff sign-in' : 'Authentication code'}
        </h1>
        {error && <InlineAlert>{error}</InlineAlert>}
        {step === 'password' ? (
          <>
            <label className="flex flex-col gap-1.5 text-sm font-medium">
              Email
              <input name="email" type="email" required autoComplete="email" className={field} />
            </label>
            <label className="flex flex-col gap-1.5 text-sm font-medium">
              Password
              <input
                name="password"
                type="password"
                required
                autoComplete="current-password"
                className={field}
              />
            </label>
          </>
        ) : (
          <label className="flex flex-col gap-1.5 text-sm font-medium">
            6-digit code from your authenticator app
            <input
              name="code"
              required
              inputMode="numeric"
              autoComplete="one-time-code"
              autoFocus
              className={field}
            />
          </label>
        )}
        <Button type="submit" variant="primary" isDisabled={busy}>
          {busy ? 'One moment…' : 'Continue'}
        </Button>
      </form>
    </main>
  )
}

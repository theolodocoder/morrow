'use client'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { useEffect, useState } from 'react'
import { Form } from 'react-aria-components'
import { Button } from '@/components/ui/button'
import { TextField } from '@/components/ui/text-field'
import { InlineAlert } from '@/components/ui/inline-alert'
import { api, ClientApiError } from '@/lib/client-api'
import { routes } from '@/lib/routes'

export function AuthForm({ mode }: { mode: 'sign-in' | 'sign-up' }) {
  const router = useRouter()
  const params = useSearchParams()
  const next = safeNext(params.get('next'))
  const reset = mode === 'sign-in' && params.get('reset') === '1'
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)
  // Accounts with two-factor on stop here for the authenticator code.
  const [needsCode, setNeedsCode] = useState(false)
  // Until the page is interactive the form is disabled: typing into it before then would be lost when React takes
  // over, and a native submit must never happen (it would put the password in the URL).
  const [ready, setReady] = useState(false)
  useEffect(() => setReady(true), [])
  const done = () => {
    router.replace(next ?? (mode === 'sign-up' ? routes.onboarding : routes.library))
    router.refresh()
  }

  async function verify(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setPending(true)
    setError(null)
    try {
      await api('/api/auth/two-factor/verify-totp', {
        method: 'POST',
        body: { code: String(new FormData(e.currentTarget).get('code') ?? '').replace(/\s/g, '') },
      })
      done()
    } catch {
      setError('That code didn’t work. Check your authenticator app and try again.')
      setPending(false)
    }
  }

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const f = new FormData(e.currentTarget)
    setPending(true)
    setError(null)
    try {
      const res = await api<{ twoFactorRedirect?: boolean }>(
        mode === 'sign-up' ? '/api/auth/sign-up/email' : '/api/auth/sign-in/email',
        {
          method: 'POST',
          body:
            mode === 'sign-up'
              ? { name: f.get('name'), email: f.get('email'), password: f.get('password') }
              : { email: f.get('email'), password: f.get('password') },
        },
      )
      if (res?.twoFactorRedirect) {
        setNeedsCode(true)
        setPending(false)
        return
      }
      // New accounts get the short, skippable onboarding step (FR-003) unless they were on their way somewhere.
      done()
    } catch (err) {
      setError(
        err instanceof ClientApiError && err.status === 401
          ? 'That email and password don’t match.'
          : err instanceof Error
            ? err.message
            : 'Something went wrong.',
      )
      setPending(false)
    }
  }

  if (needsCode)
    return (
      <Form onSubmit={verify} method="post" className="flex flex-col gap-5">
        <h1 className="font-display text-[34px] leading-tight text-primary">One more step</h1>
        <p className="text-secondary">Enter the 6-digit code from your authenticator app.</p>
        {error && <InlineAlert>{error}</InlineAlert>}
        <TextField
          name="code"
          label="Authentication code"
          isRequired
          autoComplete="one-time-code"
          inputMode="numeric"
          autoFocus
        />
        <Button type="submit" variant="primary" size="lg" isDisabled={pending}>
          {pending ? 'Checking…' : 'Continue'}
        </Button>
      </Form>
    )

  return (
    <Form onSubmit={submit} method="post" className="flex flex-col gap-5">
      <header className="mb-3">
        <p className="mb-3 font-mono text-[11px] uppercase tracking-[0.08em] text-tertiary">
          {mode === 'sign-up' ? 'Chapter one' : 'Returning'}
        </p>
        <h1 className="font-display text-[40px] leading-[1.05] text-primary sm:text-[48px]">
          {mode === 'sign-up' ? (
            <>
              Every story starts <em className="block text-accent">on a blank morning.</em>
            </>
          ) : (
            <>
              Welcome back. <span className="block text-secondary">Your pages kept.</span>
            </>
          )}
        </h1>
        <p className="mt-3 font-manuscript text-[17px] leading-relaxed text-secondary">
          {mode === 'sign-up'
            ? 'A private place to write — and, when you’re ready, a place for others to write with you.'
            : 'Your manuscripts are where you left them.'}
        </p>
      </header>
      {error && <InlineAlert>{error}</InlineAlert>}
      {reset && !error && (
        <p role="status" className="rounded-md bg-selected px-3 py-2 text-[14px] text-primary">
          Your password is changed. Sign in with the new one.
        </p>
      )}
      <fieldset disabled={!ready} className="contents">
        {mode === 'sign-up' && <TextField name="name" label="Name" isRequired autoComplete="name" />}
        <TextField name="email" type="email" label="Email" isRequired autoComplete="email" />
        <TextField
          name="password"
          type="password"
          label="Password"
          isRequired
          minLength={10}
          autoComplete={mode === 'sign-up' ? 'new-password' : 'current-password'}
          {...(mode === 'sign-up' ? { description: 'At least 10 characters.' } : {})}
        />
        {mode === 'sign-in' && (
          <Link
            href="/forgot-password"
            className="-mt-3 w-fit text-[13px] text-accent underline-offset-2 hover:underline"
          >
            Forgot your password?
          </Link>
        )}
        <Button type="submit" variant="primary" size="lg" isDisabled={!ready || pending}>
          {pending ? 'One moment…' : mode === 'sign-up' ? 'Create account' : 'Sign in'}
        </Button>
      </fieldset>
      <p className="border-t border-subtle pt-5 text-sm text-secondary">
        {mode === 'sign-up' ? (
          <>
            Already writing here?{' '}
            <Link
              className="text-accent underline underline-offset-2"
              href={next ? `/sign-in?next=${encodeURIComponent(next)}` : '/sign-in'}
            >
              Sign in
            </Link>
          </>
        ) : (
          <>
            New to Morrow?{' '}
            <Link
              className="text-accent underline underline-offset-2"
              href={next ? `/sign-up?next=${encodeURIComponent(next)}` : '/sign-up'}
            >
              Create an account
            </Link>
          </>
        )}
      </p>
    </Form>
  )
}

/** Only same-site relative paths, so `?next=` can't become an open redirect. */
function safeNext(value: string | null): string | null {
  return value && value.startsWith('/') && !value.startsWith('//') && !value.startsWith('/\\') ? value : null
}

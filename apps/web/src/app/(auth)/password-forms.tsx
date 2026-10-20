'use client'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { useEffect, useState } from 'react'
import { Form } from 'react-aria-components'
import { Button } from '@/components/ui/button'
import { InlineAlert } from '@/components/ui/inline-alert'
import { TextField } from '@/components/ui/text-field'
import { api } from '@/lib/client-api'

function useReady() {
  const [ready, setReady] = useState(false)
  useEffect(() => setReady(true), [])
  return ready
}

const kicker = 'mb-3 font-mono text-[11px] uppercase tracking-[0.08em] text-tertiary'

/**
 * Forgot password: ask for a link. The answer is the same whether or not the address has an account, so the form
 * can't be used to find out who's on Morrow.
 */
export function ForgotPasswordForm() {
  const ready = useReady()
  const [sent, setSent] = useState<string | null>(null)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const email = String(new FormData(e.currentTarget).get('email') ?? '')
    setPending(true)
    setError(null)
    try {
      await api('/api/auth/request-password-reset', {
        method: 'POST',
        body: { email, redirectTo: '/reset-password' },
      })
      setSent(email)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'That didn’t work. Try again in a minute.')
    } finally {
      setPending(false)
    }
  }

  if (sent)
    return (
      <div role="status" className="flex flex-col gap-4">
        <p className={kicker}>Check your inbox</p>
        <h1 className="font-display text-[40px] leading-[1.05] text-primary">A link is on its way.</h1>
        <p className="font-manuscript text-[17px] leading-relaxed text-secondary">
          If <span className="text-primary">{sent}</span> has a Morrow account, we’ve sent it a link to choose
          a new password. It works for an hour.
        </p>
        <p className="border-t border-subtle pt-5 text-sm text-secondary">
          Remembered it?{' '}
          <Link className="text-accent underline underline-offset-2" href="/sign-in">
            Sign in
          </Link>
        </p>
      </div>
    )

  return (
    <Form onSubmit={submit} method="post" className="flex flex-col gap-5">
      <header className="mb-3">
        <p className={kicker}>Lost the key</p>
        <h1 className="font-display text-[40px] leading-[1.05] text-primary">Forgot your password?</h1>
        <p className="mt-3 font-manuscript text-[17px] leading-relaxed text-secondary">
          Tell us your email and we’ll send you a link to choose a new one.
        </p>
      </header>
      {error && <InlineAlert>{error}</InlineAlert>}
      <fieldset disabled={!ready} className="contents">
        <TextField name="email" type="email" label="Email" isRequired autoComplete="email" />
        <Button type="submit" variant="primary" size="lg" isDisabled={!ready || pending}>
          {pending ? 'Sending…' : 'Send me a link'}
        </Button>
      </fieldset>
      <p className="border-t border-subtle pt-5 text-sm text-secondary">
        <Link className="text-accent underline underline-offset-2" href="/sign-in">
          Back to sign in
        </Link>
      </p>
    </Form>
  )
}

/** Choose a new password, from the emailed link. Other sessions are signed out when it changes. */
export function ResetPasswordForm() {
  const router = useRouter()
  const params = useSearchParams()
  const token = params.get('token')
  const invalid = params.get('error') === 'INVALID_TOKEN'
  const ready = useReady()
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const f = new FormData(e.currentTarget)
    const password = String(f.get('password') ?? '')
    if (password !== String(f.get('confirm') ?? '')) return setError('The two passwords don’t match.')
    setPending(true)
    setError(null)
    try {
      await api('/api/auth/reset-password', { method: 'POST', body: { newPassword: password, token } })
      router.replace('/sign-in?reset=1')
    } catch {
      setError('This link has expired or was already used. Ask for a new one.')
      setPending(false)
    }
  }

  if (!token || invalid)
    return (
      <div className="flex flex-col gap-4">
        <p className={kicker}>Link expired</p>
        <h1 className="font-display text-[40px] leading-[1.05] text-primary">That link no longer works.</h1>
        <p className="font-manuscript text-[17px] leading-relaxed text-secondary">
          Reset links last an hour and work once.
        </p>
        <Link
          href="/forgot-password"
          className="press inline-flex h-10 w-fit items-center rounded-full bg-action px-5 font-medium text-action-fg hover:bg-action-hover"
        >
          Send a new link
        </Link>
      </div>
    )

  return (
    <Form onSubmit={submit} method="post" className="flex flex-col gap-5">
      <header className="mb-3">
        <p className={kicker}>A fresh page</p>
        <h1 className="font-display text-[40px] leading-[1.05] text-primary">Choose a new password.</h1>
      </header>
      {error && <InlineAlert>{error}</InlineAlert>}
      <fieldset disabled={!ready} className="contents">
        <TextField
          name="password"
          type="password"
          label="New password"
          isRequired
          minLength={10}
          autoComplete="new-password"
          description="At least 10 characters."
        />
        <TextField
          name="confirm"
          type="password"
          label="New password again"
          isRequired
          autoComplete="new-password"
        />
        <Button type="submit" variant="primary" size="lg" isDisabled={!ready || pending}>
          {pending ? 'Saving…' : 'Save new password'}
        </Button>
      </fieldset>
    </Form>
  )
}

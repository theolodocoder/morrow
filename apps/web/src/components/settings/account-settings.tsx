'use client'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { Form } from 'react-aria-components'
import { Button } from '@/components/ui/button'
import { Dialog } from '@/components/ui/dialog'
import { CheckIcon, DownloadIcon, MailIcon, TrashIcon } from '@/components/ui/icons'
import { InlineAlert } from '@/components/ui/inline-alert'
import { TextField } from '@/components/ui/text-field'
import { toast } from '@/components/ui/toast'
import { api, ClientApiError } from '@/lib/client-api'

const section = 'flex flex-col gap-3 rounded-xl border border-subtle bg-canvas p-5'
const heading = 'text-[15px] font-semibold text-primary'

export function AccountSettings({ email, verified }: { email: string; verified: boolean }) {
  const router = useRouter()
  const [pwError, setPwError] = useState<string | null>(null)
  const [pwBusy, setPwBusy] = useState(false)
  const [sent, setSent] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [delError, setDelError] = useState<string | null>(null)
  const [delBusy, setDelBusy] = useState(false)

  async function changePassword(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const form = e.currentTarget
    const f = new FormData(form)
    const next = String(f.get('new') ?? '')
    if (next !== String(f.get('again') ?? '')) return setPwError('The two new passwords don’t match.')
    setPwBusy(true)
    setPwError(null)
    try {
      await api('/api/auth/change-password', {
        method: 'POST',
        body: {
          currentPassword: String(f.get('current') ?? ''),
          newPassword: next,
          revokeOtherSessions: true,
        },
      })
      form.reset()
      toast('Password changed. Other devices are signed out.')
    } catch (err) {
      setPwError(
        err instanceof ClientApiError && err.status === 400
          ? 'Your current password isn’t right, or the new one is too short.'
          : 'That didn’t work. Try again.',
      )
    } finally {
      setPwBusy(false)
    }
  }

  async function resend() {
    await api('/api/auth/send-verification-email', {
      method: 'POST',
      body: { email, callbackURL: '/app' },
    }).catch(() => {})
    setSent(true)
  }

  async function remove(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const f = new FormData(e.currentTarget)
    setDelBusy(true)
    setDelError(null)
    try {
      await api('/me/delete', {
        method: 'POST',
        body: { password: String(f.get('password') ?? ''), confirm: String(f.get('confirm') ?? '') },
      })
      router.replace('/?deleted=1')
      router.refresh()
    } catch (err) {
      setDelError(
        err instanceof ClientApiError && err.status === 400
          ? 'Type DELETE, in capitals, to confirm.'
          : err instanceof Error
            ? err.message
            : 'That didn’t work.',
      )
      setDelBusy(false)
    }
  }

  return (
    <div className="mt-6 flex flex-col gap-5">
      <section aria-labelledby="email" className={section}>
        <h2 id="email" className={heading}>
          Email
        </h2>
        <p className="flex flex-wrap items-center gap-2 text-[14px] text-primary">
          <MailIcon size={16} className="text-tertiary" />
          {email}
          {verified ? (
            <span className="inline-flex items-center gap-1 rounded-full bg-selected px-2 py-0.5 text-[12px] text-success">
              <CheckIcon size={12} /> Confirmed
            </span>
          ) : (
            <span className="rounded-full bg-hover px-2 py-0.5 text-[12px] text-secondary">
              Not confirmed yet
            </span>
          )}
        </p>
        {!verified &&
          (sent ? (
            <p role="status" className="text-[13px] text-secondary">
              Sent. Check your inbox for a link from Morrow.
            </p>
          ) : (
            <Button size="sm" variant="secondary" onPress={() => void resend()} className="w-fit">
              Send the confirmation link again
            </Button>
          ))}
      </section>

      <section aria-labelledby="password" className={section}>
        <h2 id="password" className={heading}>
          Password
        </h2>
        <Form onSubmit={changePassword} method="post" className="flex flex-col gap-3">
          {pwError && <InlineAlert>{pwError}</InlineAlert>}
          <TextField
            name="current"
            type="password"
            label="Current password"
            isRequired
            autoComplete="current-password"
          />
          <TextField
            name="new"
            type="password"
            label="New password"
            isRequired
            minLength={10}
            autoComplete="new-password"
            description="At least 10 characters. You’ll stay signed in here; other devices are signed out."
          />
          <TextField
            name="again"
            type="password"
            label="New password again"
            isRequired
            autoComplete="new-password"
          />
          <Button type="submit" variant="secondary" isDisabled={pwBusy} className="w-fit">
            {pwBusy ? 'Changing…' : 'Change password'}
          </Button>
        </Form>
      </section>

      <section aria-labelledby="data" className={section}>
        <h2 id="data" className={heading}>
          Your data
        </h2>
        <p className="text-[14px] text-secondary">
          Everything that’s yours in one file: your profile, every chapter of the works you own, your
          comments, proposals, follows, likes and settings.
        </p>
        <a
          href="/api/v1/me/export"
          download
          className="press inline-flex h-9 w-fit items-center gap-2 rounded-full border border-control px-4 text-sm font-medium text-primary hover:bg-hover"
        >
          <DownloadIcon size={16} />
          Download your data
        </a>
      </section>

      <section aria-labelledby="danger" className={`${section} border-[var(--text-danger)]`}>
        <h2 id="danger" className={heading}>
          Delete your account
        </h2>
        <p className="text-[14px] text-secondary">
          Works only you have are deleted. Works you share are handed to the next person on them, so nobody
          loses what they wrote with you. Your comments, follows and likes are removed, and you’re signed out
          everywhere. This can’t be undone; download your data first if you want a copy.
        </p>
        <Button variant="danger" onPress={() => setDeleting(true)} className="w-fit">
          <TrashIcon size={16} />
          Delete account…
        </Button>
      </section>

      <Dialog title="Delete your account?" isOpen={deleting} onOpenChange={setDeleting}>
        <Form onSubmit={remove} method="post" className="flex flex-col gap-4">
          {delError && <InlineAlert>{delError}</InlineAlert>}
          <TextField
            name="password"
            type="password"
            label="Your password"
            isRequired
            autoComplete="current-password"
          />
          <TextField name="confirm" label="Type DELETE to confirm" isRequired autoComplete="off" />
          <div className="flex justify-end gap-2">
            <Button variant="quiet" onPress={() => setDeleting(false)}>
              Keep my account
            </Button>
            <Button type="submit" variant="danger" isDisabled={delBusy}>
              {delBusy ? 'Deleting…' : 'Delete forever'}
            </Button>
          </div>
        </Form>
      </Dialog>
    </div>
  )
}

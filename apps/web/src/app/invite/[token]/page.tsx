import Link from 'next/link'
import { notFound } from 'next/navigation'
import type { InvitationPreview } from '@morrow/contracts'
import { AuthSpread } from '@/components/brand/auth-spread'
import { currentUser } from '@/lib/server-api'
import { visitorHeaders } from '@/lib/visitor'
import { AcceptInvitation } from './accept-invitation'

export const metadata = { title: 'Invitation' }
const API = process.env.API_INTERNAL_URL ?? 'http://127.0.0.1:4000'
const ROLE: Record<InvitationPreview['role'], string> = {
  editor: 'an editor',
  collaborator: 'a collaborator',
  contributor: 'a contributor',
  viewer: 'a reader',
}

export default async function InvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  const res = await fetch(`${API}/api/v1/public/invitations/${encodeURIComponent(token)}`, {
    cache: 'no-store',
    headers: await visitorHeaders(),
  })
  if (res.status === 404) notFound()
  // Anything but a preview (rate limited, server trouble) must never be shown as the invitation's state: it once
  // told invitees their invitation was "withdrawn" when the API was only busy.
  if (!res.ok)
    return (
      <AuthSpread state="continuing">
        <p className="mb-3 font-mono text-[11px] uppercase tracking-[0.08em] text-tertiary">An invitation</p>
        <h1 className="font-display text-[36px] leading-tight text-primary">
          We couldn’t open this invitation just now.
        </h1>
        <p className="mt-4 text-secondary">
          {res.status === 429 ? 'Too many tries in a short time.' : 'Something went wrong on our side.'} Wait
          a moment, then reload this page. Your invitation is safe.
        </p>
      </AuthSpread>
    )
  const invite = (await res.json()) as InvitationPreview
  const user = await currentUser()
  const back = `/invite/${token}`

  return (
    <AuthSpread state="continuing">
      <p className="mb-3 font-mono text-[11px] uppercase tracking-[0.08em] text-tertiary">An invitation</p>
      <h1 className="font-display text-[40px] leading-[1.05] text-primary sm:text-[48px]">
        Write <em className="text-accent">{invite.workTitle}</em> together.
      </h1>
      <p className="mt-4 font-manuscript text-[17px] leading-relaxed text-secondary">
        {invite.invitedByName} invited you to join as {ROLE[invite.role]}. Sent to {invite.emailHint}.
      </p>
      <div className="mt-8 border-t border-subtle pt-6">
        {invite.status !== 'pending' ? (
          <p className="text-sm text-secondary">
            {invite.status === 'expired'
              ? 'This invitation has expired.'
              : invite.status === 'used'
                ? 'This invitation has already been used.'
                : 'This invitation was withdrawn.'}{' '}
            Ask {invite.invitedByName} for a new link.
          </p>
        ) : user ? (
          <AcceptInvitation token={token} signedInAs={user.email} />
        ) : (
          <div className="flex flex-col gap-3">
            <Link
              href={`/sign-up?next=${encodeURIComponent(back)}`}
              className="inline-flex h-10 items-center justify-center rounded-full bg-action px-5 font-medium text-action-fg hover:bg-action-hover"
            >
              Create an account to accept
            </Link>
            <Link
              href={`/sign-in?next=${encodeURIComponent(back)}`}
              className="text-center text-sm text-accent underline underline-offset-2"
            >
              I already have an account
            </Link>
          </div>
        )}
      </div>
    </AuthSpread>
  )
}

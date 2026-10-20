import Link from 'next/link'
import type { MyBadges } from '@morrow/contracts'
import { BadgeMedal } from '@/components/profile/badge-medal'
import { YouPage } from '@/components/shell/you'
import { serverApi } from '@/lib/server-api'
import { routes } from '@/lib/routes'

export const metadata = { title: 'Badges' }

/** Your badges (FR-025): what you've earned, and what's still ahead, in plain words. */
export default async function BadgesPage() {
  const b = await serverApi<MyBadges>('/me/badges')
  const earned = b.items.filter((x) => x.awardedAt)
  return (
    <YouPage tab="badges">
      <h2 className="sr-only">Your badges</h2>
      <p className="text-[14px] text-secondary">
        {earned.length} of {b.items.length} earned. Badges mark moments in your writing life; they aren’t a
        score of how good your writing is.{' '}
        {b.showOnProfile ? 'They show on your public profile.' : 'They’re hidden from your public profile.'}{' '}
        <Link href={routes.profileSettings} className="text-accent underline underline-offset-2">
          Change
        </Link>
      </p>
      <ul className="mt-8 grid gap-3 sm:grid-cols-2">
        {b.items.map((x) => (
          <li
            key={x.code}
            className={`flex items-center gap-4 rounded-lg border p-4 ${x.awardedAt ? 'border-subtle bg-canvas' : 'border-dashed border-subtle'}`}
          >
            <BadgeMedal code={x.code} earned={!!x.awardedAt} size={52} />
            <div className="min-w-0">
              <p className={`font-medium ${x.awardedAt ? 'text-primary' : 'text-secondary'}`}>{x.name}</p>
              <p className="text-[13px] text-secondary">{x.description}</p>
              <p className="mt-0.5 text-[12px] text-tertiary">
                {x.awardedAt
                  ? `Earned ${new Date(x.awardedAt).toLocaleDateString('en', { month: 'long', day: 'numeric', year: 'numeric' })}`
                  : 'Not yet'}
              </p>
            </div>
          </li>
        ))}
      </ul>
    </YouPage>
  )
}

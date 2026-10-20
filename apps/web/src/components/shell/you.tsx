import Link from 'next/link'
import type { ReactNode } from 'react'
import { Avatar } from '@/components/profile/avatar'
import { PencilIcon } from '@/components/ui/icons'
import type { AvatarBadge, WritingStats } from '@morrow/contracts'
import { currentUser, serverApi } from '@/lib/server-api'
import { routes } from '@/lib/routes'
import { Shell } from './shell'

const TABS = [
  { id: 'works', href: routes.library, label: 'Works' },
  { id: 'insights', href: routes.dashboard, label: 'Insights' },
  { id: 'reading', href: routes.reading, label: 'Reading list' },
  { id: 'badges', href: routes.badges, label: 'Badges' },
  { id: 'suggestions', href: routes.suggestions, label: 'Suggestions' },
] as const
export type YouTab = (typeof TABS)[number]['id']

/**
 * "You": everything that's yours in one place (was Library, Dashboard, Reading list, Badges and Suggestions, each
 * with its own header). One header with who you are, then tabs.
 */
export async function YouPage({
  tab,
  children,
  action,
}: {
  tab: YouTab
  children: ReactNode
  /** the tab's own primary action (e.g. New work), shown beside the tabs */
  action?: ReactNode
}) {
  const me = (await currentUser())!
  // the badge you wear: your latest, if you show badges (a failure here just means no badge)
  const [{ badge }, writing] = await Promise.all([
    serverApi<{ badge: AvatarBadge | null }>('/me/badge').catch(() => ({ badge: null })),
    // the server's date is close enough for a header; the editor's ring uses the writer's own clock
    serverApi<WritingStats>('/me/writing').catch(() => null),
  ])
  return (
    <Shell title="You">
      <div className="mx-auto max-w-5xl px-4 pt-6 sm:px-8 md:pt-10">
        <div className="flex items-center gap-4">
          <Avatar name={me.name} seed={me.avatarSeed} avatar={me.avatar} badge={badge} size={64} />
          <div className="min-w-0 flex-1">
            <h1 className="truncate font-display text-[26px] leading-tight text-primary sm:text-[30px]">
              {me.name}
            </h1>
            <p className="flex flex-wrap items-center gap-x-3 text-[12px] text-tertiary">
              {me.username && <span className="font-mono">@{me.username}</span>}
              {writing && writing.streak > 0 && (
                <span
                  className="inline-flex items-center gap-1 text-accent"
                  title={`Best: ${writing.best} days`}
                >
                  <svg width="12" height="12" viewBox="0 0 20 20" aria-hidden="true">
                    <circle cx="10" cy="10" r="4" fill="currentColor" />
                    <path
                      d="M10 1.5v2.5M10 16v2.5M1.5 10H4M16 10h2.5M4 4l1.8 1.8M14.2 14.2 16 16M4 16l1.8-1.8M14.2 5.8 16 4"
                      stroke="currentColor"
                      strokeWidth="1.6"
                      strokeLinecap="round"
                    />
                  </svg>
                  {writing.streak}-day writing streak
                </span>
              )}
            </p>
          </div>
          <div className="flex shrink-0 gap-2">
            {me.username && me.profilePublic && (
              <Link
                href={routes.author(me.username)}
                className="press hidden h-9 items-center rounded-full border border-control px-4 text-sm text-primary hover:bg-hover sm:inline-flex"
              >
                View profile
              </Link>
            )}
            <Link
              href={routes.profileSettings}
              aria-label="Edit profile"
              className="press inline-flex h-9 items-center gap-1.5 rounded-full border border-control px-3 text-sm text-primary hover:bg-hover sm:px-4"
            >
              <PencilIcon size={15} />
              <span className="hidden sm:inline">Edit profile</span>
            </Link>
          </div>
        </div>
        <div className="mt-6 flex items-end justify-between gap-3 border-b border-subtle">
          <nav aria-label="Your space" className="-mb-px flex gap-5 overflow-x-auto [scrollbar-width:none]">
            {TABS.map((t) => (
              <Link
                key={t.id}
                href={t.href}
                aria-current={t.id === tab ? 'page' : undefined}
                className={`whitespace-nowrap border-b-2 pb-2.5 text-[14px] transition-colors ${t.id === tab ? 'border-action font-medium text-primary' : 'border-transparent text-secondary hover:text-primary'}`}
              >
                {t.label}
              </Link>
            ))}
          </nav>
          {action && <div className="hidden pb-2 sm:block">{action}</div>}
        </div>
        {action && <div className="mt-4 sm:hidden">{action}</div>}
      </div>
      <main id="main" className="mx-auto max-w-5xl px-4 py-6 sm:px-8">
        {children}
      </main>
    </Shell>
  )
}

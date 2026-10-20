import Link from 'next/link'
import { AppPage } from '@/components/notifications/app-page'
import { SettingsNav } from '@/components/settings/settings-nav'
import { BlockedList } from '@/components/safety/blocked-list'
import { SpotArt } from '@/components/brand/spots'
import { ChevronRightIcon, FlagIcon, ShieldIcon } from '@/components/ui/icons'
import { routes } from '@/lib/routes'

export const metadata = { title: 'Safety' }

const LINKS = [
  {
    href: routes.reports,
    icon: FlagIcon,
    title: 'Your reports',
    body: 'What you’ve reported, and what happened next.',
  },
  {
    href: routes.moderationStatus,
    icon: ShieldIcon,
    title: 'Account standing',
    body: 'Any limits on your account, and how to appeal them.',
  },
] as const

export default function SafetySettingsPage() {
  return (
    <AppPage title="Settings">
      <SettingsNav current="Safety" />
      <div className="flex items-center gap-5 rounded-xl border border-subtle bg-canvas p-5">
        <div className="min-w-0 flex-1">
          <h1 className="font-display text-[26px] leading-tight text-primary">Safety</h1>
          <p className="mt-1 max-w-[48ch] text-[14px] text-secondary">
            You decide who can reach you. Blocking is private: the other person isn’t told, and neither of you
            can follow, comment on or invite the other.
          </p>
        </div>
        <span className="hidden shrink-0 sm:block">
          <SpotArt spot="shield" size={120} />
        </span>
      </div>
      <section aria-labelledby="blocked" className="mt-8">
        <h2 id="blocked" className="mb-3 font-medium text-primary">
          Blocked accounts
        </h2>
        <BlockedList />
      </section>
      <ul className="mt-8 grid gap-3 sm:grid-cols-2">
        {LINKS.map((l) => (
          <li key={l.href}>
            <Link
              href={l.href}
              className="press group flex h-full items-center gap-3 rounded-lg border border-subtle bg-canvas p-4 outline-none transition-colors hover:border-control focus-visible:ring-2 focus-visible:ring-focus"
            >
              <span className="grid size-10 shrink-0 place-items-center rounded-full bg-selected text-accent">
                <l.icon size={18} />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-[15px] font-medium text-primary">{l.title}</span>
                <span className="block text-[13px] text-secondary">{l.body}</span>
              </span>
              <ChevronRightIcon
                size={18}
                className="shrink-0 text-tertiary transition-transform group-hover:translate-x-0.5"
              />
            </Link>
          </li>
        ))}
      </ul>
    </AppPage>
  )
}

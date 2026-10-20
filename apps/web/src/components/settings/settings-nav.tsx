import Link from 'next/link'
import { BellIcon, ChartIcon, FlagIcon, MailIcon, PencilIcon, ShieldIcon } from '@/components/ui/icons'
import { routes } from '@/lib/routes'

const ITEMS = [
  { href: routes.profileSettings, label: 'Profile', icon: PencilIcon },
  { href: routes.accountSettings, label: 'Account', icon: MailIcon },
  { href: routes.notificationSettings, label: 'Notifications', icon: BellIcon },
  { href: routes.planSettings, label: 'Plan', icon: ChartIcon },
  { href: routes.safetySettings, label: 'Safety', icon: ShieldIcon },
  { href: routes.reports, label: 'Reports', icon: FlagIcon },
] as const

/** Settings in one place: the same sections, in the same order, on every settings page. */
export function SettingsNav({ current }: { current: (typeof ITEMS)[number]['label'] }) {
  return (
    <div className="mb-8">
      <p className="mb-2 font-display text-[28px] leading-tight text-primary">Settings</p>
      <nav aria-label="Settings" className="-mx-1 flex gap-1 overflow-x-auto pb-1 [scrollbar-width:none]">
        {ITEMS.map((i) => (
          <Link
            key={i.href}
            href={i.href}
            aria-current={i.label === current ? 'page' : undefined}
            className={`press inline-flex shrink-0 items-center gap-1.5 rounded-full px-3.5 py-1.5 text-[13px] transition-colors ${i.label === current ? 'bg-primary text-canvas' : 'text-secondary hover:bg-hover hover:text-primary'}`}
          >
            <i.icon size={15} />
            {i.label}
          </Link>
        ))}
      </nav>
    </div>
  )
}

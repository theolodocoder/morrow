import Link from 'next/link'
import { SignOut } from '@/components/sign-out'
import { ShieldIcon } from '@/components/ui/icons'
import { requireStaff } from '@/lib/server-api'

const NAV = [
  { href: '/moderation', label: 'Moderation' },
  { href: '/people', label: 'People' },
  { href: '/plans', label: 'Plans' },
  { href: '/audit', label: 'Audit' },
  { href: '/feedback', label: 'Feedback' },
  { href: '/metrics', label: 'Metrics' },
]

/** Every staff page: role and two-factor checked on the server first. */
export default async function StaffLayout({ children }: { children: React.ReactNode }) {
  const me = await requireStaff()
  return (
    <div className="min-h-dvh">
      <header className="flex h-12 items-center gap-6 border-b border-subtle bg-canvas px-4">
        <p className="inline-flex items-center gap-2 text-sm font-semibold">
          <ShieldIcon size={16} />
          Morrow admin
        </p>
        <nav aria-label="Admin" className="flex gap-4 text-sm">
          {NAV.map((n) => (
            <Link key={n.href} href={n.href} className="text-secondary hover:text-primary">
              {n.label}
            </Link>
          ))}
        </nav>
        <span className="ml-auto text-[12px] text-tertiary">{me.role}</span>
        <SignOut />
      </header>
      <main id="main" className="mx-auto max-w-5xl px-4 py-8">
        {children}
      </main>
    </div>
  )
}

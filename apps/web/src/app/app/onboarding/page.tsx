import { redirect } from 'next/navigation'
import type { Profile } from '@morrow/contracts'
import { Logo } from '@/components/brand/logo'
import { serverApi } from '@/lib/server-api'
import { routes } from '@/lib/routes'
import { OnboardingForm } from './onboarding-form'

export const metadata = { title: 'Welcome' }

export default async function Onboarding() {
  const profile = await serverApi<Profile>('/me/profile')
  if (profile.onboarded) redirect(routes.library)
  return (
    <div className="min-h-dvh bg-app">
      <header className="flex h-14 items-center justify-between border-b border-subtle px-4 sm:px-8">
        <Logo height={24} />
        <span className="font-mono text-[11px] uppercase tracking-[0.08em] text-tertiary">
          Welcome — p. 1
        </span>
      </header>
      <main id="main" className="mx-auto max-w-4xl px-4 pb-12 pt-10 sm:pb-20 sm:pt-16">
        <p className="font-mono text-[11px] uppercase tracking-[0.08em] text-tertiary">
          Before the first page
        </p>
        <h1 className="mt-2 font-display text-[34px] leading-tight sm:text-[44px]">
          Welcome, {profile.displayName.split(' ')[0]}.
        </h1>
        <p className="mt-3 max-w-[56ch] text-secondary">
          Pick the name people will know you by. Everything else is optional, and you can change it later.
        </p>
        <div className="mt-10">
          <OnboardingForm profile={profile} />
        </div>
      </main>
    </div>
  )
}

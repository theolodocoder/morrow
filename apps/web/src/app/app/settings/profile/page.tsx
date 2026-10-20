import Link from 'next/link'
import type { Profile } from '@morrow/contracts'
import { Avatar } from '@/components/profile/avatar'
import { SettingsNav } from '@/components/settings/settings-nav'
import { ProfileForm } from '@/components/profile/profile-form'
import { AvatarEditor } from '@/components/profile/avatar-builder'
import { serverApi } from '@/lib/server-api'
import { routes } from '@/lib/routes'
import { AppPage } from '@/components/notifications/app-page'

export const metadata = { title: 'Profile' }

export default async function ProfileSettings() {
  const profile = await serverApi<Profile>('/me/profile')
  return (
    <AppPage title="Settings">
      <SettingsNav current="Profile" />
      <div className="mb-10 flex items-center gap-4">
        <Avatar name={profile.displayName} seed={profile.avatarSeed} avatar={profile.avatar} size={56} />
        <div className="min-w-0">
          <h1 className="font-display text-[22px] leading-tight text-primary">Your profile</h1>
          {profile.onboarded && profile.isPublic && (
            <Link
              href={routes.author(profile.username)}
              className="text-[13px] text-accent underline underline-offset-2"
            >
              View public page
            </Link>
          )}
        </div>
      </div>
      <AvatarEditor name={profile.displayName} seed={profile.avatarSeed} initial={profile.avatar} />
      <ProfileForm profile={profile} />
    </AppPage>
  )
}

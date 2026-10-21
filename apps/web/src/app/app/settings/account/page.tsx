import { AppPage } from '@/components/notifications/app-page'
import { SettingsNav } from '@/components/settings/settings-nav'
import { AccountSettings } from '@/components/settings/account-settings'
import { currentUser } from '@/lib/server-api'

export const metadata = { title: 'Account' }

/** Sign-in and your data: email, password, download everything, delete the account. */
export default async function AccountSettingsPage() {
  const me = (await currentUser())!
  return (
    <AppPage title="Settings">
      <SettingsNav current="Account" />
      <h1 className="font-display text-[22px] leading-tight text-primary">Account</h1>
      <AccountSettings userId={me.id} email={me.email} verified={me.emailVerified} />
    </AppPage>
  )
}

import { AppPage } from '@/components/notifications/app-page'
import { SettingsNav } from '@/components/settings/settings-nav'
import { NotificationSettings } from '@/components/notifications/notification-settings'

export const metadata = { title: 'Notification preferences' }
export default function NotificationSettingsPage() {
  return (
    <AppPage title="Settings">
      <SettingsNav current="Notifications" />
      <h1 className="mb-6 font-display text-[22px] leading-tight text-primary">Notification preferences</h1>
      <NotificationSettings />
    </AppPage>
  )
}

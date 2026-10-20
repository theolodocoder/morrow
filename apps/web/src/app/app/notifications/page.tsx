import { AppPage } from '@/components/notifications/app-page'
import { NotificationCenter } from '@/components/notifications/notification-center'

export const metadata = { title: 'Notifications' }
export default function NotificationsPage() {
  return (
    <AppPage>
      <NotificationCenter />
    </AppPage>
  )
}

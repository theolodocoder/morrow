import { AppPage } from '@/components/notifications/app-page'
import { ModerationStatus } from '@/components/safety/moderation-status'

export const metadata = { title: 'Account standing' }
export default function ModerationStatusPage() {
  return (
    <AppPage title="Account standing" back={{ href: '/app/settings/safety', label: 'Safety' }}>
      <h1 className="mb-6 font-display text-[32px] leading-tight">Account standing</h1>
      <ModerationStatus />
    </AppPage>
  )
}

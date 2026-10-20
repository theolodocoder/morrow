import { AppPage } from '@/components/notifications/app-page'
import { InvitationsInbox } from '@/components/notifications/invitations-inbox'

export const metadata = { title: 'Invitations' }
export default function InvitationsPage() {
  return (
    <AppPage title="Invitations" back={{ href: '/app/notifications', label: 'Activity' }}>
      <h1 className="mb-6 font-display text-[32px] leading-tight">Invitations</h1>
      <InvitationsInbox />
    </AppPage>
  )
}

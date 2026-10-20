import { REPORT_CATEGORY_LABELS } from '@morrow/contracts'
import { SettingsNav } from '@/components/settings/settings-nav'
import { EmptyState } from '@/components/brand/spots'
import { AppPage } from '@/components/notifications/app-page'
import { serverApi } from '@/lib/server-api'

export const metadata = { title: 'Your reports' }
type R = {
  id: string
  targetType: string
  summary: string
  category: keyof typeof REPORT_CATEGORY_LABELS
  status: string
  resolution: string
  createdAt: string
}
const STATUS: Record<string, string> = {
  open: 'Waiting for review',
  reviewing: 'Being reviewed',
  actioned: 'Action taken',
  dismissed: 'No action needed',
}
const when = new Intl.DateTimeFormat('en', { day: 'numeric', month: 'short', year: 'numeric' })

/** "Users can see the outcome of their own reports" (FR-031). */
export default async function ReportsPage() {
  const { items } = await serverApi<{ items: R[] }>('/me/reports')
  return (
    <AppPage title="Settings">
      <SettingsNav current="Reports" />
      <h1 className="font-display text-[22px] leading-tight text-primary">Your reports</h1>
      <p className="mt-2 text-secondary">What you’ve reported, and what moderators decided.</p>
      {items.length === 0 ? (
        <EmptyState spot="inbox" title="You haven’t reported anything." />
      ) : (
        <ul className="mt-6 divide-y divide-subtle border-y border-subtle">
          {items.map((r) => (
            <li key={r.id} className="py-4">
              <div className="flex items-baseline justify-between gap-3">
                <p className="min-w-0 truncate font-medium text-primary">{r.summary}</p>
                <span className="shrink-0 text-[12px] text-secondary">{STATUS[r.status]}</span>
              </div>
              <p className="text-[13px] text-secondary">
                {REPORT_CATEGORY_LABELS[r.category]} · {r.targetType} · {when.format(new Date(r.createdAt))}
              </p>
              {r.resolution && (
                <p className="mt-2 rounded-sm bg-canvas px-3 py-2 text-sm text-primary">{r.resolution}</p>
              )}
            </li>
          ))}
        </ul>
      )}
    </AppPage>
  )
}

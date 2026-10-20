import { notFound } from 'next/navigation'
import { CompForm } from '@/components/comp-form'
import { ApiError, requireStaff, serverApi } from '@/lib/server-api'

export const metadata = { title: 'Person' }
type Detail = {
  id: string
  name: string
  email: string
  username: string | null
  joinedAt: string
  plan: string
  planStatus: string
  restriction: string | null
  staffRole: string | null
  twoFactorEnabled: boolean
  works: number
  actions: { action: string; reason: string; createdAt: string }[]
}

export default async function PersonPage({ params }: { params: Promise<{ userId: string }> }) {
  const me = await requireStaff()
  const { userId } = await params
  const [u, plans] = await Promise.all([
    serverApi<Detail>(`/admin/users/${encodeURIComponent(userId)}`).catch((e) => {
      if (e instanceof ApiError && e.status === 404) notFound()
      throw e
    }),
    serverApi<{ items: { key: string; name: string }[] }>('/admin/plans'),
  ])
  const rows: [string, string][] = [
    ['Email', u.email],
    ['Username', u.username ? `@${u.username}` : '—'],
    ['Joined', new Date(u.joinedAt).toLocaleDateString('en')],
    ['Works', String(u.works)],
    ['Plan', `${u.plan}${u.planStatus === 'comped' ? ' (comped)' : ''}`],
    ['Standing', u.restriction ?? 'Good'],
    ['Staff', u.staffRole ?? 'No'],
    ['Two-factor', u.twoFactorEnabled ? 'On' : 'Off'],
  ]
  return (
    <div className="grid gap-8 lg:grid-cols-[1fr_320px]">
      <div>
        <h1 className="text-[24px] font-semibold">{u.name}</h1>
        <dl className="mt-4 grid grid-cols-[120px_1fr] gap-y-1.5 text-sm">
          {rows.map(([k, v]) => (
            <div key={k} className="contents">
              <dt className="text-secondary">{k}</dt>
              <dd>{v}</dd>
            </div>
          ))}
        </dl>
        <h2 className="mb-2 mt-8 text-sm font-medium">Moderation history</h2>
        {u.actions.length === 0 ? (
          <p className="text-sm text-secondary">None.</p>
        ) : (
          <ul className="divide-y divide-subtle border-y border-subtle text-sm">
            {u.actions.map((a, i) => (
              <li key={i} className="py-2">
                <span className="font-medium">{a.action}</span> ·{' '}
                {new Date(a.createdAt).toLocaleDateString('en')}
                <span className="block text-secondary">{a.reason}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
      {me.role === 'admin' ? (
        <CompForm userId={u.id} plans={plans.items} comped={u.planStatus === 'comped'} />
      ) : (
        <p className="text-[13px] text-secondary">Only admins can change plans.</p>
      )}
    </div>
  )
}

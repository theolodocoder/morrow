import { PlanEditor } from '@/components/plan-editor'
import { requireStaff, serverApi } from '@/lib/server-api'

export const metadata = { title: 'Plans' }
export default async function PlansPage() {
  const me = await requireStaff()
  const { items } = await serverApi<{ items: Parameters<typeof PlanEditor>[0]['plan'][] }>('/admin/plans')
  return (
    <>
      <h1 className="mb-1 text-[24px] font-semibold">Plans</h1>
      <p className="mb-6 text-[13px] text-secondary">
        Limits apply when people create things; lowering one never removes what anyone has.{' '}
        {me.role === 'admin' ? '' : 'Only admins can edit.'}
      </p>
      <div className="flex flex-col gap-4">
        {items.map((p) => (
          <PlanEditor key={p.key} plan={p} editable={me.role === 'admin'} />
        ))}
      </div>
    </>
  )
}

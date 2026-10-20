import { serverApi } from '@/lib/server-api'

export const metadata = { title: 'Audit' }
/** Every staff action, newest first (FR-031 audit history). */
export default async function AuditPage() {
  const { items } = await serverApi<{
    items: { at: string; actor: string; kind: string; subject: string; detail: string }[]
  }>('/admin/audit')
  return (
    <>
      <h1 className="mb-4 text-[24px] font-semibold">Audit</h1>
      <table className="w-full text-left text-sm">
        <thead className="border-b border-subtle text-[12px] text-secondary">
          <tr>
            <th className="py-2 font-medium">When</th>
            <th className="font-medium">Who</th>
            <th className="font-medium">What</th>
            <th className="font-medium">Detail</th>
          </tr>
        </thead>
        <tbody>
          {items.map((i, n) => (
            <tr key={n} className="border-b border-subtle align-top">
              <td className="whitespace-nowrap py-2 pr-3 font-mono text-[12px] text-secondary">
                {new Date(i.at).toLocaleString('en')}
              </td>
              <td className="pr-3">{i.actor}</td>
              <td className="pr-3">
                <span className="font-medium">{i.kind.replace(/_/g, ' ')}</span>
                <span className="block text-[12px] text-tertiary">{i.subject}</span>
              </td>
              <td className="text-secondary">{i.detail}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  )
}

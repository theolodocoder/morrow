import Link from 'next/link'
import { serverApi } from '@/lib/server-api'

export const metadata = { title: 'People' }
type U = {
  id: string
  name: string
  email: string
  username: string | null
  plan: string
  planStatus: string
  restriction: string | null
  staffRole: string | null
}

/** Look someone up by email, name or username. */
export default async function PeoplePage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const q = ((await searchParams).q ?? '').trim()
  const result =
    q.length >= 2 ? await serverApi<{ items: U[] }>(`/admin/users?q=${encodeURIComponent(q)}`) : null
  return (
    <>
      <h1 className="mb-4 text-[24px] font-semibold">People</h1>
      <form role="search" className="mb-6 flex gap-2">
        <label htmlFor="q" className="sr-only">
          Email, name or username
        </label>
        <input
          id="q"
          name="q"
          defaultValue={q}
          placeholder="Email, name or username"
          className="h-10 w-full max-w-md rounded-sm border border-control bg-canvas px-3 text-base outline-none focus:ring-2 focus:ring-focus"
        />
        <button type="submit" className="h-10 rounded-sm border border-control px-4 text-sm hover:bg-hover">
          Search
        </button>
      </form>
      {result &&
        (result.items.length === 0 ? (
          <p className="text-secondary">No one matches.</p>
        ) : (
          <table className="w-full text-left text-sm">
            <thead className="border-b border-subtle text-[12px] text-secondary">
              <tr>
                <th className="py-2 font-medium">Person</th>
                <th className="font-medium">Plan</th>
                <th className="font-medium">Standing</th>
              </tr>
            </thead>
            <tbody>
              {result.items.map((u) => (
                <tr key={u.id} className="border-b border-subtle">
                  <td className="py-2">
                    <Link
                      href={`/people/${u.id}`}
                      className="font-medium text-accent underline-offset-2 hover:underline"
                    >
                      {u.name}
                    </Link>
                    <span className="block text-[12px] text-secondary">
                      {u.email}
                      {u.username ? ` · @${u.username}` : ''}
                      {u.staffRole ? ` · ${u.staffRole}` : ''}
                    </span>
                  </td>
                  <td>
                    {u.plan}
                    {u.planStatus === 'comped' ? ' (comped)' : ''}
                  </td>
                  <td>{u.restriction ?? 'Good'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ))}
    </>
  )
}

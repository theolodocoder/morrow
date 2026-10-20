import { serverApi } from '@/lib/server-api'

export const metadata = { title: 'Metrics' }
type Day = {
  day: string
  signups: number
  works: number
  active_writers: number
  publishes: number
  proposals: number
  comments: number
}
type M = { totals: { people: number; works: number; published: number; collaborative: number }; daily: Day[] }
const SERIES: { key: keyof Omit<Day, 'day'>; label: string }[] = [
  { key: 'signups', label: 'Sign-ups' },
  { key: 'active_writers', label: 'People writing' },
  { key: 'works', label: 'Works started' },
  { key: 'publishes', label: 'Publications' },
  { key: 'proposals', label: 'Proposals' },
  { key: 'comments', label: 'Comments' },
]

/** A small trend line, drawn in our own SVG (no chart library, no tracking). Decorative: numbers are beside it. */
function Spark({ values }: { values: number[] }) {
  const max = Math.max(1, ...values)
  const pts = values.map((v, i) => `${(i / (values.length - 1)) * 120},${28 - (v / max) * 26}`).join(' ')
  return (
    <svg viewBox="0 0 120 30" width="120" height="30" aria-hidden="true" className="text-accent">
      <polyline
        points={pts}
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </svg>
  )
}

/**
 * The beta's vital signs: counts derived from Morrow's own records, by day. No tracking script, no cookies, no third
 * party, and nothing about anyone's manuscript text.
 */
export default async function MetricsPage() {
  const m = await serverApi<M>('/admin/metrics')
  const sum = (k: keyof Omit<Day, 'day'>) => m.daily.reduce((n, d) => n + d[k], 0)
  return (
    <>
      <h1 className="mb-1 text-[24px] font-semibold">Metrics</h1>
      <p className="mb-6 text-[13px] text-secondary">
        Counted from Morrow’s own records. Nobody is tracked to produce these.
      </p>
      <dl className="mb-8 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          ['People', m.totals.people],
          ['Works', m.totals.works],
          ['Published', m.totals.published],
          ['Written together', m.totals.collaborative],
        ].map(([k, v]) => (
          <div key={k} className="rounded-md border border-subtle bg-canvas p-3">
            <dt className="text-[12px] text-secondary">{k}</dt>
            <dd className="text-[24px] font-semibold">{v}</dd>
          </div>
        ))}
      </dl>
      <table className="w-full text-left text-sm">
        <caption className="sr-only">The last 30 days</caption>
        <thead className="border-b border-subtle text-[12px] text-secondary">
          <tr>
            <th className="py-2 font-medium">Last 30 days</th>
            <th className="font-medium">Total</th>
            <th className="font-medium">Today</th>
            <th className="font-medium">Trend</th>
          </tr>
        </thead>
        <tbody>
          {SERIES.map((s) => (
            <tr key={s.key} className="border-b border-subtle">
              <th scope="row" className="py-2 font-normal">
                {s.label}
              </th>
              <td>{sum(s.key)}</td>
              <td>{m.daily.at(-1)?.[s.key] ?? 0}</td>
              <td>
                <Spark values={m.daily.map((d) => d[s.key])} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  )
}

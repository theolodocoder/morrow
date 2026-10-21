import Link from 'next/link'
import { EmptyState } from '@/components/brand/spots'
import { DASHBOARD_PERIODS, type Dashboard } from '@morrow/contracts'
import { Avatar } from '@/components/profile/avatar'
import { YouPage } from '@/components/shell/you'
import { MilestoneCard } from '@/components/dashboard/milestone-card'
import { DashboardChart, Sparkline } from '@/components/dashboard/dashboard-chart'
import { METRIC_LABELS } from '@/components/dashboard/metrics'
import { FollowBack } from '@/components/dashboard/follow-back'
import { compact, timeAgo } from '@/lib/format'
import { serverApi } from '@/lib/server-api'
import { routes } from '@/lib/routes'

export const metadata = { title: 'Dashboard' }
type Params = { searchParams: Promise<{ days?: string; milestone?: string; work?: string }> }
type Key = keyof Dashboard['totals']

/** "+25%", "−10%", "New" (nothing before), or "No change". */
function change({ current, previous }: { current: number; previous: number }) {
  if (current === previous) return { text: 'No change', tone: 'flat' as const }
  if (previous === 0) return { text: 'New', tone: 'up' as const }
  const pct = Math.round(((current - previous) / previous) * 100)
  return pct >= 0
    ? { text: `+${pct}%`, tone: 'up' as const }
    : { text: `−${Math.abs(pct)}%`, tone: 'down' as const }
}

const VERB: Record<Dashboard['activity'][number]['kind'], string> = {
  like: 'liked',
  comment: 'commented on',
  follow: 'started following you',
  work_follow: 'followed',
}

/** The writer's dashboard: your profile at a glance, and what readers have been doing with your work. */
export default async function DashboardPage({ searchParams }: Params) {
  const sp = await searchParams
  const asked = Number(sp.days)
  // opened from a milestone notification: "reads-100"
  const m = sp.milestone?.match(/^(reads|likes)-(\d+)$/)
  const days = (DASHBOARD_PERIODS as readonly number[]).includes(asked) ? asked : 30
  const d = await serverApi<Dashboard>(`/me/dashboard?days=${days}`)
  const p = d.profile
  const cards: Key[] = ['reads', 'likes', 'comments', 'followers', 'saves', 'profileViews']

  return (
    <YouPage tab="insights">
      <div className="flex flex-col gap-8">
        {m && sp.work && <MilestoneCard workId={sp.work} kind={m[1] as 'reads' | 'likes'} n={Number(m[2])} />}
        {/* who you are to readers, at a glance */}
        <dl className="flex flex-wrap gap-x-6 gap-y-1 text-[14px]">
          {(
            [
              ['Followers', p.followers],
              ['Following', p.following],
              ['Published', p.publishedWorks],
              ['Badges', p.badges],
            ] as const
          ).map(([label, n]) => (
            <div key={label} className="flex items-baseline gap-1.5">
              <dt className="order-2 text-secondary">{label}</dt>
              <dd className="order-1 font-semibold tabular-nums text-primary">{compact(n)}</dd>
            </div>
          ))}
        </dl>
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="font-display text-[24px] text-primary">How your writing is doing</h2>
            <p className="text-[13px] text-secondary">
              The last {days} days, compared with the {days} before. Days are in UTC.
            </p>
          </div>
          <nav aria-label="Period" className="flex gap-1 rounded-sm border border-subtle bg-canvas p-0.5">
            {DASHBOARD_PERIODS.map((n) => (
              <Link
                key={n}
                href={`${routes.dashboard}?days=${n}`}
                aria-current={n === days ? 'page' : undefined}
                className={`rounded-[3px] px-3 py-1 text-[13px] ${n === days ? 'bg-selected text-primary' : 'text-secondary hover:text-primary'}`}
              >
                {n} days
              </Link>
            ))}
          </nav>
        </div>

        <ul className="grid grid-cols-2 gap-3 lg:grid-cols-3">
          {cards.map((k) => {
            const c = change(d.totals[k])
            return (
              <li key={k} className="rounded-lg border border-subtle bg-canvas p-4">
                <p className="text-[13px] text-secondary">{METRIC_LABELS[k]}</p>
                <p className="mt-1 flex items-baseline gap-2">
                  <span className="font-display text-[30px] leading-none tabular-nums text-primary">
                    {compact(d.totals[k].current)}
                  </span>
                  <span
                    className={`text-[12px] font-medium ${c.tone === 'up' ? 'text-success' : c.tone === 'down' ? 'text-danger' : 'text-tertiary'}`}
                  >
                    {c.text}
                    <span className="sr-only"> compared with the previous {days} days</span>
                  </span>
                </p>
                <div className="mt-2">
                  <Sparkline values={d.daily.map((x) => x[k])} />
                </div>
              </li>
            )
          })}
        </ul>

        <DashboardChart daily={d.daily} />

        <div className="flex flex-col gap-8">
          <section aria-labelledby="works-heading" className="min-w-0">
            <h2 id="works-heading" className="mb-3 text-[15px] font-medium text-primary">
              Your published work
            </h2>
            {d.works.length === 0 ? (
              <div className="rounded-lg border border-subtle bg-canvas">
                <EmptyState
                  spot="chart"
                  title="Publish something and its readers will show up here."
                  action={
                    <Link href={routes.library} className="text-sm text-accent underline">
                      Go to your works
                    </Link>
                  }
                />
              </div>
            ) : (
              <div className="overflow-x-auto rounded-lg border border-subtle bg-canvas" tabIndex={0}>
                <table className="w-full min-w-[560px] text-left text-[13px]">
                  <thead className="text-tertiary">
                    <tr>
                      <th scope="col" className="px-4 py-2.5 font-normal">
                        Work
                      </th>
                      <th scope="col" className="px-2 py-2.5 text-right font-normal">
                        Reads ({days}d)
                      </th>
                      <th scope="col" className="px-2 py-2.5 text-right font-normal">
                        All reads
                      </th>
                      <th scope="col" className="px-2 py-2.5 text-right font-normal">
                        Likes
                      </th>
                      <th scope="col" className="px-2 py-2.5 text-right font-normal">
                        Comments
                      </th>
                      <th scope="col" className="px-2 py-2.5 text-right font-normal">
                        Saves
                      </th>
                      <th scope="col" className="px-4 py-2.5 text-right font-normal">
                        Followers
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {d.works.map((w) => (
                      <tr key={w.appWorkId} className="border-t border-subtle">
                        <th scope="row" className="px-4 py-3 font-normal">
                          <Link
                            href={routes.publicWork(w.publicPath)}
                            className="font-medium text-primary hover:underline"
                          >
                            {w.title}
                          </Link>
                          <span className="block text-[12px] text-tertiary">
                            {w.completed ? 'Complete' : 'Ongoing'} · published {timeAgo(w.publishedAt)} ·{' '}
                            <Link
                              href={routes.work(w.appWorkId)}
                              className="underline-offset-2 hover:underline"
                            >
                              Edit
                            </Link>
                          </span>
                        </th>
                        {[w.readsInPeriod, w.reads, w.likes, w.comments, w.saves, w.workFollowers].map(
                          (n, i) => (
                            <td
                              key={i}
                              className={`py-3 text-right tabular-nums text-primary ${i === 5 ? 'px-4' : 'px-2'}`}
                            >
                              {compact(n)}
                            </td>
                          ),
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <section aria-labelledby="activity-heading" className="min-w-0">
            <h2 id="activity-heading" className="mb-3 text-[15px] font-medium text-primary">
              Recent activity
            </h2>
            {d.activity.length === 0 ? (
              <div className="rounded-lg border border-subtle bg-canvas">
                <EmptyState spot="inbox" title="Likes, comments and new followers will appear here." />
              </div>
            ) : (
              <ol className="divide-y divide-subtle rounded-lg border border-subtle bg-canvas">
                {d.activity.map((a, i) => (
                  <li key={`${a.kind}${a.at}${i}`} className="flex gap-3 px-4 py-3">
                    <Avatar
                      name={a.person.displayName}
                      seed={a.person.avatarSeed}
                      avatar={a.person.avatar}
                      size={32}
                    />
                    <div className="min-w-0 flex-1 text-[14px]">
                      <p className="text-secondary">
                        {a.person.username ? (
                          <Link
                            href={routes.author(a.person.username)}
                            className="font-medium text-primary hover:underline"
                          >
                            {a.person.displayName}
                          </Link>
                        ) : (
                          <span className="font-medium text-primary">{a.person.displayName}</span>
                        )}{' '}
                        {VERB[a.kind]}
                        {a.work && (
                          <>
                            {' '}
                            <Link
                              href={
                                a.chapterSlug
                                  ? `${routes.readChapter(a.work.publicPath, a.chapterSlug)}#discussion`
                                  : `${routes.publicWork(a.work.publicPath)}${a.kind === 'comment' ? '#comments' : ''}`
                              }
                              className="text-primary hover:underline"
                            >
                              {a.work.title}
                            </Link>
                          </>
                        )}
                      </p>
                      {a.excerpt && (
                        <p className="mt-0.5 line-clamp-2 font-manuscript text-[14px] text-primary">
                          “{a.excerpt}”
                        </p>
                      )}
                      <p className="text-[12px] text-tertiary">{timeAgo(a.at)}</p>
                    </div>
                    {a.followingBack !== null && a.person.username && (
                      <FollowBack
                        username={a.person.username}
                        name={a.person.displayName}
                        initial={a.followingBack}
                      />
                    )}
                  </li>
                ))}
              </ol>
            )}
            <p className="mt-2 text-[12px] text-tertiary">
              Who read or saved your work stays private: you see how many, never who.
            </p>
          </section>
        </div>
      </div>
    </YouPage>
  )
}

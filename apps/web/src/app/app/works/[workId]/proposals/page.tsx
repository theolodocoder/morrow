import Link from 'next/link'
import { Shell } from '@/components/shell/shell'
import { EmptyState } from '@/components/brand/spots'
import { notFound } from 'next/navigation'
import type { ProposalSummary, Work } from '@morrow/contracts'
import { KIND_LABEL, StatusPill } from '@/components/proposals/labels'
import { Avatar } from '@/components/profile/avatar'
import { ApiError, serverApi } from '@/lib/server-api'
import { routes } from '@/lib/routes'

export const metadata = { title: 'Proposals' }
type Params = { params: Promise<{ workId: string }>; searchParams: Promise<{ status?: string }> }
const when = new Intl.DateTimeFormat('en', { day: 'numeric', month: 'short' })

export default async function ProposalsPage({ params, searchParams }: Params) {
  const { workId } = await params
  const status = (await searchParams).status === 'closed' ? 'closed' : 'open'
  const [work, list] = await Promise.all([
    serverApi<Work>(`/works/${workId}`),
    serverApi<{ items: ProposalSummary[] }>(`/works/${workId}/proposals?status=${status}`),
  ]).catch((e) => {
    if (e instanceof ApiError && e.status === 404) notFound()
    throw e
  })
  const reviewer = work.capabilities.includes('proposal.review')
  return (
    <Shell title="Proposals" back={{ href: routes.work(work.id), label: work.title }}>
      <main id="main" className="mx-auto max-w-3xl px-4 py-6 sm:px-8 md:py-8">
        <h1 className="font-display text-[28px] leading-tight sm:text-[36px]">Proposals</h1>
        <p className="mt-2 text-secondary">
          {reviewer
            ? 'Changes and ideas people have offered for this work. Nothing changes until you accept it.'
            : 'What you’ve proposed for this work, and where each one stands.'}
        </p>
        <nav aria-label="Filter" className="mt-6 inline-flex gap-1 rounded-full bg-hover p-1">
          {(['open', 'closed'] as const).map((s) => (
            <Link
              key={s}
              href={routes.proposals(work.id, s)}
              aria-current={status === s ? 'page' : undefined}
              className={`press rounded-full px-4 py-1.5 text-sm transition-colors ${status === s ? 'bg-canvas text-primary shadow-sm' : 'text-secondary hover:text-primary'}`}
            >
              {s === 'open' ? 'Open' : 'Closed'}
            </Link>
          ))}
        </nav>
        {list.items.length === 0 ? (
          <EmptyState
            spot="together"
            title={status === 'open' ? 'No open proposals.' : 'Nothing decided yet.'}
            body={status === 'open' ? 'Propose a change from any chapter.' : undefined}
          />
        ) : (
          <ul className="mt-4 divide-y divide-subtle">
            {list.items.map((p) => (
              <li key={p.id}>
                <Link
                  href={routes.proposal(work.id, p.id)}
                  className="press flex items-center gap-3 rounded-md px-2 py-3.5 hover:bg-hover"
                >
                  <Avatar name={p.author.name} seed={p.author.id} size={36} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium text-primary">{p.title}</p>
                    <p className="text-[13px] text-secondary">
                      {KIND_LABEL[p.kind]}
                      {p.chapter ? ` · ${p.chapter.title}` : ''} · {p.author.name} ·{' '}
                      {when.format(new Date(p.updatedAt))}
                    </p>
                  </div>
                  <StatusPill status={p.status} />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </main>
    </Shell>
  )
}

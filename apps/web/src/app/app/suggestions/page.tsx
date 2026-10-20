import Link from 'next/link'
import { EmptyState } from '@/components/brand/spots'
import type { ProposalSummary } from '@morrow/contracts'
import { YouPage } from '@/components/shell/you'
import { KIND_LABEL, StatusPill } from '@/components/proposals/labels'
import { serverApi } from '@/lib/server-api'
import { routes } from '@/lib/routes'

export const metadata = { title: 'Your suggestions' }
const when = new Intl.DateTimeFormat('en', { day: 'numeric', month: 'short' })

/** Everything you've proposed, in your works and in others' (public participation). */
export default async function SuggestionsPage() {
  const { items } = await serverApi<{ items: ProposalSummary[] }>('/me/proposals')
  return (
    <YouPage tab="suggestions">
      <h2 className="sr-only">Your suggestions</h2>
      <p className="mt-2 text-secondary">Edits and ideas you’ve offered, and where each one stands.</p>
      {items.length === 0 ? (
        <EmptyState
          spot="together"
          title="No suggestions yet."
          body="On a published chapter that welcomes them, choose “Suggest an edit”."
        />
      ) : (
        <ul className="mt-6 divide-y divide-subtle border-y border-subtle">
          {items.map((p) => (
            <li key={p.id}>
              <Link
                href={routes.proposal(p.workId, p.id)}
                className="flex items-start gap-4 px-2 py-4 hover:bg-hover"
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium text-primary">{p.title}</p>
                  <p className="text-[13px] text-secondary">
                    {KIND_LABEL[p.kind]}
                    {p.chapter ? ` · ${p.chapter.title}` : ''} · {when.format(new Date(p.updatedAt))}
                  </p>
                </div>
                <StatusPill status={p.status} />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </YouPage>
  )
}

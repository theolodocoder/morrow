import Link from 'next/link'
import { EmptyState } from '@/components/brand/spots'
import type { ReadingList } from '@morrow/contracts'
import { YouPage } from '@/components/shell/you'
import { Avatar } from '@/components/profile/avatar'
import { serverApi } from '@/lib/server-api'
import { routes } from '@/lib/routes'
import { CATEGORY_OPTIONS, labelOf } from '@/lib/work-options'

export const metadata = { title: 'Reading list' }
type W = ReadingList['bookmarks'][number]

function WorkRow({ w }: { w: W }) {
  const href = w.publicPath ? routes.publicWork(w.publicPath) : routes.work(w.appWorkId!)
  return (
    <li>
      <Link href={href} className="block py-3 hover:bg-hover">
        <p className="font-manuscript text-[18px] text-primary">{w.title}</p>
        <p className="text-[13px] text-secondary">
          {labelOf(CATEGORY_OPTIONS, w.category)} · by {w.authorName}
          {!w.publicPath && ' · no longer public (you’re a member)'}
        </p>
      </Link>
    </li>
  )
}

/** The personal library (FR-022): bookmarks, works and writers you follow. */
export default async function ReadingListPage() {
  const list = await serverApi<ReadingList>('/me/reading-list')
  const empty = !list.bookmarks.length && !list.works.length && !list.authors.length
  return (
    <YouPage tab="reading">
      <h2 className="sr-only">Reading list</h2>
      {empty ? (
        <EmptyState
          spot="shelf"
          title="Your shelf is waiting."
          body="Save works and follow writers from their pages, and they’ll be here."
        />
      ) : (
        <div className="mt-8 flex flex-col gap-10">
          {list.bookmarks.length > 0 && (
            <section aria-labelledby="bookmarks">
              <h2
                id="bookmarks"
                className="mb-2 font-mono text-[11px] uppercase tracking-[0.08em] text-tertiary"
              >
                Bookmarks
              </h2>
              <ul className="divide-y divide-subtle border-y border-subtle">
                {list.bookmarks.map((w, i) => (
                  <WorkRow key={i} w={w} />
                ))}
              </ul>
            </section>
          )}
          {list.works.length > 0 && (
            <section aria-labelledby="works">
              <h2 id="works" className="mb-2 font-mono text-[11px] uppercase tracking-[0.08em] text-tertiary">
                Works you follow
              </h2>
              <ul className="divide-y divide-subtle border-y border-subtle">
                {list.works.map((w, i) => (
                  <WorkRow key={i} w={w} />
                ))}
              </ul>
            </section>
          )}
          {list.authors.length > 0 && (
            <section aria-labelledby="authors">
              <h2
                id="authors"
                className="mb-2 font-mono text-[11px] uppercase tracking-[0.08em] text-tertiary"
              >
                Writers you follow
              </h2>
              <ul className="flex flex-wrap gap-3">
                {list.authors.map((a) => (
                  <li key={a.username}>
                    <Link
                      href={routes.author(a.username)}
                      className="flex items-center gap-2 rounded-full border border-subtle bg-canvas py-1 pl-1 pr-3 hover:bg-hover"
                    >
                      <Avatar name={a.displayName} seed={a.avatarSeed} avatar={a.avatar} size={28} />
                      <span className="text-sm text-primary">{a.displayName}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>
      )}
    </YouPage>
  )
}

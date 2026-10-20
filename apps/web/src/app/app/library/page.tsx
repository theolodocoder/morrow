import Link from 'next/link'
import { EmptyState } from '@/components/brand/spots'
import type { Work } from '@morrow/contracts'
import { serverApi } from '@/lib/server-api'
import { WorkCover } from '@/components/work-cover'
import { NewWorkButton } from './new-work-button'
import { routes } from '@/lib/routes'
import { StandingBanner } from '@/components/safety/standing-banner'
import { YouPage } from '@/components/shell/you'

export const metadata = { title: 'Your works' }

const CATEGORY_LABEL: Record<Work['category'], string> = {
  fiction: 'Fiction',
  novel: 'Novel',
  novella: 'Novella',
  short_story: 'Short story',
  collection: 'Collection',
  poetry: 'Poetry',
  article: 'Article',
  essay: 'Essay',
  research_paper: 'Research paper',
  educational: 'Educational',
  general_document: 'Document',
  other: 'Work',
}
const words = new Intl.NumberFormat('en')
const ROLE_NAME = {
  owner: 'Owner',
  editor: 'Editor',
  collaborator: 'Collaborator',
  contributor: 'Contributor',
  viewer: 'Reader',
} as const
/** Who can see this work, in plain words: "Private", "Shared with 3", or your role on someone else's work. */
function sharing(w: Work) {
  if (w.myRole && w.myRole !== 'owner') return `Shared with you · ${ROLE_NAME[w.myRole]}`
  if (w.publishedAt && w.visibility !== 'private')
    return w.visibility === 'public' ? 'Published' : 'Published · link only'
  return w.memberCount > 1 ? `Shared with ${w.memberCount - 1}` : 'Private'
}
const when = new Intl.DateTimeFormat('en', {
  day: 'numeric',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit',
})

function WorkRow({ w }: { w: Work }) {
  return (
    <li>
      <Link
        href={routes.work(w.id)}
        className="press flex items-center gap-4 rounded-md px-2 py-3 outline-none hover:bg-hover focus-visible:bg-hover"
      >
        <WorkCover cover={w.cover} title={w.title} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-[15px] font-semibold text-primary">{w.title}</p>
          <p className="text-[13px] text-secondary">
            {CATEGORY_LABEL[w.category]} · {sharing(w)}
          </p>
        </div>
        <div className="shrink-0 text-right font-mono text-[11px] text-tertiary sm:text-[12px]">
          <p>{words.format(w.wordCount)} words</p>
          <p className="hidden sm:block">{when.format(new Date(w.updatedAt))}</p>
        </div>
      </Link>
    </li>
  )
}

/** You → Works: what you're writing, then what others have shared with you. */
export default async function Library() {
  const { items } = await serverApi<{ items: Work[] }>('/works')
  const mine = items.filter((w) => !w.myRole || w.myRole === 'owner')
  const shared = items.filter((w) => w.myRole && w.myRole !== 'owner')
  return (
    <YouPage tab="works" action={<NewWorkButton />}>
      <StandingBanner />
      {items.length === 0 ? (
        <EmptyState
          spot="page"
          title="Every work starts as a single line."
          body="A story, a book, a poem, an article or a paper: start alone, or invite people to write it with you."
          action={<NewWorkButton />}
        />
      ) : (
        <div className="flex flex-col gap-8">
          {mine.length > 0 && (
            <section aria-labelledby="mine">
              <h2 id="mine" className="mb-1 text-[13px] font-medium text-secondary">
                Your works <span className="text-tertiary">{mine.length}</span>
              </h2>
              <ul className="flex flex-col">
                {mine.map((w) => (
                  <WorkRow key={w.id} w={w} />
                ))}
              </ul>
            </section>
          )}
          {shared.length > 0 && (
            <section aria-labelledby="shared">
              <h2 id="shared" className="mb-1 text-[13px] font-medium text-secondary">
                Shared with you <span className="text-tertiary">{shared.length}</span>
              </h2>
              <ul className="flex flex-col">
                {shared.map((w) => (
                  <WorkRow key={w.id} w={w} />
                ))}
              </ul>
            </section>
          )}
        </div>
      )}
    </YouPage>
  )
}

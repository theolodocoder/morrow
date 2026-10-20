import Link from 'next/link'
import { EmptyState } from '@/components/brand/spots'
import type { WORK_CATEGORIES } from '@morrow/contracts'
import { type Feed, type WeeklyPrompt } from '@morrow/contracts'
import { Shell } from '@/components/shell/shell'
import { HomeHero } from '@/components/public/home-hero'
import { FeedList } from '@/components/public/feed-list'
import { FeedFilters } from '@/components/public/feed-filters'
import { PullToRefresh } from '@/components/public/pull-to-refresh'
import { PublishIcon, SearchIcon } from '@/components/ui/icons'
import { publicApi, publicApiAsViewer } from '@/lib/public-api'
import { PromptCard } from '@/components/public/prompt-card'
import { currentUser } from '@/lib/server-api'
import { routes } from '@/lib/routes'
import { CATEGORY_OPTIONS } from '@/lib/work-options'

export const metadata = {
  title: { absolute: 'Morrow: stories, articles, poems and papers, written in the open' },
  description: 'Scroll what people are writing: stories, novels, poems, articles, essays and research.',
}

type Params = { searchParams: Promise<{ category?: string; sort?: string; deleted?: string }> }
type Sort = 'latest' | 'for_you' | 'popular' | 'following'
type Category = (typeof WORK_CATEGORIES)[number]

// The order readers look for things in, not the order they were added to the product.
const CHIPS: Category[] = [
  'short_story',
  'novel',
  'poetry',
  'article',
  'essay',
  'research_paper',
  'fiction',
  'novella',
  'collection',
  'educational',
  'general_document',
  'other',
]
const plural: Partial<Record<Category, string>> = {
  short_story: 'Stories',
  novel: 'Books',
  article: 'Articles',
  essay: 'Essays',
  research_paper: 'Papers',
  novella: 'Novellas',
  collection: 'Collections',
  general_document: 'Documents',
}

/** Home (FR-020): one scrolling feed of published pieces, for everyone. Free to read for everyone (P-049). */
export default async function Home({ searchParams }: Params) {
  const sp = await searchParams
  const me = await currentUser()
  const category = CHIPS.find((c) => c === sp.category)
  const sort: Sort =
    sp.sort === 'popular'
      ? 'popular'
      : sp.sort === 'following' && me
        ? 'following'
        : sp.sort === 'for_you' && me
          ? 'for_you'
          : 'latest'
  const q = new URLSearchParams()
  if (category) q.set('category', category)
  if (sort !== 'latest') q.set('sort', sort)
  const [feed, prompt] = await Promise.all([
    publicApiAsViewer<Feed>(`/feed?${q}`),
    publicApi<WeeklyPrompt>('/prompt').catch(() => null),
  ])
  const href = (next: { category?: string | undefined; sort?: Sort }) => {
    const p = new URLSearchParams()
    if (next.category) p.set('category', next.category)
    if (next.sort && next.sort !== 'latest') p.set('sort', next.sort)
    return p.size ? `/?${p}` : '/'
  }
  const tabs: { id: Sort; label: string }[] = [
    { id: 'latest', label: 'Latest' },
    ...(me ? [{ id: 'for_you' as const, label: 'For you' }] : []),
    { id: 'popular', label: 'Popular' },
    ...(me ? [{ id: 'following' as const, label: 'Following' }] : []),
  ]

  return (
    <Shell bg="app" title="Home">
      <PullToRefresh />
      {sp.deleted === '1' && !me && (
        <p
          role="status"
          className="mx-auto mt-4 max-w-[640px] rounded-lg bg-selected px-4 py-3 text-[14px] text-primary"
        >
          Your account has been deleted. Thank you for writing with us.
        </p>
      )}
      {!me && <HomeHero />}
      <div className="mx-auto grid gap-8 pb-24 sm:px-6 max-w-[1040px] xl:grid-cols-[minmax(0,640px)_300px] xl:justify-center">
        <main id="main" className="mx-auto w-full min-w-0 max-w-[640px] xl:mx-0">
          {me ? (
            <h1 className="sr-only">Feed</h1>
          ) : (
            <h2 id="feed" className="sr-only">
              Feed
            </h2>
          )}
          {/* Sticky so the filters stay one tap away while scrolling. */}
          <div
            className={`sticky top-14 z-10 border-b border-subtle bg-app/95 pt-4 backdrop-blur-sm ${me ? 'md:top-0' : ''}`}
          >
            <FeedFilters
              tabs={tabs.map((t) => ({ ...t, href: href({ category, sort: t.id }), current: sort === t.id }))}
              kinds={CHIPS.map((c) => ({
                id: c,
                label: plural[c] ?? CATEGORY_OPTIONS.find((o) => o.id === c)?.label ?? c,
                href: href({ category: c, sort }),
                current: category === c,
              }))}
              clearHref={href({ sort })}
            />
          </div>
          {prompt && !category && sort === 'latest' && (
            <div className="mt-4 px-4 sm:px-0 xl:hidden">
              <PromptCard p={prompt} signedIn={!!me} />
            </div>
          )}
          <div className="bg-canvas sm:mt-4 sm:rounded-lg sm:border sm:border-subtle">
            <FeedList
              key={q.toString()}
              initial={feed}
              query={q.toString()}
              empty={
                <EmptyState
                  spot={sort === 'following' ? 'together' : 'shelf'}
                  title={
                    sort === 'following'
                      ? 'Nothing new from the writers you follow.'
                      : category
                        ? 'Nothing published here yet.'
                        : 'Nothing published yet. Be the first.'
                  }
                  body={
                    sort === 'following'
                      ? 'Find someone to follow in Discover.'
                      : category
                        ? 'Try another category.'
                        : undefined
                  }
                />
              }
            />
          </div>
        </main>
        <aside aria-label="About Morrow" className="hidden flex-col gap-4 pt-6 xl:flex">
          {prompt && <PromptCard p={prompt} signedIn={!!me} />}
          {!me && (
            <div className="rounded-lg border border-subtle bg-canvas p-5">
              <p className="font-display text-[22px] leading-tight text-primary">
                Write in the open, together.
              </p>
              <p className="mt-2 text-[14px] text-secondary">
                Draft alone or with others, take suggestions from readers, and publish when it’s ready.
              </p>
              <Link
                href="/sign-up"
                className="mt-4 inline-flex h-9 items-center gap-2 rounded-full bg-action px-4 text-sm font-medium text-action-fg hover:bg-action-hover"
              >
                <PublishIcon size={16} />
                Start writing
              </Link>
            </div>
          )}
          <div className="rounded-lg border border-subtle bg-canvas p-5">
            <p className="text-[14px] font-medium text-primary">Looking for something?</p>
            <p className="mt-1 text-[13px] text-secondary">Editors’ picks, topics and collaborative works.</p>
            <div className="mt-3 flex flex-col gap-1.5 text-[14px]">
              <Link href={routes.discover} className="text-accent hover:underline">
                Browse Discover
              </Link>
              <Link
                href={routes.search}
                className="inline-flex items-center gap-1.5 text-accent hover:underline"
              >
                <SearchIcon size={14} />
                Search works and writers
              </Link>
            </div>
          </div>
        </aside>
      </div>
    </Shell>
  )
}

import Link from 'next/link'
import { EmptyState } from '@/components/brand/spots'
import { ComicGlyph, KindGlyph } from '@/components/brand/kind-glyphs'
import type { Discovery, DiscoveryWork, WeeklyPrompt } from '@morrow/contracts'
import { PromptCard } from '@/components/public/prompt-card'
import { currentUser } from '@/lib/server-api'
import { Shell } from '@/components/shell/shell'
import { WorkCard } from '@/components/public/work-card'
import { FollowingFeed } from '@/components/public/following-feed'
import { WorkCover } from '@/components/work-cover'
import { PeopleIcon, ReactIcon, SearchIcon } from '@/components/ui/icons'
import { readingMinutes } from '@/lib/format'
import { publicApi } from '@/lib/public-api'
import { routes } from '@/lib/routes'
import { CATEGORY_OPTIONS, labelOf } from '@/lib/work-options'

export const metadata = {
  title: 'Discover',
  description: 'Stories, poems, essays and research being written in the open.',
}
type Params = { searchParams: Promise<{ category?: string; tag?: string }> }

const kicker = 'font-mono text-[11px] uppercase tracking-[0.1em]'
const stagger = (i: number) => ({ '--i': i }) as React.CSSProperties

function SectionHead({ id, title, note }: { id: string; title: string; note?: React.ReactNode }) {
  return (
    <div>
      <h2 id={id} className="font-display text-[24px] text-primary">
        {title}
      </h2>
      {note && <p className="text-[13px] text-secondary">{note}</p>}
    </div>
  )
}

function Shelf({
  id,
  title,
  note,
  works,
  i,
}: {
  id: string
  title: string
  note?: React.ReactNode
  works: DiscoveryWork[]
  i: number
}) {
  if (!works.length) return null
  return (
    <section aria-labelledby={id} className="rise-in flex flex-col gap-3" style={stagger(i)}>
      <SectionHead id={id} title={title} note={note} />
      <div className="shelf -mx-4 flex gap-4 overflow-x-auto px-4 pb-2 sm:gap-5">
        {works.map((w) => (
          <WorkCard key={w.publicPath} w={w} />
        ))}
      </div>
    </section>
  )
}

/** The magazine's lead: one work, big, with why it's worth your time. */
function Lead({ w, label }: { w: DiscoveryWork; label: React.ReactNode }) {
  return (
    <article
      aria-labelledby="lead-title"
      className="relative grid gap-6 overflow-hidden rounded-xl border border-subtle bg-canvas p-5 sm:grid-cols-[200px_1fr] sm:items-center sm:p-8"
    >
      {/* a quiet sun behind the spread: the brand's horizon */}
      <svg
        aria-hidden="true"
        viewBox="0 0 320 320"
        className="pointer-events-none absolute -right-24 -top-24 w-[340px] text-accent opacity-[0.08]"
      >
        <circle cx="160" cy="160" r="70" fill="currentColor" />
        {[100, 130, 160].map((r) => (
          <circle key={r} cx="160" cy="160" r={r} fill="none" stroke="currentColor" strokeWidth="3" />
        ))}
      </svg>
      <Link
        href={routes.publicWork(w.publicPath)}
        tabIndex={-1}
        aria-hidden="true"
        className="lift mx-auto w-[150px] sm:w-[200px]"
      >
        <WorkCover cover={w.cover} title={w.title} size="card" />
      </Link>
      <div className="relative flex flex-col items-start gap-3">
        <p className={`${kicker} text-accent`}>{label}</p>
        <h3 id="lead-title" className="font-display text-[30px] leading-[1.08] text-primary sm:text-[40px]">
          <Link href={routes.publicWork(w.publicPath)} className="hover:underline">
            {w.title}
          </Link>
        </h3>
        {w.note ? (
          <p className="max-w-[52ch] font-manuscript text-[17px] italic leading-relaxed text-secondary">
            “{w.note}”
          </p>
        ) : (
          w.description && (
            <p className="line-clamp-3 max-w-[52ch] font-manuscript text-[17px] leading-relaxed text-secondary">
              {w.description}
            </p>
          )
        )}
        <p className="flex flex-wrap items-center gap-x-2 text-[13px] text-secondary">
          <span className="text-primary">{w.author.displayName}</span>
          {w.collaborators > 1 && (
            <span className="inline-flex items-center gap-1">
              <PeopleIcon size={14} /> and {w.collaborators - 1} more
            </span>
          )}
          <span aria-hidden="true">·</span>
          {labelOf(CATEGORY_OPTIONS, w.category)}
          <span aria-hidden="true">·</span>
          {readingMinutes(w.wordCount)} min read
        </p>
        <Link
          href={routes.publicWork(w.publicPath)}
          className="press mt-1 inline-flex h-10 items-center rounded-full bg-action px-5 font-medium text-action-fg outline-none hover:bg-action-hover focus-visible:ring-2 focus-visible:ring-focus focus-visible:ring-offset-2"
        >
          Start reading<span className="sr-only">: {w.title}</span>
        </Link>
      </div>
    </article>
  )
}

/** Popular, as a numbered list: the ranking is the point, so it's shown as one. */
function Ranked({ works }: { works: DiscoveryWork[] }) {
  return (
    <ol className="flex flex-col divide-y divide-subtle">
      {works.map((w, i) => (
        <li key={w.publicPath}>
          <Link href={routes.publicWork(w.publicPath)} className="lift group flex items-center gap-4 py-3">
            <span
              aria-hidden="true"
              className="w-9 shrink-0 font-display text-[30px] leading-none text-tertiary transition-colors group-hover:text-accent"
            >
              {String(i + 1).padStart(2, '0')}
            </span>
            <WorkCover cover={w.cover} title={w.title} />
            <span className="min-w-0 flex-1">
              <span className="line-clamp-2 font-manuscript text-[17px] leading-snug text-primary group-hover:underline">
                {w.title}
              </span>
              <span className="mt-0.5 block truncate text-[12px] text-secondary">
                {w.author.displayName} · {labelOf(CATEGORY_OPTIONS, w.category)} ·{' '}
                {readingMinutes(w.wordCount)} min
              </span>
            </span>
          </Link>
        </li>
      ))}
    </ol>
  )
}

/** Topics, sized by how much is written under each (log scale, so one busy tag doesn't drown the rest). */
function TopicCloud({
  topics,
  active,
  href,
}: {
  topics: Discovery['topics']
  active?: string | undefined
  href: (tag: string | undefined) => string
}) {
  const logs = topics.map((t) => Math.log(t.works + 1))
  const lo = Math.min(...logs)
  const span = Math.max(...logs) - lo || 1
  return (
    <ul aria-label="Topics" className="flex flex-wrap items-baseline gap-x-3 gap-y-1.5">
      {topics.map((t, i) => {
        const weight = (logs[i]! - lo) / span
        return (
          <li key={t.tag}>
            <Link
              href={href(active === t.tag ? undefined : t.tag)}
              aria-current={active === t.tag ? 'page' : undefined}
              title={`${t.works} ${t.works === 1 ? 'work' : 'works'}`}
              style={{ fontSize: `${14 + Math.round(weight * 9)}px` }}
              className={`press inline-block rounded-sm px-1 font-manuscript leading-tight hover:text-accent ${active === t.tag ? 'bg-selected text-primary' : weight > 0.5 ? 'text-primary' : 'text-secondary'}`}
            >
              #{t.tag}
            </Link>
          </li>
        )
      })}
    </ul>
  )
}

/** "Everything": a small grid of dots, in the glyphs' weight. */
const EverythingGlyph = () => (
  <svg aria-hidden="true" viewBox="0 0 20 20" width="20" height="20" fill="currentColor">
    {[4, 10, 16].flatMap((x) => [4, 10, 16].map((y) => <circle key={`${x}-${y}`} cx={x} cy={y} r="1.6" />))}
  </svg>
)

/**
 * Discovery (FR-020), laid out like a magazine (design/product-redesign.md §11): the kinds of writing as tiles, one
 * lead work, the ranked list beside the topics, then shelves to swipe through. Browsable without an account;
 * editorial picks and algorithmic ranking are labelled apart.
 */
export default async function DiscoverPage({ searchParams }: Params) {
  const { category, tag } = await searchParams
  const q = new URLSearchParams()
  if (category) q.set('category', category)
  if (tag) q.set('tag', tag)
  const [d, prompt, me] = await Promise.all([
    publicApi<Discovery>(`/discover?${q}`),
    publicApi<WeeklyPrompt>('/prompt').catch(() => null),
    currentUser(),
  ])
  const filtered = !!(category || tag)
  const href = (next: { category?: string | undefined; tag?: string | undefined }) => {
    const p = new URLSearchParams()
    if (next.category) p.set('category', next.category)
    if (next.tag) p.set('tag', next.tag)
    return `${routes.discover}${p.size ? `?${p}` : ''}`
  }
  const nothing = !d.recent.length
  // The lead is an editors' pick when there is one; otherwise the month's most-read, labelled as such.
  const [pick, ...morePicks] = d.featured
  const popularLead = !pick && d.popular.length > 1 ? d.popular[0] : undefined
  const ranked = (popularLead ? d.popular.slice(1) : d.popular).slice(0, 5)
  const tile = (current: boolean) =>
    `kind-tile press flex h-full min-w-[104px] flex-col items-start gap-2 rounded-lg border px-3 py-2.5 text-[13px] outline-none transition-colors focus-visible:ring-2 focus-visible:ring-focus ${current ? 'border-action bg-selected text-primary' : 'border-subtle bg-canvas text-secondary hover:border-control hover:text-primary'}`

  return (
    <Shell bg="app" title="Discover">
      <main id="main" className="mx-auto flex max-w-6xl flex-col gap-10 px-4 pb-24 pt-6 sm:px-8 md:pt-10">
        <div className="flex flex-col gap-4">
          <div>
            <h1 className="font-display text-[34px] leading-[1.05] text-primary sm:text-[44px]">Discover</h1>
            <p className="mt-1.5 max-w-[60ch] text-secondary">Words, worlds and ideas, still becoming.</p>
          </div>
          {/* Search lives here too: on phones, Discover is where you go to find something */}
          <form
            role="search"
            action={routes.search}
            className="flex h-12 max-w-xl items-center gap-2.5 rounded-full border border-control bg-canvas px-4 shadow-sm focus-within:ring-2 focus-within:ring-focus"
          >
            <SearchIcon size={18} className="shrink-0 text-tertiary" />
            <label htmlFor="discover-search" className="sr-only">
              Search works and writers
            </label>
            <input
              id="discover-search"
              name="q"
              type="search"
              placeholder="Search stories, poems, papers, writers…"
              className="min-w-0 flex-1 bg-transparent text-[16px] text-primary outline-none placeholder:text-tertiary"
            />
          </form>
        </div>

        <nav aria-label="Filter">
          <ul className="shelf -mx-4 flex gap-2 overflow-x-auto px-4 py-1">
            <li>
              <Link
                href={href({ tag })}
                aria-current={!category ? 'page' : undefined}
                className={tile(!category)}
              >
                <EverythingGlyph />
                Everything
              </Link>
            </li>
            {CATEGORY_OPTIONS.map((c) => (
              <li key={c.id}>
                <Link
                  href={href({ category: c.id, tag })}
                  aria-current={category === c.id ? 'page' : undefined}
                  className={tile(category === c.id)}
                >
                  <KindGlyph kind={c.id} />
                  <span className="whitespace-nowrap">{c.label}</span>
                </Link>
              </li>
            ))}
            <li>
              <Link href={routes.comics} className={tile(false)}>
                <ComicGlyph />
                <span className="flex items-center gap-1.5 whitespace-nowrap">
                  Comics
                  <span className="rounded-full bg-[var(--decor-ornament)] px-1.5 py-px text-[10px] font-semibold uppercase tracking-[0.06em] text-[#22221F]">
                    Soon
                  </span>
                </span>
              </Link>
            </li>
          </ul>
        </nav>

        {prompt && !filtered && <PromptCard p={prompt} signedIn={!!me} variant="banner" />}
        {!filtered && <FollowingFeed />}

        {pick && (
          <section aria-labelledby="featured" className="rise-in flex flex-col gap-4">
            <SectionHead
              id="featured"
              title="Editors’ picks"
              note={
                <span className="inline-flex items-center gap-1">
                  <ReactIcon size={13} />
                  Chosen by people at Morrow, with a note on why.
                </span>
              }
            />
            <Lead w={pick} label="Editors’ pick" />
            {morePicks.length > 0 && (
              <div className="shelf -mx-4 flex gap-4 overflow-x-auto px-4 pb-2 sm:gap-5">
                {morePicks.map((w) => (
                  <WorkCard key={w.publicPath} w={w} />
                ))}
              </div>
            )}
          </section>
        )}
        {popularLead && (
          <section aria-label="Most read this month" className="rise-in">
            <Lead w={popularLead} label="Most read this month" />
          </section>
        )}

        {(ranked.length > 0 || d.topics.length > 0) && (
          <div className="grid gap-10 lg:grid-cols-[1.4fr_1fr]">
            {ranked.length > 0 && (
              <section aria-labelledby="popular" className="rise-in flex flex-col gap-2" style={stagger(1)}>
                <SectionHead
                  id="popular"
                  title="Popular this month"
                  note="Ranked automatically by recent follows and bookmarks."
                />
                <Ranked works={ranked} />
              </section>
            )}
            {d.topics.length > 0 && (
              <section aria-labelledby="topics" className="rise-in flex flex-col gap-3" style={stagger(2)}>
                <SectionHead id="topics" title="Topics" note="Bigger means more is written there." />
                <TopicCloud topics={d.topics} active={tag} href={(t) => href({ category, tag: t })} />
              </section>
            )}
          </div>
        )}

        <Shelf id="recent" title="Recently published" works={d.recent} i={3} />
        <Shelf
          id="collaborative"
          title="Written together"
          note="Works with more than one writer."
          works={d.collaborative}
          i={4}
        />
        <Shelf
          id="classics"
          title="Classics"
          note={
            <>
              Public-domain books, free to read and free to retell.{' '}
              <Link href={routes.classics} className="text-accent underline underline-offset-2">
                See them all
              </Link>
            </>
          }
          works={d.classics}
          i={4}
        />
        <Shelf
          id="research"
          title="Open research"
          note={
            <>
              Openly licensed papers, credited to their authors.{' '}
              <Link href={routes.research} className="text-accent underline underline-offset-2">
                See them all
              </Link>
            </>
          }
          works={d.research}
          i={4}
        />
        <Shelf
          id="open-calls"
          title="Looking for collaborators"
          note="Their writers want an editor, an illustrator, a co-writer… maybe you."
          works={d.openCalls}
          i={5}
        />
        <Shelf
          id="seeking"
          title="Open to contributors"
          note="Their writers welcome proposals."
          works={d.seekingContributors}
          i={5}
        />
        {nothing && (
          <EmptyState
            spot="compass"
            title={filtered ? 'Nothing published here yet.' : 'Nothing published yet. Be the first.'}
            body={filtered ? 'Try another filter.' : undefined}
          />
        )}
      </main>
    </Shell>
  )
}

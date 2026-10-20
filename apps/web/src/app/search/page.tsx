import Link from 'next/link'
import { SearchIcon } from '@/components/ui/icons'
import { SpotArt } from '@/components/brand/spots'
import type { SearchResults } from '@morrow/contracts'
import { Shell } from '@/components/shell/shell'
import { WorkCard } from '@/components/public/work-card'
import { Avatar } from '@/components/profile/avatar'
import { publicApi } from '@/lib/public-api'
import { routes } from '@/lib/routes'
import { CATEGORY_OPTIONS } from '@/lib/work-options'

type Params = {
  searchParams: Promise<{ q?: string; category?: string; tag?: string; sort?: string; page?: string }>
}
export async function generateMetadata({ searchParams }: Params) {
  const { q } = await searchParams
  return { title: q ? `“${q}” · Search` : 'Search', robots: { index: false } }
}
const SORTS = [
  { id: 'relevance', label: 'Best match' },
  { id: 'recent', label: 'Newest' },
  { id: 'popular', label: 'Popular' },
] as const

/** Search (FR-021) across public works and writers: filters, sorting, pages, and clear empty states. */
export default async function SearchPage({ searchParams }: Params) {
  const sp = await searchParams
  const q = (sp.q ?? '').slice(0, 200)
  const page = Math.min(50, Math.max(1, Number(sp.page) || 1))
  const params = new URLSearchParams()
  if (q) params.set('q', q)
  if (sp.category) params.set('category', sp.category)
  if (sp.tag) params.set('tag', sp.tag)
  if (sp.sort) params.set('sort', sp.sort)
  if (page > 1) params.set('page', String(page))
  const r = await publicApi<SearchResults>(`/search?${params}`)
  const link = (over: Record<string, string | undefined>) => {
    const p = new URLSearchParams(params)
    p.delete('page')
    for (const [k, v] of Object.entries(over)) {
      if (v) p.set(k, v)
      else p.delete(k)
    }
    return `${routes.search}?${p}`
  }
  return (
    <Shell bg="app" title="Search">
      <div className="mx-auto max-w-6xl px-4 pt-6 sm:px-6 md:pt-10">
        <form
          role="search"
          action={routes.search}
          className="flex h-12 max-w-2xl items-center gap-2.5 rounded-full border border-control bg-canvas px-4 shadow-sm focus-within:ring-2 focus-within:ring-focus"
        >
          <SearchIcon size={18} className="shrink-0 text-tertiary" />
          <label htmlFor="search-q" className="sr-only">
            Search works and writers
          </label>
          <input
            id="search-q"
            name="q"
            type="search"
            defaultValue={q}
            placeholder="Search stories, poems, papers, writers…"
            className="min-w-0 flex-1 bg-transparent text-[16px] text-primary outline-none placeholder:text-tertiary"
          />
          {sp.category && <input type="hidden" name="category" value={sp.category} />}
          {sp.tag && <input type="hidden" name="tag" value={sp.tag} />}
        </form>
      </div>
      <main
        id="main"
        className="mx-auto grid max-w-6xl gap-8 px-4 pb-24 pt-6 sm:px-6 lg:grid-cols-[220px_1fr]"
      >
        <aside aria-label="Filters" className="flex flex-col gap-5 text-sm">
          <form action={routes.search} className="flex flex-col gap-3">
            <input type="hidden" name="q" value={q} />
            <label className="flex flex-col gap-1.5">
              <span className="font-medium text-primary">Category</span>
              <select
                name="category"
                defaultValue={sp.category ?? ''}
                className="h-9 rounded-sm border border-control bg-canvas px-2 text-primary"
              >
                <option value="">Any</option>
                {CATEGORY_OPTIONS.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1.5">
              <span className="font-medium text-primary">Topic</span>
              <input
                name="tag"
                defaultValue={sp.tag ?? ''}
                placeholder="e.g. grief"
                className="h-9 rounded-sm border border-control bg-canvas px-2 text-primary placeholder:text-tertiary"
              />
            </label>
            <button
              type="submit"
              className="h-9 rounded-sm border border-control text-primary hover:bg-hover"
            >
              Apply
            </button>
          </form>
          <div>
            <p className="mb-1.5 font-medium text-primary">Sort by</p>
            <ul className="flex flex-col gap-1">
              {SORTS.map((s) => (
                <li key={s.id}>
                  <Link
                    href={link({ sort: s.id === 'relevance' ? undefined : s.id })}
                    aria-current={(sp.sort ?? 'relevance') === s.id ? 'true' : undefined}
                    className={`text-[13px] ${(sp.sort ?? 'relevance') === s.id ? 'font-medium text-primary' : 'text-secondary hover:text-primary'}`}
                  >
                    {s.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        </aside>
        <div className="min-w-0">
          <h1 className="font-display text-[32px] leading-tight text-primary">
            {q ? <>Results for “{q}”</> : 'Browse everything'}
          </h1>
          {r.authors.length > 0 && (
            <section aria-labelledby="writers" className="mt-6">
              <h2
                id="writers"
                className="mb-2 font-mono text-[11px] uppercase tracking-[0.08em] text-tertiary"
              >
                Writers
              </h2>
              <ul className="flex flex-wrap gap-3">
                {r.authors.map((a) => (
                  <li key={a.username}>
                    <Link
                      href={routes.author(a.username)}
                      className="flex items-center gap-2 rounded-full border border-subtle bg-canvas py-1 pl-1 pr-3 hover:bg-hover"
                    >
                      <Avatar name={a.displayName} seed={a.avatarSeed} avatar={a.avatar} size={28} />
                      <span className="text-sm text-primary">{a.displayName}</span>
                      <span className="font-mono text-[11px] text-tertiary">@{a.username}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          )}
          <section aria-labelledby="works" className="mt-8">
            <h2 id="works" className="mb-2 font-mono text-[11px] uppercase tracking-[0.08em] text-tertiary">
              Works
            </h2>
            {r.works.length === 0 ? (
              <div className="flex flex-col items-center border-y border-subtle py-12 text-center">
                <SpotArt spot="compass" size={120} />
                <p className="mt-3 font-display text-[20px] text-primary">
                  {q ? `Nothing public matches “${q}”.` : 'Nothing matches these filters.'}
                </p>
                <p className="mt-2 text-[13px] text-secondary">
                  Try fewer words, another spelling, or{' '}
                  <Link href={routes.discover} className="text-accent underline underline-offset-2">
                    browse Discover
                  </Link>
                  .
                </p>
              </div>
            ) : (
              <ul className="divide-y divide-subtle border-y border-subtle">
                {r.works.map((w) => (
                  <li key={w.publicPath}>
                    <WorkCard w={w} layout="row" />
                  </li>
                ))}
              </ul>
            )}
          </section>
          {(page > 1 || r.hasMore) && (
            <nav aria-label="Pages" className="mt-6 flex justify-between text-sm">
              {page > 1 ? (
                <Link
                  href={`${link({})}&page=${page - 1}`}
                  rel="prev"
                  className="text-accent underline underline-offset-2"
                >
                  Previous
                </Link>
              ) : (
                <span />
              )}
              {r.hasMore && (
                <Link
                  href={`${link({})}&page=${page + 1}`}
                  rel="next"
                  className="text-accent underline underline-offset-2"
                >
                  Next
                </Link>
              )}
            </nav>
          )}
        </div>
      </main>
    </Shell>
  )
}

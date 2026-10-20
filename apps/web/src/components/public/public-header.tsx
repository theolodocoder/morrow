import Link from 'next/link'
import { Logo } from '@/components/brand/logo'
import { SearchIcon } from '@/components/ui/icons'
import { currentUser } from '@/lib/server-api'
import { routes } from '@/lib/routes'

/** The bar on every public page: find something to read, or get to your own writing. */
export async function PublicHeader({ query = '' }: { query?: string }) {
  const me = await currentUser()
  return (
    <header className="sticky top-0 z-30 border-b border-subtle bg-canvas/95 backdrop-blur-md">
      <div className="mx-auto flex h-14 max-w-6xl items-center gap-3 px-4 sm:gap-5 sm:px-6">
        <Link href={routes.feed} aria-label="Morrow: home">
          <Logo height={22} />
        </Link>
        <nav aria-label="Browse" className="hidden gap-4 sm:flex">
          <Link href={routes.feed} className="text-sm text-secondary hover:text-primary">
            Home
          </Link>
          <Link href={routes.discover} className="text-sm text-secondary hover:text-primary">
            Discover
          </Link>
        </nav>
        <form
          role="search"
          action={routes.search}
          className="ml-auto flex min-w-0 max-w-sm flex-1 items-center gap-2 rounded-full border border-control bg-app px-3.5 focus-within:ring-2 focus-within:ring-focus"
        >
          <SearchIcon size={16} className="shrink-0 text-tertiary" />
          <label htmlFor="site-search" className="sr-only">
            Search works and writers
          </label>
          <input
            id="site-search"
            name="q"
            type="search"
            defaultValue={query}
            placeholder="Search works and writers"
            className="h-9 min-w-0 flex-1 bg-transparent text-[15px] text-primary outline-none placeholder:text-tertiary"
          />
        </form>
        {me ? (
          <Link href={routes.library} className="shrink-0 text-sm text-secondary hover:text-primary">
            Your library
          </Link>
        ) : (
          <div className="flex shrink-0 items-center gap-3">
            <Link href="/sign-in" className="text-sm text-secondary hover:text-primary">
              Sign in
            </Link>
            <Link
              href="/sign-up"
              className="hidden h-9 items-center rounded-full bg-action px-3 text-sm font-medium text-action-fg hover:bg-action-hover sm:inline-flex"
            >
              Start writing
            </Link>
          </div>
        )}
      </div>
    </header>
  )
}

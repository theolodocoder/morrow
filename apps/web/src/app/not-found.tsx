import Link from 'next/link'
import { Logo } from '@/components/brand/logo'
import { SpotArt } from '@/components/brand/spots'
import { routes } from '@/lib/routes'

/** A missing page: say so plainly, and offer the two ways on (home, or your works). */
export default function NotFound() {
  return (
    <main id="main" className="flex min-h-dvh flex-col items-center justify-center bg-app px-4 text-center">
      <Link href={routes.feed} aria-label="Morrow: home" className="mb-10">
        <Logo height={26} />
      </Link>
      <SpotArt spot="lost" size={180} />
      <h1 className="mt-6 font-display text-[34px] leading-tight text-primary">This page has wandered off</h1>
      <p className="mt-2 max-w-sm text-secondary">
        It doesn’t exist, it was unpublished, or you don’t have access to it.
      </p>
      <div className="mt-6 flex flex-wrap justify-center gap-3">
        <Link
          href={routes.feed}
          className="press inline-flex h-10 items-center rounded-full bg-action px-5 text-sm font-medium text-action-fg hover:bg-action-hover"
        >
          Go home
        </Link>
        <Link
          href={routes.library}
          className="press inline-flex h-10 items-center rounded-full border border-control px-5 text-sm text-primary hover:bg-hover"
        >
          Your works
        </Link>
      </div>
    </main>
  )
}

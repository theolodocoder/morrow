import Link from 'next/link'
import type { ReactNode } from 'react'
import { LogoMark } from '@/components/brand/logo'
import { PublicHeader } from '@/components/public/public-header'
import { ArrowLeftIcon, SearchIcon } from '@/components/ui/icons'
import { currentUser } from '@/lib/server-api'
import { routes } from '@/lib/routes'
import { PromptWriter } from './write-sheet'
import { AccountMenu, Sidebar, TabBar } from './nav'

/**
 * Every page outside the editor and the reader lives in this shell (design/product-redesign.md §3).
 * Signed in: the sidebar (desktop) or the tab bar (mobile), with a slim top bar on mobile carrying the page's title
 * and at most a couple of actions. Signed out: the public header and a gentle join strip on phones.
 */
export async function Shell({
  children,
  title,
  actions,
  back,
  bg = 'app',
}: {
  children: ReactNode
  /** shown in the mobile top bar */
  title?: string
  /** up to two icon buttons for the mobile top bar */
  actions?: ReactNode
  /** a way back, for pages below a place (e.g. a proposal under Activity) */
  back?: { href: string; label: string }
  bg?: 'app' | 'canvas'
}) {
  const me = await currentUser()
  const surface = bg === 'canvas' ? 'bg-canvas' : 'bg-app'
  if (!me)
    return (
      <div className={`min-h-dvh ${surface}`}>
        <PublicHeader />
        {children}
        <div className="sticky bottom-0 z-20 flex items-center justify-between gap-3 border-t border-subtle bg-canvas/95 px-4 py-2.5 backdrop-blur-md sm:hidden">
          <p className="text-[13px] text-secondary">Read, write and create together.</p>
          <Link
            href="/sign-up"
            className="press inline-flex h-9 shrink-0 items-center rounded-full bg-action px-4 text-sm font-medium text-action-fg"
          >
            Join Morrow
          </Link>
        </div>
      </div>
    )
  const shellUser = {
    name: me.name,
    username: me.username,
    avatarSeed: me.avatarSeed,
    avatar: me.avatar,
    profilePublic: me.profilePublic,
  }
  return (
    <div className={`min-h-dvh ${surface} md:pl-[72px] xl:pl-[240px]`}>
      <Sidebar me={shellUser} />
      <PromptWriter />
      <header className="sticky top-0 z-20 flex h-14 items-center gap-2 border-b border-subtle bg-app/95 px-3 backdrop-blur-md md:hidden">
        {back ? (
          <Link
            href={back.href}
            aria-label={back.label}
            className="press grid size-10 place-items-center rounded-full text-primary hover:bg-hover"
          >
            <ArrowLeftIcon size={20} />
          </Link>
        ) : (
          <Link href={routes.feed} aria-label="Morrow: home" className="grid size-10 place-items-center">
            <LogoMark size={20} />
          </Link>
        )}
        <p className="min-w-0 flex-1 truncate text-[16px] font-semibold text-primary">{title}</p>
        <div className="flex items-center gap-1">
          {actions ?? (
            <Link
              href={routes.search}
              aria-label="Search"
              className="press grid size-10 place-items-center rounded-full text-secondary hover:bg-hover hover:text-primary"
            >
              <SearchIcon size={20} />
            </Link>
          )}
          <span className="size-10">
            <AccountMenu me={shellUser} compact />
          </span>
        </div>
      </header>
      {back && (
        <div className="hidden px-8 pt-6 md:block">
          <Link
            href={back.href}
            className="inline-flex items-center gap-1.5 rounded-sm text-[13px] text-secondary hover:text-primary"
          >
            <ArrowLeftIcon size={15} />
            {back.label}
          </Link>
        </div>
      )}
      <div className="pb-[calc(4.5rem+env(safe-area-inset-bottom))] md:pb-0">{children}</div>
      <TabBar me={shellUser} />
    </div>
  )
}

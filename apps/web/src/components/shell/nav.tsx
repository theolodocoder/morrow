'use client'
/**
 * The app's one navigation (design/product-redesign.md §3): five places, the same everywhere.
 * Desktop: a sidebar (icon rail below 1280px). Mobile: a bottom tab bar with Write in the centre.
 */
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { useState } from 'react'
import { Menu, MenuItem, MenuTrigger, Popover, Separator, Button as AriaButton } from 'react-aria-components'
import type { AvatarConfig } from '@morrow/contracts'
import { Logo, LogoMark } from '@/components/brand/logo'
import { FeedbackDialog } from '@/components/feedback-dialog'
import { Avatar } from '@/components/profile/avatar'
import { Button } from '@/components/ui/button'
import { Dialog } from '@/components/ui/dialog'
import {
  BadgeIcon,
  BellIcon,
  ChartIcon,
  CompassIcon,
  FeedbackIcon,
  HomeIcon,
  PenIcon,
  PlusIcon,
  ReadingIcon,
  SettingsIcon,
  ShieldIcon,
  SignOutIcon,
  ChaptersIcon,
} from '@/components/ui/icons'
import { api } from '@/lib/client-api'
import { clearDeviceCopies, hasPendingWriting } from '@/lib/device-copies'
import { routes } from '@/lib/routes'
import { useUnread } from './use-unread'
import { WriteSheet } from './write-sheet'

export interface ShellUser {
  id: string
  name: string
  username: string | null
  avatarSeed: string
  avatar: AvatarConfig | null
  profilePublic: boolean
}

type Place = 'home' | 'discover' | 'activity' | 'you' | null
const YOU = [
  '/app/library',
  '/app/dashboard',
  '/app/reading',
  '/app/badges',
  '/app/suggestions',
  '/app/settings',
]
function placeOf(path: string, me: ShellUser): Place {
  if (path === '/') return 'home'
  if (path.startsWith('/discover') || path.startsWith('/search')) return 'discover'
  if (path.startsWith('/app/notifications') || path.startsWith('/app/invitations')) return 'activity'
  if (YOU.some((p) => path.startsWith(p)) || (me.username && path === routes.author(me.username)))
    return 'you'
  return null
}

const YOUR_SPACE = [
  { href: routes.library, label: 'Works', icon: ChaptersIcon },
  { href: routes.dashboard, label: 'Insights', icon: ChartIcon },
  { href: routes.reading, label: 'Reading list', icon: ReadingIcon },
  { href: routes.badges, label: 'Badges', icon: BadgeIcon },
] as const

function UnreadDot({ count, className = '' }: { count: number; className?: string }) {
  if (!count) return null
  return (
    <span
      aria-hidden="true"
      className={`badge-pop absolute min-w-4 rounded-full bg-action px-1 text-center font-ui text-[10px] font-semibold leading-4 text-action-fg ring-2 ring-[var(--bg-sidebar)] ${className}`}
    >
      {count > 99 ? '99+' : count}
    </span>
  )
}

/** Your avatar opens everything about your account: profile, settings, plan, safety, feedback, sign out. */
export function AccountMenu({ me, compact }: { me: ShellUser; compact?: boolean }) {
  const router = useRouter()
  const [feedback, setFeedback] = useState(false)
  const [unsent, setUnsent] = useState(false)
  const signOut = async () => {
    await api('/api/auth/sign-out', { method: 'POST', body: {} })
    await clearDeviceCopies(me.id)
    router.replace('/sign-in')
    router.refresh()
  }
  const item =
    'flex cursor-default items-center gap-2.5 rounded-sm px-3 py-2 text-sm text-primary outline-none data-[focused]:bg-hover'
  return (
    <>
      <MenuTrigger>
        <AriaButton
          aria-label="Your account"
          className={`press flex w-full items-center gap-3 rounded-md p-1.5 text-left outline-none hover:bg-hover data-[focus-visible]:ring-2 data-[focus-visible]:ring-focus ${compact ? 'justify-center' : ''}`}
        >
          <Avatar name={me.name} seed={me.avatarSeed} avatar={me.avatar} size={32} />
          {!compact && (
            <span className="hidden min-w-0 xl:block">
              <span className="block truncate text-[14px] font-medium text-primary">{me.name}</span>
              {me.username && (
                <span className="block truncate text-[12px] text-tertiary">@{me.username}</span>
              )}
            </span>
          )}
        </AriaButton>
        <Popover
          placement="top start"
          className="popover min-w-56 rounded-md border border-subtle bg-raised p-1 shadow-[0_2px_4px_rgb(34_34_31/.06),0_12px_32px_rgb(34_34_31/.14)]"
        >
          <Menu
            aria-label="Your account"
            className="outline-none"
            onAction={async (key) => {
              if (key === 'feedback') setFeedback(true)
              // Sign-out deletes this device's copies: never silently when one holds words the server hasn't got.
              if (key === 'signout') {
                if (hasPendingWriting(me.id)) setUnsent(true)
                else await signOut()
              }
            }}
          >
            {me.username && me.profilePublic && (
              <MenuItem id="profile" href={routes.author(me.username)} className={item}>
                <Avatar name={me.name} seed={me.avatarSeed} avatar={me.avatar} size={18} />
                Your public profile
              </MenuItem>
            )}
            <MenuItem id="settings" href={routes.profileSettings} className={item}>
              <SettingsIcon size={16} /> Settings
            </MenuItem>
            <MenuItem id="safety" href={routes.safetySettings} className={item}>
              <ShieldIcon size={16} /> Safety and reports
            </MenuItem>
            <MenuItem id="feedback" className={item}>
              <FeedbackIcon size={16} /> Send feedback to Morrow
            </MenuItem>
            <Separator className="my-1 h-px bg-[var(--border-subtle)]" />
            <MenuItem id="signout" className={item}>
              <SignOutIcon size={16} /> Sign out
            </MenuItem>
          </Menu>
        </Popover>
      </MenuTrigger>
      <FeedbackDialog isOpen={feedback} onOpenChange={setFeedback} />
      <Dialog title="Some writing hasn’t reached Morrow yet" isOpen={unsent} onOpenChange={setUnsent}>
        <p className="text-sm text-secondary">
          It’s saved on this device only. Go back online and open Morrow so it can sync, or sign out and
          delete it.
        </p>
        <div className="mt-6 flex flex-wrap justify-end gap-2">
          <Button variant="danger" onPress={() => void signOut()}>
            Sign out and delete it
          </Button>
          <Button variant="primary" autoFocus onPress={() => setUnsent(false)}>
            Stay signed in
          </Button>
        </div>
      </Dialog>
    </>
  )
}

export function Sidebar({ me }: { me: ShellUser }) {
  const path = usePathname()
  const place = placeOf(path, me)
  const unread = useUnread()
  const [writing, setWriting] = useState(false)
  const link = (active: boolean) =>
    `press group relative flex items-center gap-3 rounded-md px-3 py-2.5 text-[15px] outline-none transition-colors hover:bg-hover focus-visible:ring-2 focus-visible:ring-focus justify-center xl:justify-start ${active ? 'font-semibold text-primary' : 'text-secondary hover:text-primary'}`
  const places = [
    { id: 'home', href: routes.feed, label: 'Home', icon: HomeIcon },
    { id: 'discover', href: routes.discover, label: 'Discover', icon: CompassIcon },
    { id: 'activity', href: routes.notifications, label: 'Activity', icon: BellIcon },
  ] as const
  return (
    <nav
      aria-label="Main"
      className="fixed inset-y-0 left-0 z-30 hidden w-[72px] flex-col border-r border-subtle bg-sidebar px-3 py-4 md:flex xl:w-[240px]"
    >
      <Link
        href={routes.feed}
        aria-label="Morrow: home"
        className="mb-6 flex justify-center px-2 xl:justify-start"
      >
        <span className="xl:hidden">
          <LogoMark size={24} />
        </span>
        <span className="hidden xl:inline">
          <Logo height={24} />
        </span>
      </Link>
      <ul className="flex flex-col gap-0.5">
        {places.map((p) => {
          const active = place === p.id
          return (
            <li key={p.id}>
              <Link
                href={p.href}
                aria-current={active ? 'page' : undefined}
                aria-label={p.id === 'activity' && unread ? `Activity, ${unread} unread` : p.label}
                title={p.label}
                className={link(active)}
              >
                <span className="relative">
                  <p.icon
                    size={22}
                    className={active ? 'fill-[color-mix(in_srgb,currentColor_14%,transparent)]' : ''}
                  />
                  {p.id === 'activity' && <UnreadDot count={unread} className="-right-2 -top-1.5" />}
                </span>
                <span className="hidden xl:inline">{p.label}</span>
              </Link>
            </li>
          )
        })}
        <li>
          <Link
            href={routes.library}
            aria-current={place === 'you' ? 'page' : undefined}
            aria-label="You"
            title="You"
            className={link(place === 'you')}
          >
            <span
              className={`rounded-full ${place === 'you' ? 'ring-2 ring-[var(--text-primary)] ring-offset-2 ring-offset-[var(--bg-sidebar)]' : ''}`}
            >
              <Avatar name={me.name} seed={me.avatarSeed} avatar={me.avatar} size={22} />
            </span>
            <span className="hidden xl:inline">You</span>
          </Link>
        </li>
      </ul>
      <button
        type="button"
        onClick={() => setWriting(true)}
        aria-label="Write"
        title="Write"
        className="press mt-4 flex h-11 items-center justify-center gap-2 rounded-full bg-action text-[15px] font-medium text-action-fg outline-none transition-colors hover:bg-action-hover focus-visible:ring-2 focus-visible:ring-focus focus-visible:ring-offset-2"
      >
        <PenIcon size={18} />
        <span className="hidden xl:inline">Write</span>
      </button>
      {/* Your space: the things that belong to you, one click away on wide screens */}
      <div className="mt-8 hidden xl:block">
        <p className="px-3 pb-1.5 text-[11px] font-medium uppercase tracking-[0.08em] text-tertiary">
          Your space
        </p>
        <ul className="flex flex-col gap-0.5">
          {YOUR_SPACE.map((s) => {
            const active = path.startsWith(s.href)
            return (
              <li key={s.href}>
                <Link
                  href={s.href}
                  aria-current={active ? 'page' : undefined}
                  className={`flex items-center gap-3 rounded-md px-3 py-1.5 text-[14px] outline-none hover:bg-hover focus-visible:ring-2 focus-visible:ring-focus ${active ? 'bg-hover font-medium text-primary' : 'text-secondary hover:text-primary'}`}
                >
                  <s.icon size={17} />
                  {s.label}
                </Link>
              </li>
            )
          })}
        </ul>
      </div>
      <div className="mt-auto">
        <AccountMenu me={me} />
      </div>
      <WriteSheet isOpen={writing} onOpenChange={setWriting} />
    </nav>
  )
}

/** Mobile: five tabs within thumb reach. Write is the one action, so it looks like one. */
export function TabBar({ me }: { me: ShellUser }) {
  const path = usePathname()
  const place = placeOf(path, me)
  const unread = useUnread()
  const [writing, setWriting] = useState(false)
  const tab = (active: boolean) =>
    `press relative flex h-full flex-1 flex-col items-center justify-center gap-0.5 text-[10px] font-medium outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-focus ${active ? 'text-primary' : 'text-tertiary'}`
  return (
    <>
      <nav
        aria-label="Main"
        className="fixed inset-x-0 bottom-0 z-30 border-t border-subtle bg-canvas/95 pb-[env(safe-area-inset-bottom)] backdrop-blur-md md:hidden"
      >
        <ul className="flex h-14 items-stretch">
          <li className="flex flex-1">
            <Link
              href={routes.feed}
              aria-current={place === 'home' ? 'page' : undefined}
              className={tab(place === 'home')}
            >
              <HomeIcon
                size={22}
                className={place === 'home' ? 'fill-[color-mix(in_srgb,currentColor_14%,transparent)]' : ''}
              />
              Home
            </Link>
          </li>
          <li className="flex flex-1">
            <Link
              href={routes.discover}
              aria-current={place === 'discover' ? 'page' : undefined}
              className={tab(place === 'discover')}
            >
              <CompassIcon size={22} />
              Discover
            </Link>
          </li>
          <li className="flex flex-1 items-center justify-center">
            <button
              type="button"
              onClick={() => setWriting(true)}
              aria-label="Write"
              className="press grid h-10 w-14 place-items-center rounded-xl bg-action text-action-fg shadow-sm outline-none focus-visible:ring-2 focus-visible:ring-focus focus-visible:ring-offset-2"
            >
              <PlusIcon size={22} />
            </button>
          </li>
          <li className="flex flex-1">
            <Link
              href={routes.notifications}
              aria-current={place === 'activity' ? 'page' : undefined}
              aria-label={unread ? `Activity, ${unread} unread` : 'Activity'}
              className={tab(place === 'activity')}
            >
              <span className="relative">
                <BellIcon size={22} />
                <UnreadDot count={unread} className="-right-2 -top-1" />
              </span>
              Activity
            </Link>
          </li>
          <li className="flex flex-1">
            <Link
              href={routes.library}
              aria-current={place === 'you' ? 'page' : undefined}
              className={tab(place === 'you')}
            >
              <span
                className={`rounded-full ${place === 'you' ? 'ring-2 ring-[var(--text-primary)] ring-offset-1 ring-offset-[var(--bg-canvas)]' : ''}`}
              >
                <Avatar name={me.name} seed={me.avatarSeed} avatar={me.avatar} size={22} />
              </span>
              You
            </Link>
          </li>
        </ul>
      </nav>
      <WriteSheet isOpen={writing} onOpenChange={setWriting} />
    </>
  )
}

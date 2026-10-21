import type { Metadata } from 'next'
import { EmptyState } from '@/components/brand/spots'
import Link from 'next/link'
import type { PublicAuthor } from '@morrow/contracts'
import { Shell } from '@/components/shell/shell'
import { Avatar } from '@/components/profile/avatar'
import { BadgeMedal } from '@/components/profile/badge-medal'
import { ViewPing } from '@/components/reader/view-ping'
import { FollowControls } from '@/components/follows/follow-controls'
import { ProfileMore } from '@/components/public/profile-more'
import { currentUser } from '@/lib/server-api'
import { publicApi } from '@/lib/public-api'
import { routes } from '@/lib/routes'
import { CATEGORY_OPTIONS, labelOf } from '@/lib/work-options'

type Params = { params: Promise<{ username: string }> }
const load = async (params: Params['params']) =>
  publicApi<PublicAuthor>(`/authors/${encodeURIComponent((await params).username)}`)

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const a = await load(params)
  return { title: `${a.displayName} (@${a.username})`, description: a.bio ?? undefined }
}

const INTENT_LABEL: Record<string, string> = {
  write: 'Writes',
  collaborate: 'Collaborates',
  read: 'Reads',
  edit_review: 'Edits and reviews',
  organize: 'Researches',
}

export default async function AuthorPage({ params }: Params) {
  const a = await load(params)
  const me = await currentUser()
  const mine = me?.username === a.username
  return (
    <Shell bg="canvas" title={a.displayName}>
      <main id="main" className="mx-auto max-w-3xl px-4 pb-24 pt-10 sm:px-6">
        <ViewPing author={a.username} />
        <div className="flex items-start gap-5">
          <Avatar
            name={a.displayName}
            seed={a.avatarSeed}
            avatar={a.avatar}
            size={88}
            badge={
              a.badges?.length
                ? (() => {
                    const latest = [...a.badges].sort((x, y) => y.awardedAt.localeCompare(x.awardedAt))[0]!
                    return { code: latest.code, name: latest.name, count: a.badges.length }
                  })()
                : null
            }
          />
          <div className="min-w-0 flex-1">
            <h1 className="font-display text-[32px] leading-tight text-primary sm:text-[42px]">
              {a.displayName}
            </h1>
            <p className="font-mono text-[12px] text-tertiary">
              @{a.username} · joined{' '}
              {new Date(a.joinedAt).toLocaleDateString('en', { month: 'long', year: 'numeric' })}
            </p>
            <dl className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-[14px]">
              <div className="flex items-baseline gap-1.5">
                <dt className="order-2 text-secondary">{a.works.length === 1 ? 'work' : 'works'}</dt>
                <dd className="order-1 font-semibold tabular-nums text-primary">{a.works.length}</dd>
              </div>
              {a.followers !== null && (
                <>
                  <div className="flex items-baseline gap-1.5">
                    <dt className="order-2 text-secondary">{a.followers === 1 ? 'follower' : 'followers'}</dt>
                    <dd className="order-1 font-semibold tabular-nums text-primary">{a.followers}</dd>
                  </div>
                  <div className="flex items-baseline gap-1.5">
                    <dt className="order-2 text-secondary">following</dt>
                    <dd className="order-1 font-semibold tabular-nums text-primary">{a.following}</dd>
                  </div>
                </>
              )}
            </dl>
          </div>
        </div>
        <div className="mt-5 flex items-center gap-2">
          {mine ? (
            <Link
              href={routes.profileSettings}
              className="press inline-flex h-10 items-center rounded-full border border-control px-5 text-sm font-medium text-primary hover:bg-hover"
            >
              Edit profile
            </Link>
          ) : (
            <FollowControls author={{ username: a.username, name: a.displayName.split(' ')[0]! }} />
          )}
          {!mine && <ProfileMore username={a.username} name={a.displayName.split(' ')[0]!} />}
        </div>
        {a.bio && (
          <p className="mt-6 max-w-[60ch] whitespace-pre-line font-manuscript text-[17px] leading-relaxed text-primary">
            {a.bio}
          </p>
        )}
        {a.interests?.length || a.genres?.length ? (
          <ul aria-label="Interests" className="mt-5 flex flex-wrap gap-2">
            {a.interests?.map((i) => (
              <li key={i} className="rounded-full bg-selected px-2.5 py-0.5 text-[12px] text-primary">
                {INTENT_LABEL[i] ?? i}
              </li>
            ))}
            {a.genres?.map((g) => (
              <li
                key={g}
                className="rounded-full border border-subtle px-2.5 py-0.5 text-[12px] text-secondary"
              >
                {g}
              </li>
            ))}
          </ul>
        ) : null}
        {a.links && a.links.length > 0 && (
          <ul aria-label="Links" className="mt-4 flex flex-wrap gap-x-4 gap-y-1 text-[13px]">
            {a.links.map((l) => (
              <li key={l.url}>
                <a
                  href={l.url}
                  rel="noopener noreferrer nofollow ugc me"
                  className="text-accent underline underline-offset-2"
                >
                  {l.label}
                </a>
              </li>
            ))}
          </ul>
        )}

        {a.badges && a.badges.length > 0 && (
          <section aria-labelledby="badges" className="mt-10">
            <h2 id="badges" className="mb-3 font-mono text-[11px] uppercase tracking-[0.08em] text-tertiary">
              Badges
            </h2>
            <ul className="flex flex-wrap gap-3">
              {a.badges.map((b) => (
                <li
                  key={b.code}
                  title={b.description}
                  className="flex items-center gap-2.5 rounded-full border border-subtle py-1 pl-1 pr-3.5"
                >
                  <BadgeMedal code={b.code} size={32} />
                  <span className="leading-tight">
                    <span className="block text-[13px] font-medium text-primary">{b.name}</span>
                    <span className="block text-[11px] text-tertiary">{b.description}</span>
                  </span>
                </li>
              ))}
            </ul>
          </section>
        )}

        <section aria-labelledby="works" className="mt-14">
          <h2 id="works" className="mb-2 font-mono text-[11px] uppercase tracking-[0.08em] text-tertiary">
            Published works
          </h2>
          {a.works.length === 0 ? (
            <EmptyState spot="shelf" title="Nothing published yet." />
          ) : (
            <ul className="divide-y divide-subtle border-y border-subtle">
              {a.works.map((w) => (
                <li key={w.publicPath}>
                  <Link
                    prefetch={false}
                    href={routes.publicWork(w.publicPath)}
                    className="block py-4 hover:bg-hover"
                  >
                    <p className="font-manuscript text-[19px] text-primary">{w.title}</p>
                    <p className="text-[13px] text-secondary">
                      {labelOf(CATEGORY_OPTIONS, w.category)} · {w.wordCount.toLocaleString('en')} words
                    </p>
                    {w.description && (
                      <p className="mt-1 line-clamp-2 text-[14px] text-secondary">{w.description}</p>
                    )}
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>

        {a.collaborations.length > 0 && (
          <section aria-labelledby="collaborations" className="mt-12">
            <h2
              id="collaborations"
              className="mb-2 font-mono text-[11px] uppercase tracking-[0.08em] text-tertiary"
            >
              Written with others
            </h2>
            <ul className="divide-y divide-subtle border-y border-subtle">
              {a.collaborations.map((w) => (
                <li key={w.publicPath}>
                  <Link
                    prefetch={false}
                    href={routes.publicWork(w.publicPath)}
                    className="block py-4 hover:bg-hover"
                  >
                    <p className="font-manuscript text-[19px] text-primary">{w.title}</p>
                    <p className="text-[13px] text-secondary">
                      {labelOf(CATEGORY_OPTIONS, w.category)} · {w.wordCount.toLocaleString('en')} words
                    </p>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        )}
      </main>
    </Shell>
  )
}

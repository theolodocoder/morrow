import type { Metadata } from 'next'
import Link from 'next/link'
import { OPEN_ROLE_LABELS, type PublicWork } from '@morrow/contracts'
import { ReleaseCountdown } from '@/components/public/release-countdown'
import { Shell } from '@/components/shell/shell'
import { WorkCover } from '@/components/work-cover'
import { ContinueReading } from '@/components/reader/reading-progress'
import { Avatar } from '@/components/profile/avatar'
import { WorkActions } from '@/components/public/work-actions'
import { ReaderComments } from '@/components/public/reader-comments'
import { ContributeButton } from '@/components/public/contribute'
import { RetellButton } from '@/components/public/retell-button'
import { CiteButton } from '@/components/public/cite-button'
import { bylineOf } from '@/lib/format'
import { publicApi } from '@/lib/public-api'
import { routes } from '@/lib/routes'
import { CATEGORY_OPTIONS, LICENSE_OPTIONS, labelOf } from '@/lib/work-options'

type Params = { params: Promise<{ workSlug: string }> }

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const w = await publicApi<PublicWork>(`/works/${encodeURIComponent((await params).workSlug)}`)
  return {
    title: w.title,
    description: w.description || `${labelOf(CATEGORY_OPTIONS, w.category)} by ${w.author.displayName}`,
    // Unlisted works are for people with the link: keep them out of search engines.
    robots: w.indexable ? undefined : { index: false, follow: false },
    alternates: { canonical: routes.publicWork(w.publicPath) },
  }
}

const minutes = (words: number) => Math.max(1, Math.round(words / 230))

export default async function PublicWorkPage({ params }: Params) {
  const w = await publicApi<PublicWork>(`/works/${encodeURIComponent((await params).workSlug)}`)
  const first = w.chapters[0]
  const people = [w.author, ...w.contributors]
  return (
    <Shell bg="canvas" title={w.title}>
      <main id="main" className="mx-auto max-w-3xl px-4 pb-24 pt-6 sm:px-6 md:pt-12">
        {/* The hero: what it is, who made it, and the one thing to do (read) */}
        <div className="flex flex-col gap-6 sm:flex-row sm:items-end sm:gap-8">
          <div className="w-32 shrink-0 sm:w-44">
            <WorkCover cover={w.cover} title={w.title} size="card" />
          </div>
          <div className="min-w-0">
            <p className="flex flex-wrap items-center gap-x-2 text-[12px] text-tertiary">
              <span className="font-mono uppercase tracking-[0.08em]">
                {labelOf(CATEGORY_OPTIONS, w.category)}
              </span>
              {w.versionName && <span>· {w.versionName}</span>}
              <span className={w.completed ? 'text-success' : ''}>
                · {w.completed ? 'Complete' : 'Ongoing'}
              </span>
            </p>
            <h1 className="mt-1.5 font-display text-[36px] leading-[1.05] text-primary sm:text-[48px]">
              {w.title}
            </h1>
            {w.classic ? (
              <p className="mt-3 text-[15px] text-secondary">
                by <span className="font-medium text-primary">{w.classic.author}</span> · {w.classic.year} ·{' '}
                <span className="rounded-full bg-selected px-2 py-0.5 text-[12px] text-primary">
                  Public domain
                </span>
              </p>
            ) : w.openAccess ? (
              <p className="mt-3 text-[15px] text-secondary">
                by <span className="font-medium text-primary">{bylineOf(w.openAccess.authors)}</span>
                {w.openAccess.journal && <> · {w.openAccess.journal}</>} · {w.openAccess.year} ·{' '}
                <span className="rounded-full bg-selected px-2 py-0.5 text-[12px] text-primary">
                  {w.openAccess.license}
                </span>
              </p>
            ) : (
              <ul aria-label="Written by" className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2">
                {people.map((p, i) => {
                  const inner = (
                    <>
                      <Avatar
                        name={p.displayName}
                        seed={p.avatarSeed}
                        avatar={p.avatar}
                        badge={p.badge}
                        size={30}
                      />
                      <span className="text-[14px] text-primary">{p.displayName}</span>
                      {i > 0 && <span className="sr-only">(collaborator)</span>}
                    </>
                  )
                  return (
                    <li key={`${p.displayName}${i}`}>
                      {p.username ? (
                        <Link
                          href={routes.author(p.username)}
                          className="inline-flex items-center gap-2 rounded-full pr-1 hover:underline"
                        >
                          {inner}
                        </Link>
                      ) : (
                        <span className="inline-flex items-center gap-2">{inner}</span>
                      )}
                    </li>
                  )
                })}
              </ul>
            )}
          </div>
        </div>

        {w.description && (
          <p className="mt-6 max-w-[60ch] font-manuscript text-[17px] leading-relaxed text-primary">
            {w.description}
          </p>
        )}
        {w.contentWarnings.length > 0 && (
          <p className="mt-4 max-w-[60ch] rounded-md bg-app px-3 py-2 text-[13px] text-secondary">
            <span className="font-medium text-primary">Content notes:</span> {w.contentWarnings.join(', ')}
          </p>
        )}

        <div className="mt-6 flex flex-wrap items-center gap-3">
          {first && (
            <Link
              href={routes.readChapter(w.publicPath, first.slug)}
              className="press inline-flex h-11 items-center rounded-full bg-action px-6 text-[15px] font-medium text-action-fg hover:bg-action-hover"
            >
              Start reading
            </Link>
          )}
          <ContinueReading publicPath={w.publicPath} chapters={w.chapters} />
          {w.classic ? (
            <RetellButton publicPath={w.publicPath} />
          ) : w.openAccess ? (
            <CiteButton title={w.title} info={w.openAccess} />
          ) : (
            <ContributeButton
              publicPath={w.publicPath}
              title={w.title}
              authorName={w.author.displayName.split(' ')[0]!}
              chapters={w.chapters}
            />
          )}
        </div>
        {w.openAccess && (
          // CC BY asks for credit, a link to the licence, and a note of what changed: all three, always shown
          <aside
            aria-label="Source and licence"
            className="mt-5 max-w-[60ch] rounded-md border border-subtle bg-app px-4 py-3 text-[13px] text-secondary"
          >
            <p>
              Originally published in{' '}
              <span className="text-primary">{w.openAccess.journal || 'a journal'}</span> ({w.openAccess.year}
              ) by {w.openAccess.authors.join(', ')}.{' '}
              <a href={w.openAccess.url} className="text-accent underline underline-offset-2" rel="noopener">
                View the original
              </a>
              .
            </p>
            <p className="mt-1">
              Shared under{' '}
              {w.openAccess.licenseUrl ? (
                <a
                  href={w.openAccess.licenseUrl}
                  className="text-accent underline underline-offset-2"
                  rel="noopener license"
                >
                  {w.openAccess.license}
                </a>
              ) : (
                w.openAccess.license
              )}
              . {w.openAccess.changes}
            </p>
          </aside>
        )}
        {(w.releaseDay !== null || w.openRoles.length > 0) && !w.completed && (
          <div className="mt-4 flex flex-col gap-2">
            {w.releaseDay !== null && <ReleaseCountdown day={w.releaseDay} />}
            {w.openRoles.length > 0 && (
              <p className="flex flex-wrap items-center gap-1.5 text-[13px] text-secondary">
                <span className="font-medium text-primary">Looking for</span>
                {w.openRoles.map((r) => (
                  <span key={r} className="rounded-full bg-selected px-2 py-0.5 text-[12px] text-primary">
                    {OPEN_ROLE_LABELS[r]}
                  </span>
                ))}
                <span className="text-tertiary">· use Contribute to ask</span>
              </p>
            )}
          </div>
        )}
        <p className="mt-3 text-[13px] text-tertiary">
          {w.chapters.length} {w.chapters.length === 1 ? 'chapter' : 'chapters'} ·{' '}
          {w.wordCount.toLocaleString('en')} words · about {minutes(w.wordCount)} min ·{' '}
          {w.views.toLocaleString('en')} {w.views === 1 ? 'read' : 'reads'}
        </p>
        <div className="mt-3 border-y border-subtle py-1.5">
          <WorkActions
            publicPath={w.publicPath}
            title={w.title}
            likes={w.likes}
            comments={w.comments}
            {...(w.author.username
              ? { author: { username: w.author.username, name: w.author.displayName.split(' ')[0]! } }
              : {})}
          />
        </div>

        <section aria-labelledby="contents" className="mt-10">
          <h2 id="contents" className="mb-2 text-[15px] font-semibold text-primary">
            Contents
          </h2>
          <ol className="divide-y divide-subtle border-y border-subtle">
            {w.chapters.map((c, i) => (
              <li key={c.slug}>
                <Link
                  href={routes.readChapter(w.publicPath, c.slug)}
                  className="press flex items-baseline gap-4 py-3 hover:bg-hover"
                >
                  <span className="w-6 shrink-0 text-right font-mono text-[12px] text-tertiary">{i + 1}</span>
                  <span className="min-w-0 flex-1 truncate font-manuscript text-[17px] text-primary">
                    {c.title}
                  </span>
                  <span className="shrink-0 text-[12px] text-tertiary">{minutes(c.wordCount)} min</span>
                </Link>
              </li>
            ))}
          </ol>
        </section>

        <div className="mt-12">
          <ReaderComments publicPath={w.publicPath} />
        </div>

        <section aria-labelledby="about" className="mt-12 border-t border-subtle pt-6">
          <h2 id="about" className="sr-only">
            About this work
          </h2>
          {w.tags.length > 0 && (
            <ul aria-label="Tags" className="mb-3 flex flex-wrap gap-2">
              {w.tags.map((t) => (
                <li key={t}>
                  <Link
                    href={`${routes.discover}?tag=${encodeURIComponent(t)}`}
                    className="text-[13px] text-secondary hover:text-primary"
                  >
                    #{t}
                  </Link>
                </li>
              ))}
            </ul>
          )}
          <p className="text-[12px] text-tertiary">
            {labelOf(LICENSE_OPTIONS, w.license)} · Published{' '}
            {new Date(w.publishedAt).toLocaleDateString('en', {
              year: 'numeric',
              month: 'long',
              day: 'numeric',
            })}
          </p>
        </section>
      </main>
    </Shell>
  )
}

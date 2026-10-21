import type { Metadata } from 'next'
import Link from 'next/link'
import { OPEN_ROLE_LABELS, type PublicWork } from '@morrow/contracts'
import { minutesFor } from '@morrow/domain'
import { ReleaseCountdown } from '@/components/public/release-countdown'
import { Shell } from '@/components/shell/shell'
import { WorkCover } from '@/components/work-cover'
import { StartReading } from '@/components/reader/reading-progress'
import { WorkActions } from '@/components/public/work-actions'
import { ReaderComments, type CommentList } from '@/components/public/reader-comments'
import { WorkCredits } from '@/components/public/work-credits'
import { WorkContents } from '@/components/public/work-contents'
import { ContributeButton } from '@/components/public/contribute'
import { RetellButton } from '@/components/public/retell-button'
import { CiteButton } from '@/components/public/cite-button'
import { bylineOf } from '@/lib/format'
import { publicApi, publicApiAsViewer } from '@/lib/public-api'
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

/** "Novel · 12 chapters · about 3 hours · ongoing": what it is and what it asks of the reader, in one line. */
function summaryOf(w: PublicWork) {
  const m = Math.max(1, minutesFor(w.wordCount))
  const h = Math.round(m / 60)
  return [
    labelOf(CATEGORY_OPTIONS, w.category),
    w.versionName,
    // a single piece has no chapters to count
    w.chapters.length > 1 && `${w.chapters.length} chapters`,
    m >= 60 ? `about ${h} ${h === 1 ? 'hour' : 'hours'}` : `about ${m} min`,
    w.completed ? 'complete' : 'ongoing',
  ]
    .filter(Boolean)
    .join(' · ')
}

export default async function PublicWorkPage({ params }: Params) {
  const path = encodeURIComponent((await params).workSlug)
  const [w, thread] = await Promise.all([
    publicApi<PublicWork>(`/works/${path}`),
    // The work's own thread as the viewer: its first page, and the count the comments link shows, which must match
    // the heading it jumps to (w.comments also counts every chapter's discussion). Without it the thread loads
    // itself in the browser and the link reads "Comments".
    publicApiAsViewer<CommentList>(`/reading/${path}/comments`).catch(() => null),
  ])
  const credited = !w.classic && !w.openAccess
  return (
    <Shell bg="canvas" title={w.title}>
      <main id="main" className="mx-auto max-w-3xl px-4 pb-24 pt-6 sm:px-6 md:pt-12">
        {/* The hero (spec "Front page of a work"): what it is, and the one thing to do, read */}
        <div className="flex flex-col items-center gap-6 text-center sm:flex-row sm:items-end sm:gap-8 sm:text-left">
          <div className="w-[150px] shrink-0 sm:w-44">
            <WorkCover cover={w.cover} title={w.title} size="card" />
          </div>
          <div className="min-w-0">
            <h1 className="font-display text-[40px] leading-[1.05] text-primary sm:text-[52px]">{w.title}</h1>
            <p className="mt-2 font-ui text-[13px] text-secondary">{summaryOf(w)}</p>
            {w.classic ? (
              <p className="mt-3 text-[15px] text-secondary">
                by <span className="font-medium text-primary">{w.classic.author}</span> · {w.classic.year} ·{' '}
                <span className="rounded-full bg-selected px-2 py-0.5 text-[12px] text-primary">
                  Public domain
                </span>
              </p>
            ) : (
              w.openAccess && (
                <p className="mt-3 text-[15px] text-secondary">
                  by <span className="font-medium text-primary">{bylineOf(w.openAccess.authors)}</span>
                  {w.openAccess.journal && <> · {w.openAccess.journal}</>} · {w.openAccess.year} ·{' '}
                  <span className="rounded-full bg-selected px-2 py-0.5 text-[12px] text-primary">
                    {w.openAccess.license}
                  </span>
                </p>
              )
            )}
          </div>
        </div>

        {w.description && (
          <p className="mt-6 max-w-[60ch] font-manuscript text-[17px] leading-relaxed text-primary">
            {w.description}
          </p>
        )}
        <div className="mt-6">
          <StartReading publicPath={w.publicPath} chapters={w.chapters} versions={w.versions} />
        </div>

        {credited && <WorkCredits credits={w.credits} />}
        <WorkContents publicPath={w.publicPath} chapters={w.chapters} versions={w.versions} />

        {/* Below the contents, quieter: notes, ways to take part, the source's terms, and the conversation */}
        <div className="mt-10 flex flex-col gap-4">
          {w.contentWarnings.length > 0 && (
            <p className="max-w-[60ch] rounded-md bg-app px-3 py-2 text-[13px] text-secondary">
              <span className="font-medium text-primary">Content notes:</span> {w.contentWarnings.join(', ')}
            </p>
          )}
          <div className="flex flex-wrap items-center gap-3">
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
              className="max-w-[60ch] rounded-md border border-subtle bg-app px-4 py-3 text-[13px] text-secondary"
            >
              <p>
                Originally published in{' '}
                <span className="text-primary">{w.openAccess.journal || 'a journal'}</span> (
                {w.openAccess.year}) by {w.openAccess.authors.join(', ')}.{' '}
                <a
                  href={w.openAccess.url}
                  className="text-accent underline underline-offset-2"
                  rel="noopener"
                >
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
            <div className="flex flex-col gap-2">
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
          <p className="text-[13px] text-tertiary">
            {w.wordCount.toLocaleString('en')} words · {w.views.toLocaleString('en')}{' '}
            {w.views === 1 ? 'read' : 'reads'}
          </p>
        </div>
        <div className="mt-3 border-y border-subtle py-1.5">
          <WorkActions
            publicPath={w.publicPath}
            title={w.title}
            likes={w.likes}
            {...(thread ? { comments: thread.total } : {})}
            {...(w.author.username
              ? { author: { username: w.author.username, name: w.author.displayName.split(' ')[0]! } }
              : {})}
          />
        </div>

        <div className="mt-12">
          <ReaderComments publicPath={w.publicPath} initial={thread} />
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

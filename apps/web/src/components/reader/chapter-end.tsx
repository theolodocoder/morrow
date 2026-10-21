import Link from 'next/link'
import type { PublicChapter, PublicWork } from '@morrow/contracts'
import { minutesFor, sectionLabel } from '@morrow/domain'
import { Avatar, AvatarStack } from '@/components/profile/avatar'
import { FollowControls } from '@/components/follows/follow-controls'
import { ReleaseCountdown } from '@/components/public/release-countdown'
import { WorkActions } from '@/components/public/work-actions'
import { routes } from '@/lib/routes'

/*
 * The dark ink card borrows the night tone's tokens (`.reader[data-tone='night']` re-declares them for its subtree),
 * so every pairing inside it is one the token contrast tests already cover, on paper, sepia and night pages alike.
 */
const INK = 'reader rounded-[18px] border bg-canvas px-5 pb-5 pt-[18px] text-primary'
const META = 'flex items-center gap-1.5 font-ui text-[12px] text-secondary'
const CARD_TITLE = 'mb-1.5 mt-1 font-display text-[26px] leading-tight text-primary sm:text-[28px]'
const TEASER = 'font-manuscript text-[15px] italic leading-normal text-secondary'
// Whole-card links: the page tone's own focus ring, drawn outside the card where it contrasts with the page.
const CARD_LINK = 'block rounded-[18px] focus-visible:outline-offset-4'
const NOTE = 'mt-4 text-center font-ui text-[13px] text-secondary'

const list = (names: string[]) => new Intl.ListFormat('en', { type: 'conjunction' }).format(names)

/**
 * Below the last paragraph (spec "Chapter end"): a clear stopping point, then one honest way on. Nothing here loads
 * the next chapter; the reader asks for it. Exactly one of Up next, Pick a path, The end or More soon.
 */
export function ChapterEnd({
  work,
  chapter,
  label,
}: {
  work: PublicWork
  chapter: PublicChapter
  /** this chapter's section label ("Chapter three"); null for a single-piece work */
  label: string | null
}) {
  const { next, alternates } = chapter
  // A single-piece work has no "End of …" heading, so its own headings step up to keep the outline unbroken.
  const H = label ? 'h3' : 'h2'
  const nextMeta = next
    ? [
        sectionLabel(work.category, chapter.index + 1, work.chapters.length),
        `${minutesFor(next.wordCount)} min`,
      ]
        .filter(Boolean)
        .join(' · ')
    : ''
  const nextHref = next ? routes.readChapter(work.publicPath, next.slug) : ''
  const teaser = next?.opening ? <p className={TEASER}>“{next.opening}”</p> : null

  return (
    <section className="-mx-4 mt-16 border-y border-subtle bg-app px-4 py-8 sm:mx-0 sm:rounded-lg sm:border sm:px-8">
      {label && (
        <h2 className="text-center font-display text-[22px] italic text-secondary">
          End of {label.toLowerCase()}
        </h2>
      )}
      <div className="mb-6 mt-3 flex justify-center font-ui">
        <WorkActions
          publicPath={work.publicPath}
          title={work.title}
          likes={work.likes}
          // ponytail: no chapter-scoped count exists, so the link reads "Comments"; add one to PublicChapter to show it
          commentsHref="#discussion"
        />
      </div>

      {next && alternates.length > 0 ? (
        <div>
          <H className="mb-3 text-center font-ui text-[13px] font-normal text-secondary">
            The story splits here. Which way?
          </H>
          <ul className="flex flex-col gap-2.5">
            <li>
              <Link rel="next" href={nextHref} className={CARD_LINK}>
                {/* the accent edge marks the obvious choice even on a night page, where the card colour alone would not */}
                <div data-tone="night" className={`${INK} border-action transition-colors hover:bg-raised`}>
                  <p className={META}>Main story · {nextMeta}</p>
                  <p className={CARD_TITLE}>{next.title}</p>
                  {teaser}
                </div>
              </Link>
            </li>
            {alternates.map((a) => (
              <li key={a.slug}>
                <Link
                  href={routes.readChapter(work.publicPath, a.firstChapter.slug)}
                  className={`${CARD_LINK} border border-subtle bg-canvas px-5 pb-4 pt-4 transition-colors hover:bg-hover`}
                >
                  <p className={META}>
                    <Avatar
                      name={a.author.displayName}
                      seed={a.author.avatarSeed}
                      avatar={a.author.avatar}
                      size={18}
                    />
                    {a.author.displayName}’s version · {a.chapterCount}{' '}
                    {a.chapterCount === 1 ? 'chapter' : 'chapters'}
                  </p>
                  <p className={CARD_TITLE}>{a.name}</p>
                  {a.premise && <p className={TEASER}>{a.premise}</p>}
                </Link>
              </li>
            ))}
          </ul>
          <p className={NOTE}>You can come back and read the other way any time</p>
        </div>
      ) : next ? (
        <div data-tone="night" className={`${INK} border-subtle`}>
          <p className={META}>Up next · {nextMeta}</p>
          <H className={CARD_TITLE}>{next.title}</H>
          {teaser}
          <Link
            rel="next"
            href={nextHref}
            className="mt-4 flex h-12 items-center justify-center rounded-full bg-action font-ui text-[15px] font-semibold text-action-fg transition-colors hover:bg-action-hover"
          >
            Keep reading
          </Link>
        </div>
      ) : work.completed ? (
        <TheEnd work={work} H={H} />
      ) : (
        <div className="flex flex-col items-center gap-4 text-center font-ui">
          <H className="font-display text-[32px] leading-none text-primary">More soon</H>
          {work.releaseDay !== null && <ReleaseCountdown day={work.releaseDay} />}
          <FollowControls work={{ publicPath: work.publicPath }} bookmark={false} />
        </div>
      )}
    </section>
  )
}

/** The last chapter of a finished work: a colophon of who made it, and a way to hear what the writer does next. */
function TheEnd({ work, H }: { work: PublicWork; H: 'h2' | 'h3' }) {
  const names = (role: 'cowriter' | 'contributor') =>
    work.credits.filter((c) => c.role === role).map((c) => c.person.displayName)
  const cowriters = names('cowriter')
  const contributors = names('contributor')
  const faces = [work.author, ...work.credits.filter((c) => c.role !== 'author').map((c) => c.person)].slice(
    0,
    5,
  )
  const { author } = work
  return (
    <div className="flex flex-col items-center gap-3 text-center font-ui">
      <H className="font-display text-[40px] leading-none text-primary">The end</H>
      <AvatarStack people={faces} size={28} />
      <div className="text-[14px] text-secondary">
        <p>
          Written by {author.displayName}
          {cowriters.length > 0 && `, with ${list(cowriters)}`}
        </p>
        {contributors.length > 0 && <p>Contributions from {list(contributors)}</p>}
      </div>
      {author.username && <FollowControls author={{ username: author.username, name: author.displayName }} />}
    </div>
  )
}

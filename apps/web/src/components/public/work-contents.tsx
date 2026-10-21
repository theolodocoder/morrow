'use client'
import Link from 'next/link'
import type { PublicWork } from '@morrow/contracts'
import { continueFrom, minutesFor, READ_PERCENT } from '@morrow/domain'
import { liveSlugsOf, runsOf, useWorkProgress } from '@/components/reader/reading-progress'
import { routes } from '@/lib/routes'
import { SECTION_HEAD } from './work-credits'

/**
 * The front page's contents (spec "Front page of a work"): read chapters dimmed, the one to continue in the accent
 * with how far in, and a line under the chapter where each alternate version branches off.
 */
export function WorkContents({
  publicPath,
  chapters,
  versions,
}: {
  publicPath: string
  chapters: PublicWork['chapters']
  versions: PublicWork['versions']
}) {
  const progress = useWorkProgress(publicPath, liveSlugsOf(chapters, versions))
  const at = progress && continueFrom(runsOf(chapters, versions), progress.items, progress.last)
  const percent = (slug: string) => progress?.items.find((p) => p.chapterSlug === slug)?.percent ?? 0
  return (
    <section aria-labelledby="contents" className="mt-10 scroll-mt-20">
      <h2 id="contents" className={SECTION_HEAD}>
        Contents
      </h2>
      <ol className="border-t border-subtle">
        {chapters.map((c, i) => {
          const here = at?.chapter.slug === c.slug
          const read = !here && percent(c.slug) >= READ_PERCENT
          // `afterChapter` is 1-based: the version takes over after this chapter
          const forks = versions.filter((v) => v.afterChapter === i + 1 && v.chapters[0])
          return (
            <li key={c.slug} className="border-b border-subtle">
              <Link
                prefetch={false}
                href={routes.readChapter(publicPath, c.slug)}
                className="press flex items-baseline gap-3 rounded-sm py-3 transition-colors hover:bg-hover"
              >
                <span className="w-6 shrink-0 text-right font-ui text-[12px] tabular-nums text-tertiary">
                  {i + 1}
                </span>
                <span
                  className={`min-w-0 flex-1 font-manuscript text-[17px] ${here ? 'text-accent' : read ? 'text-tertiary' : 'text-primary'}`}
                >
                  {c.title}
                  {read && <span className="sr-only"> (read)</span>}
                </span>
                <span
                  className={`shrink-0 font-ui text-[12px] tabular-nums ${here ? 'text-accent' : 'text-tertiary'}`}
                >
                  {here ? `${percent(c.slug)}% read` : `${minutesFor(c.wordCount)} min`}
                </span>
              </Link>
              {forks.length > 0 && (
                <ul className="pb-2">
                  {forks.map((v) => (
                    <li key={v.slug}>
                      <Link
                        prefetch={false}
                        href={routes.readChapter(publicPath, v.chapters[0]!.slug)}
                        className="block rounded-sm py-1 pl-9 font-ui text-[13px] text-secondary transition-colors hover:text-primary hover:underline"
                      >
                        <span aria-hidden="true">↳ </span>Also: “{v.name}”, {v.author.displayName}’s version
                        from here
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </li>
          )
        })}
      </ol>
    </section>
  )
}

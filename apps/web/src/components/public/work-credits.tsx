import Link from 'next/link'
import type { PublicCredit } from '@morrow/contracts'
import { Avatar } from '@/components/profile/avatar'
import { routes } from '@/lib/routes'

/** The front page's section headings (Hearth): small capitals in the accent, like the chapter opener's label. */
export const SECTION_HEAD =
  'mb-2.5 font-manuscript text-[15px] font-normal tracking-[0.06em] text-accent [font-variant-caps:small-caps]'

function roleOf({ role, chapters }: PublicCredit) {
  if (role === 'author') return 'Author'
  if (role === 'contributor') return 'Contributor'
  if (!chapters.length) return 'Co-writer'
  return `Co-writer · ${chapters.length === 1 ? 'chapter' : 'chapters'} ${chapters.join(', ')}`
}

/** Who made the work and how (spec "Credits per chapter"): the colophon, as fixed when each chapter was published. */
export function WorkCredits({ credits }: { credits: PublicCredit[] }) {
  return (
    <section aria-labelledby="written-by" className="mt-10">
      <h2 id="written-by" className={SECTION_HEAD}>
        Written by
      </h2>
      <ul className="flex flex-col">
        {credits.map((c) => {
          const p = c.person
          const face = (
            <>
              <Avatar name={p.displayName} seed={p.avatarSeed} avatar={p.avatar} badge={p.badge} size={30} />
              <span className="text-[15px] text-primary">{p.displayName}</span>
            </>
          )
          return (
            <li
              key={`${c.role}:${p.username ?? p.avatarSeed}`}
              className="flex items-center gap-3 py-1.5 font-ui"
            >
              {p.username ? (
                <Link
                  href={routes.author(p.username)}
                  className="inline-flex min-w-0 items-center gap-2.5 rounded-full pr-1 hover:underline"
                >
                  {face}
                </Link>
              ) : (
                <span className="inline-flex min-w-0 items-center gap-2.5">{face}</span>
              )}
              <span className="ml-auto shrink-0 text-right text-[13px] text-secondary">{roleOf(c)}</span>
            </li>
          )
        })}
      </ul>
    </section>
  )
}

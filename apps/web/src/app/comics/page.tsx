import Link from 'next/link'
import { Shell } from '@/components/shell/shell'
import { ComicsArt } from '@/components/public/comics-art'
import { NotifyMe } from '@/components/public/notify-me'
import { PeopleIcon, PenIcon, ReadingIcon } from '@/components/ui/icons'
import { routes } from '@/lib/routes'

export const metadata = {
  title: 'Comics, coming soon',
  description: 'Make comics together on Morrow: write the script with others, then draw it as a team.',
}

const STEPS = [
  {
    icon: PenIcon,
    title: 'Write the script together',
    body: 'Pages, panels, dialogue, captions and sound effects, in an editor made for comic scripts. Co-write live, suggest changes, branch a page.',
    when: 'First',
  },
  {
    icon: PeopleIcon,
    title: 'Draw it as a team',
    body: 'Pencils, inks, colours and letters: each artist takes a role on a page, uploads panels, and the team reviews them like any other change.',
    when: 'Next',
  },
  {
    icon: ReadingIcon,
    title: 'Read it anywhere',
    body: 'Page by page with pinch to zoom, or one long scroll on a phone. Everyone who made it is credited on every page.',
    when: 'Then',
  },
]

/** Comics: not built yet (product/comics-proposal.md). What's coming, and a way to hear when it's here. */
export default function ComicsPage() {
  return (
    <Shell bg="canvas" title="Comics">
      <main id="main" className="mx-auto max-w-5xl px-4 pb-24 pt-8 sm:px-8 md:pt-14">
        <div className="grid items-center gap-10 md:grid-cols-[1.1fr_1fr]">
          <div className="flex flex-col items-start gap-5">
            <span className="rounded-full bg-selected px-3 py-1 font-mono text-[11px] uppercase tracking-[0.1em] text-accent">
              Coming soon
            </span>
            <h1 className="font-display text-[44px] leading-[1.02] text-primary sm:text-[60px]">
              Make comics <em className="text-accent">together.</em>
            </h1>
            <p className="max-w-[46ch] font-manuscript text-[18px] leading-relaxed text-secondary">
              Comics have always been made by teams: a writer, an artist, a colourist, a letterer. Soon you’ll
              be able to make them on Morrow, from the first script to the last panel.
            </p>
            <div className="flex flex-wrap items-center gap-3">
              <NotifyMe feature="comics" label="Notify me when it’s ready" />
              <Link
                href={routes.discover}
                className="press inline-flex h-10 items-center rounded-full px-4 text-[15px] text-secondary hover:bg-hover hover:text-primary"
              >
                Read something now
              </Link>
            </div>
          </div>
          <ComicsArt className="mx-auto w-full max-w-[420px]" />
        </div>
        <ol className="mt-16 grid gap-4 sm:grid-cols-3">
          {STEPS.map((s, i) => (
            <li
              key={s.title}
              className="rise-in flex flex-col gap-3 rounded-xl border border-subtle bg-app p-5"
              style={{ '--i': i } as React.CSSProperties}
            >
              <span className="flex items-center justify-between">
                <span className="grid size-10 place-items-center rounded-full bg-selected text-accent">
                  <s.icon size={18} />
                </span>
                <span className="font-mono text-[11px] uppercase tracking-[0.1em] text-tertiary">
                  {s.when}
                </span>
              </span>
              <h2 className="font-display text-[22px] leading-tight text-primary">{s.title}</h2>
              <p className="text-[14px] text-secondary">{s.body}</p>
            </li>
          ))}
        </ol>
      </main>
    </Shell>
  )
}

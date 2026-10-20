import Link from 'next/link'
import type { Discovery } from '@morrow/contracts'
import { Shell } from '@/components/shell/shell'
import { EmptyState } from '@/components/brand/spots'
import { WorkCover } from '@/components/work-cover'
import { publicApi } from '@/lib/public-api'
import { routes } from '@/lib/routes'

export const metadata = {
  title: 'Open research',
  description: 'Openly licensed research articles on Morrow, credited to their authors and free to read.',
}

/** Open research (P-064): openly licensed articles, read like a journal's contents page. */
export default async function ResearchPage() {
  const d = await publicApi<Discovery>('/discover')
  return (
    <Shell bg="app" title="Open research">
      <main id="main" className="mx-auto max-w-4xl px-4 pb-24 pt-8 sm:px-8 md:pt-12">
        <div className="relative overflow-hidden rounded-xl border border-subtle bg-canvas p-6 sm:p-10">
          {/* a journal page with a rising line: research, drawn */}
          <svg
            aria-hidden="true"
            viewBox="0 0 220 140"
            className="pointer-events-none absolute -right-4 bottom-0 hidden w-[240px] opacity-90 sm:block"
          >
            <rect
              x="40"
              y="18"
              width="130"
              height="122"
              rx="4"
              fill="var(--bg-app)"
              stroke="var(--text-primary)"
              strokeWidth="2"
              opacity=".8"
            />
            {[40, 52, 64].map((y) => (
              <path
                key={y}
                d={`M56 ${y}h${y === 64 ? 60 : 98}`}
                stroke="var(--text-tertiary)"
                strokeWidth="2"
                strokeLinecap="round"
              />
            ))}
            <path
              className="spot-write"
              d="M58 120l22-18 18 8 30-30 22 10"
              fill="none"
              stroke="var(--action-primary-bg)"
              strokeWidth="3"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            <circle className="spot-bob" cx="150" cy="90" r="5" fill="var(--decor-ornament)" />
          </svg>
          <p className="font-mono text-[11px] uppercase tracking-[0.1em] text-accent">The Morrow Library</p>
          <h1 className="mt-2 max-w-[18ch] font-display text-[40px] leading-[1.03] text-primary sm:text-[54px]">
            Open research, <em className="text-accent">free to read.</em>
          </h1>
          <p className="mt-3 max-w-[52ch] font-manuscript text-[17px] leading-relaxed text-secondary">
            Papers their authors shared under open licences (CC BY or CC0), credited to them and linked to the
            original. Comment on a paragraph, or cite them in your own work.
          </p>
        </div>
        {d.research.length ? (
          <ol className="mt-8 flex flex-col divide-y divide-subtle">
            {d.research.map((w) => (
              <li key={w.publicPath}>
                <Link href={routes.publicWork(w.publicPath)} className="lift group flex gap-4 py-5">
                  <WorkCover cover={w.cover} title={w.title} />
                  <span className="min-w-0 flex-1">
                    <span className="block font-manuscript text-[19px] leading-snug text-primary group-hover:underline">
                      {w.title}
                    </span>
                    <span className="mt-1 block text-[13px] text-secondary">{w.author.displayName}</span>
                    {w.openAccess && (
                      <span className="mt-1 flex flex-wrap items-center gap-2 text-[12px] text-tertiary">
                        <span className="italic">{w.openAccess.journal}</span>
                        <span aria-hidden="true">·</span>
                        {w.openAccess.year}
                        <span className="rounded-full bg-selected px-2 py-px text-[11px] text-primary">
                          {w.openAccess.license}
                        </span>
                      </span>
                    )}
                    {w.description && (
                      <span className="mt-2 line-clamp-2 block text-[14px] text-secondary">
                        {w.description}
                      </span>
                    )}
                  </span>
                </Link>
              </li>
            ))}
          </ol>
        ) : (
          <EmptyState
            spot="chart"
            title="The first papers are on their way."
            body="Open research arrives here soon."
          />
        )}
      </main>
    </Shell>
  )
}

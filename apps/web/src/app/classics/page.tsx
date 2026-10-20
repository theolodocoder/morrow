import type { Discovery } from '@morrow/contracts'
import { Shell } from '@/components/shell/shell'
import { WorkCard } from '@/components/public/work-card'
import { EmptyState } from '@/components/brand/spots'
import { publicApi } from '@/lib/public-api'

export const metadata = {
  title: 'Classics',
  description: 'Public-domain classics on Morrow: free to read, and free to retell.',
}

/** The classics shelf (P-063): every public-domain book on Morrow, and what you can do with them. */
export default async function ClassicsPage() {
  const d = await publicApi<Discovery>('/discover')
  return (
    <Shell bg="app" title="Classics">
      <main id="main" className="mx-auto max-w-6xl px-4 pb-24 pt-8 sm:px-8 md:pt-12">
        <div className="relative overflow-hidden rounded-xl border border-subtle bg-canvas p-6 sm:p-10">
          {/* a shelf of spines, drawn */}
          <svg
            aria-hidden="true"
            viewBox="0 0 320 120"
            className="pointer-events-none absolute -right-6 bottom-0 w-[300px] opacity-90 sm:w-[380px]"
          >
            <path d="M0 116h320" stroke="var(--text-primary)" strokeWidth="2" opacity=".35" />
            {[
              [20, 70, '#BD5438'],
              [44, 90, '#2F5966'],
              [66, 62, '#C9A227'],
              [92, 84, '#546648'],
              [114, 74, '#7A4A68'],
              [140, 96, '#22221F'],
              [162, 68, '#E8D9C5'],
              [186, 88, '#BD5438'],
            ].map(([x, h, c], i) => (
              <g key={i} className="rise-in" style={{ '--i': i } as React.CSSProperties}>
                <rect
                  x={x as number}
                  y={116 - (h as number)}
                  width="20"
                  height={h as number}
                  rx="2"
                  fill={c as string}
                />
                <rect
                  x={(x as number) + 4}
                  y={126 - (h as number)}
                  width="12"
                  height="2"
                  fill="#FBF8F1"
                  opacity=".6"
                />
              </g>
            ))}
            <rect
              x="212"
              y="40"
              width="20"
              height="76"
              rx="2"
              fill="#2F5966"
              transform="rotate(14 222 116)"
            />
          </svg>
          <p className="font-mono text-[11px] uppercase tracking-[0.1em] text-accent">The Morrow Library</p>
          <h1 className="mt-2 max-w-[16ch] font-display text-[40px] leading-[1.03] text-primary sm:text-[54px]">
            Classics, free to read <em className="text-accent">and to retell.</em>
          </h1>
          <p className="mt-3 max-w-[52ch] font-manuscript text-[17px] leading-relaxed text-secondary">
            These books belong to everyone. Read them here, comment on a line, or take one and make it yours:
            a retelling, a missing chapter, the story from someone else’s side.
          </p>
        </div>
        {d.classics.length ? (
          <ul className="mt-10 grid grid-cols-2 gap-x-5 gap-y-8 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
            {d.classics.map((w) => (
              <li key={w.publicPath}>
                <WorkCard w={w} />
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState spot="shelf" title="The shelves are being stocked." body="Classics arrive here soon." />
        )}
      </main>
    </Shell>
  )
}

import Link from 'next/link'
import type { WeeklyPrompt } from '@morrow/contracts'
import { WorkCover } from '@/components/work-cover'
import { routes } from '@/lib/routes'
import { WriteForPrompt } from './write-for-prompt'

const daysLeft = (endsAt: string) => Math.max(1, Math.ceil((Date.parse(endsAt) - Date.now()) / 86_400_000))

/**
 * This week's prompt (P-059): the idea, how long is left, the first few entries, and the way in. "rail" sits beside
 * the feed; "banner" leads Discover.
 */
export function PromptCard({
  p,
  signedIn,
  variant = 'rail',
}: {
  p: WeeklyPrompt
  signedIn: boolean
  variant?: 'rail' | 'banner'
}) {
  const left = daysLeft(p.endsAt)
  return (
    <section
      aria-labelledby={`prompt-${variant}`}
      className={`relative overflow-hidden rounded-xl border border-subtle bg-canvas p-5 ${variant === 'banner' ? 'sm:p-7' : ''}`}
    >
      {/* the week as a horizon: a sun that's further along the line the further into the week we are */}
      <svg
        aria-hidden="true"
        viewBox="0 0 300 60"
        className="pointer-events-none absolute inset-x-0 bottom-0 h-14 w-full"
      >
        <path d="M0 52h300" stroke="var(--border-subtle)" strokeWidth="1.5" />
        {/* a half sun on the line, rising: further along the further into the week */}
        <path
          d={`M${6 + ((7 - left) / 7) * 260} 51a14 14 0 0 1 28 0Z`}
          fill="var(--decor-ornament)"
          opacity=".45"
        />
      </svg>
      <div
        className={`relative flex flex-col gap-3 ${variant === 'banner' ? 'sm:flex-row sm:items-end sm:justify-between sm:gap-8' : ''}`}
      >
        <div className="min-w-0">
          <p className="font-mono text-[11px] uppercase tracking-[0.1em] text-accent">
            This week’s prompt · {left} {left === 1 ? 'day' : 'days'} left
          </p>
          <h2
            id={`prompt-${variant}`}
            className={`mt-1.5 font-display leading-tight text-primary ${variant === 'banner' ? 'text-[30px] sm:text-[36px]' : 'text-[22px]'}`}
          >
            {p.title}
          </h2>
          <p className="mt-1 max-w-[52ch] font-manuscript text-[15px] text-secondary">{p.body}</p>
        </div>
        <div className="flex flex-col gap-3 sm:shrink-0">
          {p.recent.length > 0 && (
            <Link
              href={`${routes.discover}?tag=${p.tag}`}
              className="group flex items-center gap-2 text-[13px] text-secondary hover:text-primary"
            >
              <span className="flex -space-x-3">
                {p.recent.slice(0, 4).map((w) => (
                  <span key={w.publicPath} className="w-7 transition-transform group-hover:-translate-y-0.5">
                    <WorkCover cover={w.cover} title={w.title} size="card" />
                  </span>
                ))}
              </span>
              {p.entries} {p.entries === 1 ? 'entry' : 'entries'}
            </Link>
          )}
          <WriteForPrompt title={p.title} tag={p.tag} signedIn={signedIn} />
        </div>
      </div>
    </section>
  )
}

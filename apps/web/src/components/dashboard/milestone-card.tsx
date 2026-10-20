'use client'
import { useEffect, useState } from 'react'
import type { Work } from '@morrow/contracts'
import { Button } from '@/components/ui/button'
import { ShareIcon } from '@/components/ui/icons'
import { toast } from '@/components/ui/toast'
import { api } from '@/lib/client-api'
import { routes } from '@/lib/routes'

/**
 * A milestone, celebrated (P-056): opened from the notification. The work's share card, the number, and one button to
 * pass it on. Confetti is a few of the brand's suns, rising once.
 */
export function MilestoneCard({ workId, kind, n }: { workId: string; kind: 'reads' | 'likes'; n: number }) {
  const [work, setWork] = useState<Work | null>(null)
  useEffect(() => {
    void api<Work>(`/works/${workId}`).then(setWork, () => {})
  }, [workId])
  if (!work || !work.publishedAt) return null
  const url = `${window.location.origin}${routes.publicWork(work.publicPath)}`

  async function share() {
    const text = `“${work!.title}” just passed ${n.toLocaleString('en')} ${kind} on Morrow`
    try {
      if (navigator.share) await navigator.share({ title: work!.title, text, url })
      else {
        await navigator.clipboard.writeText(`${text} ${url}`)
        toast('Link copied')
      }
    } catch {
      // dismissed
    }
  }

  return (
    <section
      aria-label="Milestone"
      className="relative overflow-hidden rounded-xl border border-subtle bg-canvas p-5 sm:flex sm:items-center sm:gap-6"
    >
      <svg
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 h-full w-full"
        preserveAspectRatio="none"
      >
        {[12, 28, 46, 64, 82, 94].map((x, i) => (
          <circle
            key={x}
            className="milestone-sun"
            cx={`${x}%`}
            cy="110%"
            r={4 + (i % 3) * 2}
            fill={i % 2 ? 'var(--decor-ornament)' : 'var(--action-primary-bg)'}
            style={{ animationDelay: `${i * 90}ms` }}
          />
        ))}
      </svg>
      {/* the share card itself, as people will see it */}
      <img
        src={`${routes.publicWork(work.publicPath)}/opengraph-image`}
        alt=""
        width={240}
        height={126}
        className="relative w-full rounded-md border border-subtle sm:w-60"
      />
      <div className="relative mt-4 sm:mt-0">
        <p className="font-mono text-[11px] uppercase tracking-[0.1em] text-accent">Milestone</p>
        <p className="mt-1 font-display text-[28px] leading-tight text-primary">
          {n.toLocaleString('en')} {kind}
        </p>
        <p className="text-[14px] text-secondary">for “{work.title}”. People are finding it.</p>
        <Button variant="primary" className="mt-3" onPress={() => void share()}>
          <ShareIcon size={16} />
          Share the moment
        </Button>
      </div>
    </section>
  )
}

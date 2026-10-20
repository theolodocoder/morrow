import Link from 'next/link'
import { LivingManuscript } from '@/components/brand/living-manuscript'
import { BranchIcon, CommentIcon, PublishIcon } from '@/components/ui/icons'

const POINTS = [
  {
    icon: CommentIcon,
    title: 'Write together',
    body: 'Invite co-writers, take suggestions from readers, keep every version.',
  },
  {
    icon: BranchIcon,
    title: 'Try every direction',
    body: 'Branch a chapter, compare the endings, merge the one you love.',
  },
  {
    icon: PublishIcon,
    title: 'Publish and be read',
    body: 'Stories, books, poems, articles and papers, each set the way it should read.',
  },
]

/**
 * The first thing a signed-out visitor sees at home: what Morrow is, in a line, and a way in. The feed starts right
 * below, so the product shows itself rather than describing itself.
 */
export function HomeHero() {
  return (
    <section
      aria-labelledby="hero"
      className="relative overflow-hidden border-b border-subtle bg-canvas px-4 py-10 sm:px-8 md:py-14"
    >
      <div className="mx-auto grid max-w-5xl items-center gap-8 md:grid-cols-[1.15fr_1fr]">
        <div>
          <p className="font-mono text-[11px] uppercase tracking-[0.1em] text-tertiary">
            A home for writing in the open
          </p>
          <h1 id="hero" className="mt-3 font-display text-[42px] leading-[1.02] text-primary sm:text-[58px]">
            Good ideas deserve a <em className="text-accent">tomorrow.</em>
          </h1>
          <p className="mt-4 max-w-[46ch] text-[16px] leading-relaxed text-secondary">
            Write stories, books, poems, articles and papers, alone or together. Read what people are making,
            and help shape what comes next.
          </p>
          <div className="mt-6 flex flex-wrap gap-3">
            <Link
              href="/sign-up"
              className="press inline-flex h-11 items-center rounded-full bg-action px-6 text-[15px] font-medium text-action-fg shadow-sm hover:bg-action-hover"
            >
              Start writing, free
            </Link>
            <a
              href="#feed"
              className="press inline-flex h-11 items-center rounded-full border border-control px-6 text-[15px] text-primary hover:bg-hover"
            >
              Start reading
            </a>
          </div>
          <ul className="mt-8 grid gap-4 sm:grid-cols-3">
            {POINTS.map((p) => (
              <li key={p.title} className="flex gap-3 sm:flex-col sm:gap-2">
                <span className="grid size-9 shrink-0 place-items-center rounded-full bg-selected text-accent">
                  <p.icon size={18} />
                </span>
                <span>
                  <span className="block text-[14px] font-semibold text-primary">{p.title}</span>
                  <span className="block text-[13px] leading-snug text-secondary">{p.body}</span>
                </span>
              </li>
            ))}
          </ul>
        </div>
        <div className="hero-art mx-auto w-full max-w-[220px] md:max-w-[420px]">
          <LivingManuscript state="continuing" className="w-full" />
        </div>
      </div>
    </section>
  )
}

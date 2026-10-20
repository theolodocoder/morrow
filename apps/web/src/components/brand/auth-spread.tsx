import Link from 'next/link'
import { Logo } from '@/components/brand/logo'
import { LivingManuscript } from '@/components/brand/living-manuscript'
import { presence } from '@morrow/tokens'

/**
 * Auth as an editorial spread, not a card on grey (research: auth-screen-references). The left page carries the
 * brand and the living-manuscript illustration, whose state says where you are in the story: page one when
 * signing up, mid-book when returning. The right page is the form, set directly on paper.
 */
export function AuthSpread({
  state,
  children,
}: {
  state: 'beginning' | 'continuing'
  children: React.ReactNode
}) {
  const folio = state === 'beginning' ? 'Sign up — p. 1' : 'Sign in — p. 214'
  return (
    <div className="grid min-h-dvh bg-canvas lg:grid-cols-[1.1fr_1fr]">
      <aside className="relative flex flex-col overflow-hidden border-b border-subtle bg-app px-6 pb-6 pt-6 lg:border-b-0 lg:border-r lg:px-12 lg:pb-10 lg:pt-10">
        <div className="flex items-center justify-between">
          <Link href="/" className="rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-focus">
            <Logo height={36} />
          </Link>
          <span className="font-mono text-[11px] uppercase tracking-[0.08em] text-tertiary">{folio}</span>
        </div>

        <div className="relative -mb-2 flex flex-1 items-center justify-center lg:mb-0 lg:py-8">
          <LivingManuscript
            state={state}
            className="w-full max-w-[150px] sm:max-w-[220px] lg:max-w-[520px]"
          />
          <ProofSlip />
        </div>

        <div className="hidden lg:block">
          <p className="max-w-[18ch] font-display text-[44px] leading-[1.05] text-primary xl:text-[52px]">
            Good ideas deserve a <em className="text-accent">tomorrow.</em>
          </p>
          <div className="mt-8 flex items-center justify-between border-t border-subtle pt-4 font-mono text-[11px] uppercase tracking-[0.08em] text-tertiary">
            <span>Write · Invite · Branch</span>
            <span>Fig. 1 — The living manuscript</span>
          </div>
        </div>
      </aside>

      <main id="main" className="flex items-center justify-center px-6 py-12 sm:px-10 lg:py-16">
        <div className="w-full max-w-[400px]">{children}</div>
      </main>
    </div>
  )
}

/**
 * Social proof by showing writing, not logos or numbers. This is sample content and says so plainly until
 * real, consented excerpts exist.
 */
function ProofSlip() {
  const people = [
    ['A', presence.light[0]],
    ['T', presence.light[1]],
    ['M', presence.light[3]],
  ] as const
  return (
    <figure className="absolute left-0 top-6 hidden w-[290px] -rotate-2 border border-subtle bg-canvas p-4 xl:block">
      <figcaption className="mb-2 font-mono text-[10px] uppercase tracking-[0.08em] whitespace-nowrap text-tertiary">
        Sample · <span className="italic">The Salt Orchard</span>, ch. 3
      </figcaption>
      <blockquote className="font-manuscript text-[15px] italic leading-[1.5] text-primary">
        “She looked back once, and the orchard looked back at her.”
      </blockquote>
      <div className="mt-3 flex items-center gap-2 text-[12px] text-secondary">
        <span className="flex gap-0.5" aria-hidden="true">
          {people.map(([initial, color]) => (
            <span
              key={initial}
              className="grid size-[18px] place-items-center rounded-full text-[9px] font-semibold text-[#FFFFFF]"
              style={{ background: color }}
            >
              {initial}
            </span>
          ))}
        </span>
        <span>3 co-authors · revised 2h ago</span>
      </div>
    </figure>
  )
}

'use client'
import Link from 'next/link'
import { useEffect, useRef, useState } from 'react'
import type { Work } from '@morrow/contracts'
import { ComicGlyph, KindGlyph } from '@/components/brand/kind-glyphs'
import { routes } from '@/lib/routes'
import { ChevronRightIcon, CloseIcon } from '@/components/ui/icons'

type Tab = { id: string; label: string; href: string; current: boolean }
type Kind = { id: Work['category']; label: string; href: string; current: boolean }

/**
 * Home's filters (design/product-redesign.md §12), following the tabs-vs-chips rule: the feeds (Latest, Popular,
 * Following) are tabs, because each is a different feed; the kinds of writing are chips, because they narrow the
 * one you're on. Tabs come first and carry the weight; chips are quiet, carry their glyph, and a chosen one shows
 * an × that clears it (no "All" chip needed). The row fades at an edge with more to see, and on a pointer device
 * arrows scroll it.
 */
export function FeedFilters({ tabs, kinds, clearHref }: { tabs: Tab[]; kinds: Kind[]; clearHref: string }) {
  const row = useRef<HTMLUListElement>(null)
  const [edges, setEdges] = useState({ start: false, end: false })
  useEffect(() => {
    const el = row.current
    if (!el) return
    const update = () =>
      setEdges({
        start: el.scrollLeft > 4,
        end: el.scrollLeft + el.clientWidth < el.scrollWidth - 4,
      })
    // keep the chosen chip in view after navigating
    el.querySelector<HTMLElement>('[aria-current="page"]')?.scrollIntoView({
      block: 'nearest',
      inline: 'center',
    })
    update()
    el.addEventListener('scroll', update, { passive: true })
    window.addEventListener('resize', update)
    return () => {
      el.removeEventListener('scroll', update)
      window.removeEventListener('resize', update)
    }
  }, [])
  const scroll = (dir: 1 | -1) => row.current?.scrollBy({ left: dir * 240, behavior: 'smooth' })
  const mask = `linear-gradient(90deg, ${edges.start ? 'transparent, #000 40px' : '#000'}, ${edges.end ? '#000 calc(100% - 40px), transparent' : '#000'})`

  return (
    <div className="flex flex-col gap-3">
      <nav aria-label="Feeds" className="flex items-end gap-6 px-4 sm:px-0">
        {tabs.map((t) => (
          <Link
            key={t.id}
            href={t.href}
            aria-current={t.current ? 'page' : undefined}
            className={`press relative pb-2 text-[16px] transition-colors ${t.current ? 'font-semibold text-primary' : 'text-secondary hover:text-primary'}`}
          >
            {t.label}
            {t.current && (
              <span
                aria-hidden="true"
                className="tab-ink absolute inset-x-0 bottom-0 h-[3px] rounded-full bg-[var(--text-primary)]"
              />
            )}
          </Link>
        ))}
      </nav>
      <nav aria-label="Kinds of writing" className="group relative">
        <ul
          ref={row}
          className="flex gap-1.5 overflow-x-auto px-4 pb-3 [scrollbar-width:none] sm:px-0 [&::-webkit-scrollbar]:hidden"
          style={{ maskImage: mask, WebkitMaskImage: mask }}
        >
          {kinds.map((k) => (
            <li key={k.id} className="shrink-0">
              <Link
                href={k.current ? clearHref : k.href}
                aria-current={k.current ? 'page' : undefined}
                aria-label={k.current ? `${k.label}, chosen. Show everything` : k.label}
                className={`kind-tile press inline-flex h-8 items-center gap-1.5 whitespace-nowrap rounded-full px-3 text-[13px] transition-colors ${k.current ? 'bg-[var(--text-primary)] text-canvas' : 'bg-hover text-secondary hover:text-primary'}`}
              >
                <KindGlyph kind={k.id} size={15} />
                {k.label}
                {k.current && <CloseIcon size={13} className="-mr-0.5 opacity-80" />}
              </Link>
            </li>
          ))}
          <li className="shrink-0">
            <Link
              href={routes.comics}
              className="press inline-flex h-8 items-center gap-1.5 whitespace-nowrap rounded-full bg-hover px-3 text-[13px] text-secondary transition-colors hover:text-primary"
            >
              <ComicGlyph size={15} />
              Comics
              <span className="rounded-full bg-[var(--decor-ornament)] px-1.5 py-px text-[10px] font-semibold uppercase tracking-[0.06em] text-[#22221F]">
                Soon
              </span>
            </Link>
          </li>
        </ul>
        {/* arrows for mouse users; touch scrolls the row directly */}
        {edges.start && (
          <button
            type="button"
            tabIndex={-1}
            aria-hidden="true"
            onClick={() => scroll(-1)}
            className="press absolute -left-3 top-0 hidden size-8 place-items-center rounded-full border border-subtle bg-raised text-secondary shadow-sm hover:text-primary [@media(hover:hover)]:sm:grid"
          >
            <ChevronRightIcon size={16} className="rotate-180" />
          </button>
        )}
        {edges.end && (
          <button
            type="button"
            tabIndex={-1}
            aria-hidden="true"
            onClick={() => scroll(1)}
            className="press absolute -right-3 top-0 hidden size-8 place-items-center rounded-full border border-subtle bg-raised text-secondary shadow-sm hover:text-primary [@media(hover:hover)]:sm:grid"
          >
            <ChevronRightIcon size={16} />
          </button>
        )}
      </nav>
    </div>
  )
}

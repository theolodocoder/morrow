'use client'
import { useCallback, useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { ReaderComments } from '@/components/public/reader-comments'
import { CommentIcon } from '@/components/ui/icons'
import { Sheet } from '@/components/ui/sheet'
import { api } from '@/lib/client-api'
import { useReaderPrefs } from './reader-frame'

/**
 * Paragraph comments (P-054), the way serial readers talk: a small count beside any paragraph people have commented
 * on, and a tap on any paragraph offers "Comment". Both open that paragraph's thread in a sheet, quoted at the top.
 * The text itself is untouched; the controls are added beside it. Off until the reader turns them on (Aa, or the
 * switch under the chapter's discussion): the page stays quiet by default, and the discussion shows these comments.
 */
export function ParagraphComments({ publicPath, chapterSlug }: { publicPath: string; chapterSlug: string }) {
  const [counts, setCounts] = useState<Record<string, number>>({})
  const [paras, setParas] = useState<HTMLElement[]>([])
  const [active, setActive] = useState<string | null>(null)
  const [open, setOpen] = useState<string | null>(null)
  const on = useReaderPrefs().prefs.marginComments

  const load = useCallback(async () => {
    const r = await api<{ counts: Record<string, number> }>(
      `/public/reading/${publicPath}/chapters/${chapterSlug}/paragraph-comments`,
    ).catch(() => ({ counts: {} }))
    setCounts(r.counts)
  }, [publicPath, chapterSlug])

  useEffect(() => {
    if (!on) return setParas([])
    void load()
    setParas([...document.querySelectorAll<HTMLElement>('.reading-body p[data-block]')])
  }, [load, on])

  // A tap (or click) on a paragraph's text offers "Comment" beside it; selecting text doesn't count as a tap.
  useEffect(() => {
    if (!on) return setActive(null)
    const tap = (e: MouseEvent) => {
      if (window.getSelection()?.toString()) return
      const target = e.target as HTMLElement
      if (target.closest('a, button')) return
      const p = target.closest<HTMLElement>('.reading-body p[data-block]')
      setActive(p?.dataset.block ?? null)
    }
    document.addEventListener('click', tap)
    return () => document.removeEventListener('click', tap)
  }, [on])

  const quote = open ? (paras.find((p) => p.dataset.block === open)?.textContent?.trim() ?? '') : ''

  return (
    <>
      {paras.map((p) => {
        const id = p.dataset.block!
        const n = counts[id] ?? 0
        if (!n && active !== id) return null
        return createPortal(
          <button
            type="button"
            onClick={() => setOpen(id)}
            aria-label={
              n ? `${n} ${n === 1 ? 'comment' : 'comments'} on this paragraph` : 'Comment on this paragraph'
            }
            className={`para-note press ${n ? 'para-note-count' : 'para-note-add'}`}
          >
            <CommentIcon size={13} />
            {n > 0 && <span>{n}</span>}
          </button>,
          p,
          id,
        )
      })}
      <Sheet
        title="Comments on this paragraph"
        isOpen={open !== null}
        onOpenChange={(o) => !o && setOpen(null)}
      >
        {open && (
          <div className="flex flex-col gap-4">
            <blockquote className="line-clamp-4 border-l-2 border-[var(--action-primary-bg)] pl-3 font-manuscript text-[15px] italic text-secondary">
              {quote}
            </blockquote>
            <ReaderComments
              publicPath={publicPath}
              anchor={{ chapterSlug, blockId: open }}
              onChange={() => void load()}
            />
          </div>
        )}
      </Sheet>
    </>
  )
}

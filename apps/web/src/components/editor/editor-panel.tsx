'use client'
import { useEffect } from 'react'
import { CloseIcon } from '@/components/ui/icons'
import { useSwipeClose } from '@/components/ui/use-swipe-close'

/**
 * A side panel in the editor (comments, versions): beside the manuscript on wide screens, a sheet from the bottom on
 * phones (85% of the screen, the manuscript still peeking above). Escape, the close button or (on phones) a swipe
 * down on the handle dismisses it.
 */
export function EditorPanel({
  label,
  onClose,
  children,
}: {
  label: string
  onClose: () => void
  children: React.ReactNode
}) {
  const swipe = useSwipeClose(onClose)
  useEffect(() => {
    const on = (e: KeyboardEvent) => e.key === 'Escape' && !e.defaultPrevented && onClose()
    window.addEventListener('keydown', on)
    return () => window.removeEventListener('keydown', on)
  }, [onClose])
  return (
    <>
      <button
        type="button"
        aria-label="Hide panel"
        tabIndex={-1}
        onClick={onClose}
        className="sheet-backdrop fixed inset-0 z-30 bg-[rgb(25_26_24/.3)] sm:hidden"
        data-entering
      />
      <aside
        aria-label={label}
        data-swipe-sheet
        className="panel fixed inset-x-0 bottom-0 z-40 flex h-[85dvh] flex-col rounded-t-2xl border border-subtle bg-sidebar shadow-[0_-8px_40px_rgb(34_34_31/.18)] sm:inset-x-auto sm:bottom-0 sm:right-0 sm:top-12 sm:h-auto sm:w-[360px] sm:rounded-none sm:border-y-0 sm:border-r-0 sm:shadow-none lg:relative lg:top-0 lg:z-auto lg:shrink-0"
      >
        {/* the grab handle: drag it down to close (phones) */}
        <div aria-hidden="true" {...swipe} className="shrink-0 pb-2 pt-2 sm:hidden">
          <div className="mx-auto h-1 w-10 rounded-full bg-[var(--border-control)]" />
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Hide panel"
          title="Close"
          className="press absolute right-2 top-2 z-10 grid size-8 place-items-center rounded-full text-secondary hover:bg-hover hover:text-primary sm:top-1.5"
        >
          <CloseIcon size={16} />
        </button>
        <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
      </aside>
    </>
  )
}

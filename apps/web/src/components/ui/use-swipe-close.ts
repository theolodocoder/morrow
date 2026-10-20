'use client'
import { useRef } from 'react'

/**
 * Swipe down to close a bottom sheet (design/product-redesign.md §7). Spread the handlers on the sheet's grab area;
 * the sheet itself (the nearest `[data-swipe-sheet]`) follows the finger, and closes if pulled far or flicked fast,
 * otherwise springs back. Touch and pen only: a mouse keeps the close button and Escape.
 */
export function useSwipeClose(onClose: () => void) {
  const start = useRef<{ y: number; t: number; el: HTMLElement } | null>(null)
  const dy = useRef(0)
  const reduced = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches
  return {
    onPointerDown(e: React.PointerEvent<HTMLElement>) {
      if (e.pointerType === 'mouse') return
      const el = e.currentTarget.closest<HTMLElement>('[data-swipe-sheet], .sheet')
      if (!el) return
      start.current = { y: e.clientY, t: performance.now(), el }
      dy.current = 0
      el.style.transition = 'none'
      try {
        e.currentTarget.setPointerCapture(e.pointerId)
      } catch {
        // a pointer the browser no longer tracks: moves still arrive while the finger is on the handle
      }
    },
    onPointerMove(e: React.PointerEvent<HTMLElement>) {
      const s = start.current
      if (!s) return
      // follows the finger down; resists going up
      dy.current = Math.max(0, e.clientY - s.y)
      s.el.style.transform = `translateY(${dy.current}px)`
    },
    onPointerUp() {
      const s = start.current
      if (!s) return
      start.current = null
      const velocity = dy.current / Math.max(1, performance.now() - s.t)
      const close = dy.current > 120 || (dy.current > 40 && velocity > 0.6)
      s.el.style.transition = reduced() ? 'none' : 'transform 200ms cubic-bezier(0.2, 0.8, 0.2, 1)'
      s.el.style.transform = close ? 'translateY(100%)' : ''
      // already off-screen: skip the exit animation, which would start from the top again
      if (close) s.el.dataset.swiped = ''
      if (close) window.setTimeout(onClose, reduced() ? 0 : 160)
    },
    onPointerCancel() {
      const s = start.current
      start.current = null
      if (s) s.el.style.transform = ''
    },
    style: { touchAction: 'none' } as React.CSSProperties,
  }
}

'use client'
import { useEffect, useState } from 'react'

/**
 * Toasts: a short, polite confirmation ("Link copied", "Saved to your reading list"), bottom centre, gone in 3s.
 * Announced to screen readers through one live region. Call `toast(text)` from anywhere in the browser.
 */
const EVENT = 'morrow:toast'
export function toast(text: string) {
  window.dispatchEvent(new CustomEvent(EVENT, { detail: text }))
}

export function Toaster() {
  const [items, setItems] = useState<{ id: number; text: string }[]>([])
  useEffect(() => {
    let n = 0
    const on = (e: Event) => {
      const id = ++n
      setItems((xs) => [...xs.slice(-2), { id, text: (e as CustomEvent<string>).detail }])
      setTimeout(() => setItems((xs) => xs.filter((x) => x.id !== id)), 3000)
    }
    window.addEventListener(EVENT, on)
    return () => window.removeEventListener(EVENT, on)
  }, [])
  return (
    <div
      role="status"
      aria-live="polite"
      className="pointer-events-none fixed inset-x-0 bottom-[calc(5rem+env(safe-area-inset-bottom))] z-[70] flex flex-col items-center gap-2 px-4 md:bottom-6"
    >
      {items.map((t) => (
        <p
          key={t.id}
          data-entering
          className="toast rounded-full bg-primary px-4 py-2 font-ui text-[13px] text-canvas shadow-[0_6px_16px_rgb(34_34_31/.2)]"
        >
          {t.text}
        </p>
      ))}
    </div>
  )
}

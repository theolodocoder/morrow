'use client'
import { useRouter } from 'next/navigation'
import { useEffect, useRef, useState, useTransition } from 'react'

const THRESHOLD = 72

/**
 * Pull to refresh on Home (design/product-redesign.md §7), for touch screens: pull down from the top and the brand's
 * sun rises with your finger; let go past the line and the feed reloads while it turns. Everything else (mouse,
 * keyboard) reloads the usual way. Under reduced motion the sun appears without turning.
 */
export function PullToRefresh() {
  const router = useRouter()
  const [pull, setPull] = useState(0)
  const [pending, start] = useTransition()
  const from = useRef<number | null>(null)
  const pullRef = useRef(0)

  useEffect(() => {
    const down = (e: TouchEvent) => {
      from.current = window.scrollY <= 0 && e.touches.length === 1 ? e.touches[0]!.clientY : null
    }
    const move = (e: TouchEvent) => {
      if (from.current === null) return
      const d = e.touches[0]!.clientY - from.current
      if (d <= 0 || window.scrollY > 0) {
        pullRef.current = 0
        setPull(0)
        return
      }
      // a little resistance, like a real page
      pullRef.current = Math.min(120, d * 0.5)
      setPull(pullRef.current)
    }
    const up = () => {
      if (from.current === null) return
      from.current = null
      if (pullRef.current >= THRESHOLD) start(() => router.refresh())
      pullRef.current = 0
      setPull(0)
    }
    // ours replaces the browser's own pull-to-reload here (which would reload the whole page as well)
    const root = document.documentElement
    const before = root.style.overscrollBehaviorY
    root.style.overscrollBehaviorY = 'contain'
    window.addEventListener('touchstart', down, { passive: true })
    window.addEventListener('touchmove', move, { passive: true })
    window.addEventListener('touchend', up)
    window.addEventListener('touchcancel', up)
    return () => {
      root.style.overscrollBehaviorY = before
      window.removeEventListener('touchstart', down)
      window.removeEventListener('touchmove', move)
      window.removeEventListener('touchend', up)
      window.removeEventListener('touchcancel', up)
    }
  }, [router])

  const shown = pending ? THRESHOLD : pull
  const ready = pull >= THRESHOLD
  return (
    <>
      <div
        aria-hidden="true"
        className="pointer-events-none fixed inset-x-0 top-0 z-40 flex justify-center"
        style={{
          transform: `translateY(${shown - 44}px)`,
          transition: pull ? 'none' : 'transform 220ms cubic-bezier(0.2, 0.8, 0.2, 1)',
        }}
      >
        <span className="grid size-10 place-items-center rounded-full border border-subtle bg-raised shadow-md">
          <svg
            viewBox="0 0 24 24"
            width="22"
            height="22"
            className={`text-accent ${pending ? 'ptr-spin' : ''}`}
            style={pending ? undefined : { transform: `rotate(${pull * 3}deg)` }}
          >
            <circle
              cx="12"
              cy="12"
              r={ready || pending ? 5 : 3 + (pull / THRESHOLD) * 2}
              fill="currentColor"
            />
            {Array.from({ length: 8 }, (_, i) => {
              const on = pending || i < Math.round((pull / THRESHOLD) * 8)
              const a = (i * Math.PI) / 4
              return (
                <path
                  key={i}
                  d={`M${12 + Math.cos(a) * 8} ${12 + Math.sin(a) * 8}L${12 + Math.cos(a) * 10.5} ${12 + Math.sin(a) * 10.5}`}
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                  opacity={on ? 1 : 0.15}
                />
              )
            })}
          </svg>
        </span>
      </div>
      <p role="status" className="sr-only">
        {pending ? 'Refreshing the feed…' : ''}
      </p>
    </>
  )
}

'use client'
import { useEffect, useState } from 'react'

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

/**
 * A serial's schedule (P-057): "New chapter every Friday", with a countdown in the reader's own week. Following the
 * work (⋯ → Follow this work) is how readers hear the moment it's out.
 */
export function ReleaseCountdown({ day }: { day: number }) {
  const [inDays, setInDays] = useState<number | null>(null)
  useEffect(() => setInDays((day - new Date().getDay() + 7) % 7), [day])
  return (
    <p className="flex flex-wrap items-center gap-2 text-[13px] text-secondary">
      <span className="inline-flex items-center gap-1.5 rounded-full bg-selected px-2.5 py-1 font-medium text-primary">
        <svg
          width="14"
          height="14"
          viewBox="0 0 20 20"
          aria-hidden="true"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
        >
          <rect x="3.5" y="4.5" width="13" height="12" rx="1.5" />
          <path d="M3.5 8.5h13M7 3v3M13 3v3" strokeLinecap="round" />
        </svg>
        New chapter every {DAYS[day]}
      </span>
      {inDays !== null && (
        <span className="text-tertiary">
          {inDays === 0 ? 'Out today' : inDays === 1 ? 'Next one tomorrow' : `Next one in ${inDays} days`}
        </span>
      )}
    </p>
  )
}

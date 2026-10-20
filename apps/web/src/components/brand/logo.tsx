import { WORDMARK } from './wordmark-path'

/**
 * The Morrow mark: a sun rising from a line of writing, with the line beneath forking into another
 * direction (tomorrow + alternate paths). Colours come from tokens, so it follows light and dark themes.
 * Provisional until the name is cleared (Q-012).
 */
export function LogoMark({ size = 28, className }: { size?: number; className?: string }) {
  return (
    <svg viewBox="9 17 46 38" width={size * (46 / 38)} height={size} aria-hidden="true" className={className}>
      <path d="M18 33a14 14 0 0 1 28 0z" fill="var(--action-primary-bg)" />
      <path d="M9 33h46" stroke="var(--text-primary)" strokeWidth="3.6" strokeLinecap="round" />
      <path
        d="M9 44h17.5c6.5 0 9.5 9 21.5 9H52M26.5 44H55"
        fill="none"
        stroke="var(--text-primary)"
        strokeOpacity=".45"
        strokeWidth="3.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

/** Mark + wordmark lockup. The horizon of the mark sits on the word's baseline. */
export function Logo({
  height = 28,
  className,
  label = 'Morrow',
}: {
  height?: number
  className?: string
  label?: string
}) {
  const markScale = (WORDMARK.height * 1.5) / 64
  const gap = WORDMARK.height * 0.38
  const markLeft = -9 * markScale + 2
  const wordTop = 33 * markScale - WORDMARK.height
  const top = Math.min(0, wordTop, 19 * markScale)
  const w = 55 * markScale + markLeft + gap + WORDMARK.width
  const h = 56 * markScale - top
  return (
    <svg
      viewBox={`0 ${top} ${w} ${h}`}
      height={height}
      width={(height * w) / h}
      role="img"
      aria-label={label}
      className={className}
    >
      <g transform={`translate(${markLeft} 0) scale(${markScale})`}>
        <path d="M18 33a14 14 0 0 1 28 0z" fill="var(--action-primary-bg)" />
        <path d="M9 33h46" stroke="var(--text-primary)" strokeWidth="3.6" strokeLinecap="round" />
        <path
          d="M9 44h17.5c6.5 0 9.5 9 21.5 9H52M26.5 44H55"
          fill="none"
          stroke="var(--text-primary)"
          strokeOpacity=".45"
          strokeWidth="3.6"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </g>
      <path
        transform={`translate(${55 * markScale + markLeft + gap} ${wordTop})`}
        d={WORDMARK.d}
        fill="var(--text-primary)"
      />
    </svg>
  )
}

/**
 * The Comics hero: a comic page drawn in the brand's ink, with panels that settle in and speech bubbles that pop, one
 * after another. Decorative; still under reduced motion.
 */
export function ComicsArt({ className = '' }: { className?: string }) {
  const INK = 'var(--text-primary)'
  const PAPER = 'var(--bg-canvas)'
  const CLAY = 'var(--action-primary-bg)'
  const GOLD = 'var(--decor-ornament)'
  return (
    <svg viewBox="0 0 360 300" className={className} aria-hidden="true" focusable="false">
      {/* the page */}
      <rect x="40" y="16" width="280" height="268" rx="6" fill={PAPER} stroke={INK} strokeWidth="2.5" />
      {/* panel 1: a sun over the sea */}
      <g className="comic-panel" style={{ animationDelay: '0ms' }}>
        <rect x="56" y="32" width="152" height="112" rx="3" fill={PAPER} stroke={INK} strokeWidth="2" />
        <circle cx="160" cy="112" r="22" fill={CLAY} />
        <path d="M56 120h152" stroke={INK} strokeWidth="1.5" />
        <path
          d="M66 132c10-6 18-6 28 0s18 6 28 0 18-6 28 0 18 6 28 0"
          stroke={INK}
          strokeWidth="1.5"
          fill="none"
        />
      </g>
      {/* panel 2: two figures */}
      <g className="comic-panel" style={{ animationDelay: '140ms' }}>
        <rect x="216" y="32" width="88" height="112" rx="3" fill={PAPER} stroke={INK} strokeWidth="2" />
        <circle cx="244" cy="96" r="9" fill="none" stroke={INK} strokeWidth="2" />
        <path d="M244 105v24M234 116h20" stroke={INK} strokeWidth="2" strokeLinecap="round" />
        <circle cx="278" cy="100" r="8" fill={GOLD} stroke={INK} strokeWidth="2" />
        <path d="M278 108v21M269 118h18" stroke={INK} strokeWidth="2" strokeLinecap="round" />
      </g>
      {/* panel 3: wide, a forking path (the logo's line) */}
      <g className="comic-panel" style={{ animationDelay: '280ms' }}>
        <rect x="56" y="152" width="248" height="116" rx="3" fill={PAPER} stroke={INK} strokeWidth="2" />
        <path
          d="M72 240h70c26 0 30-40 62-40h84"
          stroke={CLAY}
          strokeWidth="3"
          fill="none"
          strokeLinecap="round"
        />
        <path
          d="M142 240c26 0 30 14 62 14h84"
          stroke={INK}
          strokeWidth="2"
          fill="none"
          strokeLinecap="round"
          opacity=".5"
        />
      </g>
      {/* speech bubbles */}
      <g className="comic-bubble" style={{ animationDelay: '520ms', transformOrigin: '110px 60px' }}>
        <path
          d="M74 44h84a10 10 0 0 1 10 10v14a10 10 0 0 1-10 10h-52l-12 12v-12h-20a10 10 0 0 1-10-10V54a10 10 0 0 1 10-10Z"
          fill={PAPER}
          stroke={INK}
          strokeWidth="2"
        />
        <path d="M82 58h60M82 66h38" stroke={INK} strokeWidth="2" strokeLinecap="round" opacity=".55" />
      </g>
      <g className="comic-bubble" style={{ animationDelay: '720ms', transformOrigin: '262px 62px' }}>
        <ellipse cx="262" cy="58" rx="34" ry="16" fill={PAPER} stroke={INK} strokeWidth="2" />
        <path d="M270 72l6 12 2-13" fill={PAPER} stroke={INK} strokeWidth="2" strokeLinejoin="round" />
        <path d="M246 58h32" stroke={INK} strokeWidth="2" strokeLinecap="round" opacity=".55" />
      </g>
      <g className="comic-bubble" style={{ animationDelay: '920ms', transformOrigin: '230px 180px' }}>
        <path
          d="m212 170 8 6 10-10 4 12 12-4-6 11 10 6-12 3 3 12-11-5-6 10-4-11-11 4 4-11-10-6 11-4-2-13Z"
          fill={GOLD}
          stroke={INK}
          strokeWidth="1.5"
          strokeLinejoin="round"
        />
      </g>
    </svg>
  )
}

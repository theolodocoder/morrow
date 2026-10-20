/**
 * Spot illustrations for empty and error states, drawn in the icon set's monoline ink with the brand's clay and gold
 * (design system §1: illustration only where it means something). Each has one small living detail, a spark that
 * drifts or a line that writes itself, which stays still under reduced motion. Decorative: the words beside them
 * carry the meaning.
 */
export type Spot =
  'page' | 'inbox' | 'shelf' | 'together' | 'compass' | 'lost' | 'badge' | 'chart' | 'shield' | 'sprout'

const INK = 'var(--text-primary)'
const SOFT = 'var(--text-tertiary)'
const CLAY = 'var(--action-primary-bg)'
const GOLD = 'var(--decor-ornament)'
const PAPER = 'var(--bg-canvas)'

function Spark({ x, y, delay = 0 }: { x: number; y: number; delay?: number }) {
  return (
    <path
      className="spot-spark"
      style={{ animationDelay: `${delay}ms`, transformOrigin: `${x}px ${y}px` }}
      d={`M${x} ${y - 6}c.6 3.2 1.8 4.6 5 5.2-3.2.6-4.4 2-5 5.2-.6-3.2-1.8-4.6-5-5.2 3.2-.6 4.4-2 5-5.2Z`}
      fill={GOLD}
    />
  )
}

const ART: Record<Spot, React.ReactNode> = {
  // a blank page with a pen, the first line being written
  page: (
    <>
      <rect x="38" y="20" width="76" height="96" rx="6" fill={PAPER} stroke={INK} strokeWidth="2" />
      <path d="M52 44h40M52 56h48M52 68h30" stroke={SOFT} strokeWidth="2" strokeLinecap="round" />
      <path className="spot-write" d="M52 80h22" stroke={CLAY} strokeWidth="2.5" strokeLinecap="round" />
      <path
        d="m110 70 14-14 8 8-14 14-10 2 2-10Z"
        fill={PAPER}
        stroke={INK}
        strokeWidth="2"
        strokeLinejoin="round"
      />
      <Spark x={128} y={36} />
    </>
  ),
  // letters waiting in a quiet tray
  inbox: (
    <>
      <path
        d="M30 76 46 40h68l16 36v28a6 6 0 0 1-6 6H36a6 6 0 0 1-6-6V76Z"
        fill={PAPER}
        stroke={INK}
        strokeWidth="2"
        strokeLinejoin="round"
      />
      <path d="M30 76h28l6 10h32l6-10h28" stroke={INK} strokeWidth="2" strokeLinejoin="round" fill="none" />
      <path d="M58 56h44M64 66h32" stroke={SOFT} strokeWidth="2" strokeLinecap="round" />
      <circle className="spot-bob" cx="112" cy="34" r="7" fill={CLAY} />
      <Spark x={40} y={30} delay={600} />
    </>
  ),
  // a shelf with a gap waiting for a book
  shelf: (
    <>
      <path d="M24 108h112" stroke={INK} strokeWidth="2.5" strokeLinecap="round" />
      <rect x="34" y="54" width="14" height="54" rx="2" fill={CLAY} />
      <rect x="50" y="62" width="12" height="46" rx="2" fill={PAPER} stroke={INK} strokeWidth="2" />
      <rect x="64" y="48" width="14" height="60" rx="2" fill={PAPER} stroke={INK} strokeWidth="2" />
      <rect x="80" y="70" width="10" height="38" rx="2" fill={GOLD} opacity=".7" />
      <rect
        className="spot-bob"
        x="104"
        y="58"
        width="16"
        height="50"
        rx="2"
        fill="none"
        stroke={SOFT}
        strokeWidth="2"
        strokeDasharray="4 4"
      />
      <Spark x={112} y={40} />
    </>
  ),
  // two writers, one line forking between them (the logo's idea)
  together: (
    <>
      <circle cx="46" cy="52" r="14" fill={PAPER} stroke={INK} strokeWidth="2" />
      <circle cx="114" cy="52" r="14" fill={PAPER} stroke={INK} strokeWidth="2" />
      <path
        d="M26 96c4-14 12-20 20-20s16 6 20 20M94 96c4-14 12-20 20-20s16 6 20 20"
        stroke={INK}
        strokeWidth="2"
        fill="none"
        strokeLinecap="round"
      />
      <path
        className="spot-write"
        d="M60 104h18c8 0 10-12 18-12h10"
        stroke={CLAY}
        strokeWidth="2.5"
        fill="none"
        strokeLinecap="round"
      />
      <path d="M78 104h28" stroke={SOFT} strokeWidth="2.5" strokeLinecap="round" />
      <Spark x={80} y={36} />
    </>
  ),
  // a compass among scattered pages
  compass: (
    <>
      <circle cx="80" cy="66" r="36" fill={PAPER} stroke={INK} strokeWidth="2" />
      <circle cx="80" cy="66" r="28" fill="none" stroke={SOFT} strokeWidth="1.5" strokeDasharray="2 5" />
      <g className="spot-turn" style={{ transformOrigin: '80px 66px' }}>
        <path
          d="m80 40 8 26-8 26-8-26 8-26Z"
          fill={PAPER}
          stroke={INK}
          strokeWidth="2"
          strokeLinejoin="round"
        />
        <path d="m80 40 8 26H72l8-26Z" fill={CLAY} />
      </g>
      <Spark x={126} y={30} />
      <Spark x={30} y={104} delay={900} />
    </>
  ),
  // a page drifting off the edge
  lost: (
    <>
      <path d="M24 112h112" stroke={SOFT} strokeWidth="2" strokeLinecap="round" strokeDasharray="1 7" />
      <g className="spot-bob">
        <path
          d="M54 30h44l14 14v52a4 4 0 0 1-4 4H54a4 4 0 0 1-4-4V34a4 4 0 0 1 4-4Z"
          fill={PAPER}
          stroke={INK}
          strokeWidth="2"
          strokeLinejoin="round"
          transform="rotate(-8 80 64)"
        />
        <path
          d="M66 58h28M66 70h20"
          stroke={SOFT}
          strokeWidth="2"
          strokeLinecap="round"
          transform="rotate(-8 80 64)"
        />
        <circle cx="80" cy="84" r="3" fill={CLAY} transform="rotate(-8 80 64)" />
      </g>
      <Spark x={124} y={34} />
    </>
  ),
  // a medal on a ribbon
  badge: (
    <>
      <path
        d="m64 84-8 32 16-8 8 12 6-30M96 84l8 32-16-8-8 12-6-30"
        fill={PAPER}
        stroke={INK}
        strokeWidth="2"
        strokeLinejoin="round"
      />
      <circle cx="80" cy="60" r="28" fill={PAPER} stroke={GOLD} strokeWidth="3" />
      <circle cx="80" cy="60" r="20" fill="none" stroke={INK} strokeWidth="1.5" />
      <path d="M80 48c1 6 4 9 10 10-6 1-9 4-10 10-1-6-4-9-10-10 6-1 9-4 10-10Z" fill={CLAY} />
      <Spark x={122} y={30} />
    </>
  ),
  // a line rising over bars
  chart: (
    <>
      <path d="M28 110h108" stroke={INK} strokeWidth="2" strokeLinecap="round" />
      <rect x="40" y="84" width="14" height="26" rx="2" fill={PAPER} stroke={INK} strokeWidth="2" />
      <rect x="64" y="70" width="14" height="40" rx="2" fill={PAPER} stroke={INK} strokeWidth="2" />
      <rect x="88" y="78" width="14" height="32" rx="2" fill={PAPER} stroke={INK} strokeWidth="2" />
      <rect x="112" y="56" width="14" height="54" rx="2" fill={CLAY} />
      <path
        className="spot-write"
        d="M38 70 62 52l24 10 30-30"
        stroke={GOLD}
        strokeWidth="2.5"
        fill="none"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <Spark x={122} y={26} />
    </>
  ),
  // a shield over an open page: your writing, kept safe
  shield: (
    <>
      <rect x="34" y="34" width="56" height="72" rx="5" fill={PAPER} stroke={INK} strokeWidth="2" />
      <path d="M44 52h36M44 62h30M44 72h34" stroke={SOFT} strokeWidth="2" strokeLinecap="round" />
      <path
        className="spot-bob"
        d="M104 40c10 6 18 7 26 6v26c0 18-12 30-26 36-14-6-26-18-26-36V46c8 1 16 0 26-6Z"
        fill={PAPER}
        stroke={INK}
        strokeWidth="2"
        strokeLinejoin="round"
      />
      <path
        className="spot-write"
        d="m93 74 8 8 15-17"
        stroke={CLAY}
        strokeWidth="3"
        fill="none"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <Spark x={136} y={28} />
    </>
  ),
  // a seed sprouting from the page: free to start, room to grow
  sprout: (
    <>
      <path d="M30 108h100" stroke={INK} strokeWidth="2" strokeLinecap="round" />
      <path d="M52 108c0-12 12-18 28-18s28 6 28 18" fill={PAPER} stroke={INK} strokeWidth="2" />
      <path className="spot-write" d="M80 92V50" stroke={INK} strokeWidth="2.5" strokeLinecap="round" />
      <g className="spot-bob" style={{ transformOrigin: '80px 60px' }}>
        <path d="M80 62c-4-14-16-20-30-18 2 14 14 20 30 18Z" fill={GOLD} stroke={INK} strokeWidth="2" />
        <path d="M80 54c4-14 16-20 30-18-2 14-14 20-30 18Z" fill={CLAY} stroke={INK} strokeWidth="2" />
      </g>
      <Spark x={124} y={30} />
      <Spark x={38} y={46} delay={900} />
    </>
  ),
}

export function SpotArt({ spot, size = 140 }: { spot: Spot; size?: number }) {
  return (
    <svg viewBox="0 0 160 130" width={size} height={(size * 130) / 160} aria-hidden="true" focusable="false">
      {ART[spot]}
    </svg>
  )
}

/** An empty state: a spot, a line that says what's here, and the one thing to do next. */
export function EmptyState({
  spot,
  title,
  body,
  action,
}: {
  spot: Spot
  title: string
  body?: React.ReactNode
  action?: React.ReactNode
}) {
  return (
    <div className="flex flex-col items-center px-6 py-14 text-center">
      <SpotArt spot={spot} />
      <p className="mt-4 font-display text-[22px] leading-tight text-primary">{title}</p>
      {body && <p className="mt-1.5 max-w-[42ch] text-[14px] text-secondary">{body}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  )
}

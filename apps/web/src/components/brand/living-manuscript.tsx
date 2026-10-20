/**
 * "The Living Manuscript" — the auth-screen illustration (design system §7, research: auth-screen-references).
 * A page stands before a rising sun; its last line runs off the page and forks into new pages.
 *
 * Two states tell the same story at different moments:
 * - `beginning` (sign-up): the sun just at the horizon, one line on a blank page, the branches only possible (dashed).
 * - `continuing` (sign-in): the sun risen, the page full, both branches written, a collaborator at work.
 *
 * Monoline ink with flat palette fills, all from tokens so it follows the theme. Decorative: hidden from AT.
 */
export function LivingManuscript({
  state = 'continuing',
  className,
}: {
  state?: 'beginning' | 'continuing'
  className?: string
}) {
  const begun = state === 'continuing'
  const ink = 'var(--text-primary)'
  const faint = 'var(--text-tertiary)'
  const paper = 'var(--bg-canvas)'
  const clay = 'var(--action-primary-bg)'
  const moss = 'var(--text-success)'
  const gold = 'var(--decor-ornament)'
  const line = { stroke: ink, strokeWidth: 1.6, strokeLinecap: 'round' as const, fill: 'none' }
  const text = { stroke: faint, strokeWidth: 3, strokeLinecap: 'round' as const, opacity: 0.55 }
  // Fade only the outlines of not-yet-written pages: their paper must stay opaque over the lines behind.
  const possible = begun ? {} : { strokeDasharray: '2 7', strokeOpacity: 0.55 }
  const HORIZON = 410
  // The sun is a full disc clipped at the horizon; its centre decides how far it has risen.
  const sunCy = begun ? HORIZON - 12 : HORIZON + 78

  return (
    <svg viewBox="0 0 640 640" className={className} aria-hidden="true" focusable="false">
      <defs>
        <clipPath id={`above-horizon-${state}`}>
          <rect x="0" y="0" width="640" height={HORIZON} />
        </clipPath>
      </defs>

      {/* the sun: tomorrow, rising */}
      <circle
        cx="246"
        cy={sunCy}
        r="150"
        fill={clay}
        opacity="0.92"
        clipPath={`url(#above-horizon-${state})`}
      />
      <path d={`M40 ${HORIZON}h560`} {...line} strokeWidth={1.2} opacity="0.5" />
      {begun && (
        <g {...line} strokeWidth={1.2} opacity="0.35">
          <path d="M246 216v-28M156 250l-18-20M336 250l18-20M112 330l-26-8M380 330l26-8" />
        </g>
      )}

      {/* the main manuscript page, slightly turned */}
      <g transform="rotate(-4 250 400)">
        <rect x="150" y="270" width="210" height="270" rx="3" {...line} fill={paper} />
        <g {...text}>
          {begun ? (
            <>
              <path d="M178 310h120" style={{ stroke: ink, opacity: 0.8 }} strokeWidth={4} />
              <path d="M178 344h154M178 364h146M178 384h154M178 404h118" />
              <path d="M196 434h136M178 454h150M178 474h96" />
            </>
          ) : (
            <>
              {/* page one: a title and a single first line, the cursor waiting */}
              <path d="M178 310h96" style={{ stroke: ink, opacity: 0.8 }} strokeWidth={4} />
              <path d="M196 344h92" />
            </>
          )}
        </g>
        {!begun && <path d="M294 336v16" stroke={clay} strokeWidth="2" strokeLinecap="round" />}
        <text
          x="255"
          y="510"
          textAnchor="middle"
          fontSize="16"
          fill={gold}
          fontFamily="var(--font-manuscript-family)"
          opacity={begun ? 1 : 0.6}
        >
          ⁂
        </text>
      </g>

      {/* the line runs off the page and forks: two directions, written or yet to be */}
      <g {...possible}>
        <path
          d={begun ? 'M352 452c40-2 62-12 86-40s50-92 104-96' : 'M300 350c60 0 90-6 128-30s56-60 114-66'}
          {...line}
        />
        <path
          d={begun ? 'M352 452c46 2 70 10 96 30s48 52 96 54' : 'M300 350c70 0 100 40 140 90s60 46 104 46'}
          {...line}
        />
      </g>
      <circle cx={begun ? 352 : 300} cy={begun ? 452 : 350} r="3.5" fill={ink} />

      {/* branch page one (moss) */}
      <g transform="rotate(5 520 250)" {...possible}>
        <rect x="452" y="168" width="124" height="158" rx="3" {...line} fill={paper} />
        {begun && (
          <>
            <rect x="452" y="168" width="124" height="10" fill={moss} opacity="0.85" />
            <g {...text} strokeWidth={2.4}>
              <path d="M470 206h78M470 222h88M470 238h70M470 254h84M470 276h56" />
            </g>
            {/* a collaborator at work: caret and name flag */}
            <path d="M530 268v16" stroke={clay} strokeWidth="2" strokeLinecap="round" />
            <rect x="530" y="259" width="30" height="10" rx="2" fill={clay} />
          </>
        )}
      </g>

      {/* branch page two (gold) */}
      <g transform="rotate(-3 520 520)" {...possible}>
        <rect x="456" y="456" width="120" height="150" rx="3" {...line} fill={paper} />
        {begun && (
          <>
            <rect x="456" y="456" width="120" height="10" fill={gold} opacity="0.9" />
            <g {...text} strokeWidth={2.4}>
              <path d="M474 494h76M474 510h84M474 526h52" />
            </g>
          </>
        )}
      </g>

      <g fill={gold}>
        <circle cx="96" cy="150" r="3" />
        <circle cx="580" cy="110" r="2.5" />
        <circle cx="72" cy="560" r="2.5" />
      </g>
    </svg>
  )
}

/**
 * Badge art (FR-025): a medallion with a glyph per badge, in the icon set's monoline style. Locked badges are drawn
 * in outline only, so the goal is visible without looking earned. Decorative: the badge name is the label.
 */
const GLYPHS: Record<string, React.ReactNode> = {
  // an open book
  first_chapter: (
    <>
      <path d="M12 16.5c-1.8-1.2-3.6-1.6-6-1.5V7.5c2.4-.1 4.2.3 6 1.5 1.8-1.2 3.6-1.6 6-1.5V15c-2.4-.1-4.2.3-6 1.5Z" />
      <path d="M12 9v7.5" />
    </>
  ),
  // a finished line with a tick
  the_finisher: (
    <>
      <path d="M6 16.5h12" />
      <path d="m8.5 11 2.5 2.5 5-5.5" />
    </>
  ),
  // a spark: an idea that landed
  the_muse: (
    <path d="M12 5.5c.4 2.8 1.6 4.8 4.8 5.7-3.2.9-4.4 2.9-4.8 5.7-.4-2.8-1.6-4.8-4.8-5.7 3.2-.9 4.4-2.9 4.8-5.7Z" />
  ),
  // a pen nib
  the_editor: (
    <>
      <path d="m12 5.5 4 5-4 7-4-7 4-5Z" />
      <path d="M12 12v5.5M12 10.75v.01" />
    </>
  ),
  // a bridge between two banks
  bridge_builder: (
    <>
      <path d="M5.5 15.5h13" />
      <path d="M7 15.5c1-3.5 2.8-5.5 5-5.5s4 2 5 5.5" />
      <path d="M10 15.5v-3.25M14 15.5v-3.25" />
    </>
  ),
  // a forking line, as in the logo
  plot_twister: (
    <>
      <path d="M6 15h3c2 0 2.8-1.2 3.6-2.8S14 9 16 9h2" />
      <path d="M9 15c2 0 2.8.4 3.6 1.2.8.8 1.6 1.3 3.4 1.3h2" />
    </>
  ),
  // a week's calendar with a mark
  reliable_one: (
    <>
      <rect x="6.5" y="7.5" width="11" height="10" rx="1.5" />
      <path d="M6.5 10.5h11M9.5 6v2.5M14.5 6v2.5M10 14l1.5 1.5 3-3" />
    </>
  ),
  // a sun over a line: showing up, day after day
  steady_hand: (
    <>
      <circle cx="12" cy="12" r="2.6" />
      <path d="M12 6.5v1.6M12 15.9v1.6M6.5 12h1.6M15.9 12h1.6M8.1 8.1l1.1 1.1M14.8 14.8l1.1 1.1M8.1 15.9l1.1-1.1M14.8 9.2l1.1-1.1" />
    </>
  ),
  // a speech mark answering a question
  prompt_answerer: (
    <>
      <path d="M7 8.5h10v6H11l-3 2.5v-2.5H7v-6Z" />
      <path d="M10 11.5h4" />
    </>
  ),
  // a heart
  found_readers: (
    <path d="M12 17s-5-3-5-6.8A2.8 2.8 0 0 1 9.8 7.3c1 0 1.7.5 2.2 1.3.5-.8 1.2-1.3 2.2-1.3A2.8 2.8 0 0 1 17 10.2C17 14 12 17 12 17Z" />
  ),
}

export function BadgeMedal({
  code,
  earned = true,
  size = 48,
}: {
  code: string
  earned?: boolean
  size?: number
}) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      aria-hidden="true"
      focusable="false"
      fill="none"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <circle
        cx="12"
        cy="12"
        r="10.75"
        fill={earned ? 'var(--bg-selected)' : 'none'}
        stroke={earned ? 'var(--decor-ornament)' : 'var(--border-control)'}
        strokeWidth="1.25"
        strokeDasharray={earned ? undefined : '2 2'}
      />
      <circle
        cx="12"
        cy="12"
        r="8.5"
        stroke={earned ? 'var(--decor-ornament)' : 'transparent'}
        strokeWidth=".6"
      />
      <g stroke={earned ? 'var(--text-primary)' : 'var(--text-tertiary)'} strokeWidth="1.25">
        {GLYPHS[code] ?? <circle cx="12" cy="12" r="3" />}
      </g>
    </svg>
  )
}

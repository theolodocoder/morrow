import type { CoverConfig } from '@morrow/contracts'

/**
 * Covers (design system §7, P-051): every work has a book-like cover, drawn rather than uploaded. The writer picks a
 * palette, a motif and a title layout in Work settings; until then the API sends one derived from the work's id, so
 * it's the same on every page. The motifs echo the brand (a rising sun, a forking line, the arcs of a page turning,
 * the swell of a tide). Thumbnails show the motif and the title's first letter: words at that size would only be
 * noise. Self-contained colours (it's an image), so it reads the same in light and dark.
 */
export const COVER_PALETTES = [
  { ground: '#BD5438', ink: '#FBF8F1', motif: '#F1C9A8' }, // clay
  { ground: '#22221F', ink: '#FBF8F1', motif: '#C9A227' }, // ink and gold
  { ground: '#546648', ink: '#F4F1E6', motif: '#C9DCCB' }, // moss
  { ground: '#2F5966', ink: '#F4F1E6', motif: '#BFD9D6' }, // tide
  { ground: '#7A4A68', ink: '#FBF4F7', motif: '#E6CFE0' }, // plum
  { ground: '#E8D9C5', ink: '#22221F', motif: '#BD5438' }, // parchment
  { ground: '#F1E2A9', ink: '#22221F', motif: '#546648' }, // butter
  { ground: '#C7D3E6', ink: '#22221F', motif: '#2F5966' }, // mist
] as const
export const MOTIF_NAMES = ['Sun', 'Fork', 'Pages', 'Tide', 'Plain'] as const
export const LAYOUT_NAMES: Record<CoverConfig['layout'], string> = {
  classic: 'Classic',
  centered: 'Centred',
  band: 'Band',
}

/** Break a title into at most three lines of about `width` characters. */
function lines(title: string, width = 11) {
  const out: string[] = []
  for (const word of title.trim().split(/\s+/)) {
    const last = out.at(-1)
    if (last !== undefined && `${last} ${word}`.length <= width) out[out.length - 1] = `${last} ${word}`
    else out.push(word.length > width + 3 ? `${word.slice(0, width + 2)}…` : word)
  }
  return out.length > 3 ? [...out.slice(0, 2), `${out[2]}…`] : out
}

export function Motif({ kind, color }: { kind: number; color: string }) {
  switch (kind) {
    case 0: // a sun rising over the horizon
      return (
        <g>
          <path d="M30 150a30 30 0 0 1 60 0Z" fill={color} />
          <path d="M14 150h92" stroke={color} strokeWidth="2.5" strokeLinecap="round" />
          <path
            d="M60 108v-8M36 116l-5-5M84 116l5-5"
            stroke={color}
            strokeWidth="2.5"
            strokeLinecap="round"
          />
        </g>
      )
    case 1: // the line that forks (the logo)
      return (
        <g fill="none" stroke={color} strokeWidth="3" strokeLinecap="round">
          <path d="M12 140h40c14 0 18-22 34-22h22" />
          <path d="M52 140c14 0 18 18 34 18h22" opacity=".6" />
          <circle cx="108" cy="118" r="3.5" fill={color} />
        </g>
      )
    case 2: // arcs, like pages turning
      return (
        <g fill="none" stroke={color} strokeWidth="2.5">
          <path d="M20 168a40 40 0 0 1 80 0" />
          <path d="M32 168a28 28 0 0 1 56 0" opacity=".75" />
          <path d="M44 168a16 16 0 0 1 32 0" opacity=".5" />
        </g>
      )
    case 3: // a tide
      return (
        <g fill="none" stroke={color} strokeWidth="2.5" strokeLinecap="round">
          <path d="M8 130c12-8 22-8 34 0s22 8 34 0 22-8 34 0" />
          <path d="M8 146c12-8 22-8 34 0s22 8 34 0 22-8 34 0" opacity=".7" />
          <path d="M8 162c12-8 22-8 34 0s22 8 34 0 22-8 34 0" opacity=".45" />
        </g>
      )
    default: // plain: the title alone
      return null
  }
}

export function WorkCover({
  cover,
  title,
  size = 'thumb',
}: {
  cover: CoverConfig
  title: string
  size?: 'thumb' | 'card'
}) {
  const p = COVER_PALETTES[cover.palette] ?? COVER_PALETTES[0]
  const [w, hgt] = size === 'thumb' ? [48, 72] : [120, 180]
  const titleLines = lines(title)
  const long = titleLines.some((l) => l.length > 9)
  const initial = (title.trim()[0] ?? '·').toUpperCase()
  const fontSize = long ? 17 : 21
  const step = long ? 20 : 24
  const centered = cover.layout === 'centered'
  // Band: the title sits on a paper-coloured strip across the lower third, like a classic paperback.
  const band = cover.layout === 'band'
  const top = band ? 112 : centered ? 72 - ((titleLines.length - 1) * step) / 2 : 34
  return (
    <svg
      viewBox="0 0 120 180"
      width={size === 'card' ? '100%' : w}
      {...(size === 'card' ? {} : { height: hgt })}
      aria-hidden="true"
      className="h-auto max-w-full shrink-0 rounded-[3px] shadow-[0_1px_2px_rgb(34_34_31/.12),0_4px_12px_rgb(34_34_31/.10)]"
    >
      <rect width="120" height="180" fill={p.ground} />
      {/* the spine: a soft fold down the left edge, so it reads as a book */}
      <rect width="7" height="180" fill="#000" opacity=".12" />
      <rect x="7" width="1.2" height="180" fill="#fff" opacity=".18" />
      <g transform={band ? 'translate(0 -70)' : centered ? 'translate(0 10)' : undefined}>
        <Motif kind={cover.motif} color={p.motif} />
      </g>
      {band && size === 'card' && (
        <rect
          x="8"
          y={top - 24}
          width="112"
          height={titleLines.length * step + 18}
          fill="#FBF8F1"
          opacity=".92"
        />
      )}
      {size === 'thumb' ? (
        <text
          x="64"
          y={band ? 150 : 74}
          textAnchor="middle"
          fontFamily="var(--font-display-family)"
          fontSize="64"
          fill={p.ink}
        >
          {initial}
        </text>
      ) : (
        <text
          fontFamily="var(--font-display-family)"
          fontSize={fontSize}
          fill={band ? '#22221F' : p.ink}
          textAnchor={centered ? 'middle' : 'start'}
        >
          {titleLines.map((l, i) => (
            <tspan key={i} x={centered ? 64 : 18} y={top + i * step}>
              {l}
            </tspan>
          ))}
        </text>
      )}
    </svg>
  )
}

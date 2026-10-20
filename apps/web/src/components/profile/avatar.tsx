/**
 * Avatars (FR-002): a face built from parts (see `AvatarBuilder`), or initials on a colour. Drawn as SVG from a small
 * stored config, so there are no uploads to store or moderate. People without a config get initials from their seed.
 * Decorative: the name next to it is the accessible label.
 */
import type { AvatarBadge, AvatarConfig } from '@morrow/contracts'
import { BadgeMedal } from './badge-medal'

// Self-contained images (they bring their own background), so fixed colours are fine in both themes.
export const AVATAR_BACKGROUNDS = [
  '#E8D9C5',
  '#C9DCCB',
  '#F2C9B8',
  '#C7D3E6',
  '#E6CFE0',
  '#F1E2A9',
  '#BFD9D6',
  '#D8D2C8',
]
const SHIRTS = ['#7A5C3E', '#4F6F55', '#B5654A', '#4D6690', '#8A5C80', '#A88A2E', '#3F7F78', '#6E665B']
export const AVATAR_SKIN = ['#F6D7C3', '#EBC09F', '#D69F7A', '#B57A53', '#8D5A3B', '#5E3A25']
export const AVATAR_HAIR_COLORS = [
  '#2B211C',
  '#5A3A26',
  '#8B5A2B',
  '#C99A5B',
  '#A2412B',
  '#9A9A9A',
  '#3E5C8A',
]
const INK = '#2B211C'

export const AVATAR_LABELS = {
  hair: ['None', 'Crop', 'Side part', 'Curls', 'Long', 'Bob', 'Bun', 'Afro', 'Locs'],
  eyes: ['Dots', 'Smiling', 'Wide', 'Calm', 'Wink'],
  mouth: ['Smile', 'Grin', 'Straight', 'Oh', 'Smirk'],
  accessory: ['None', 'Round glasses', 'Square glasses', 'Earrings'],
} as const

// Fallback for people without a config: the original initials-on-a-token look.
const PAIRS = [
  ['var(--action-primary-bg)', 'var(--action-primary-fg)'],
  ['var(--text-success)', 'var(--bg-canvas)'],
  ['var(--text-accent)', 'var(--bg-canvas)'],
  ['var(--text-primary)', 'var(--bg-canvas)'],
] as const

const initialsOf = (name: string) =>
  name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? '')
    .join('') || '·'

function HairBack({ style, color }: { style: number; color: string }) {
  if (style === 4) return <path d="M17 32c0-10 6.5-16 15-16s15 6 15 16v18H17Z" fill={color} />
  if (style === 5) return <path d="M17.5 31c0-9.5 6.5-15 14.5-15s14.5 5.5 14.5 15v10h-29Z" fill={color} />
  if (style === 7) return <circle cx="32" cy="28" r="19" fill={color} />
  if (style === 8) return <path d="M17 30c0-9 6.5-14 15-14s15 5 15 14v20h-4V36H21v14h-4Z" fill={color} />
  return null
}

function HairFront({ style, color }: { style: number; color: string }) {
  const crop = <path d="M18 31c0-9 6-14.5 14-14.5S46 22 46 31c-3-4-8-6-14-6s-11 2-14 6Z" fill={color} />
  switch (style) {
    case 1:
    case 8:
      return crop
    case 2:
      return (
        <path
          d="M18 32c-.5-10 6-15.5 14-15.5 8.5 0 14.5 5.5 14 15.5-2-5-6-8-12-8.5-1 2-4 3.5-8 3.5-3 0-5.5 1.5-8 5Z"
          fill={color}
        />
      )
    case 3:
      return (
        <g fill={color}>
          <circle cx="20" cy="26.5" r="5" />
          <circle cx="25.5" cy="21.5" r="5.5" />
          <circle cx="32.5" cy="19.5" r="6" />
          <circle cx="39.5" cy="21.5" r="5.5" />
          <circle cx="44.5" cy="26.5" r="5" />
        </g>
      )
    case 4:
      return <path d="M18 31c0-9 6-14.5 14-14.5S46 22 46 31c-2.5-5-6-7.5-11-8-2 2.5-6 4-17 8Z" fill={color} />
    case 5:
      return <path d="M18 30c0-8.5 6-13.5 14-13.5S46 21.5 46 30c-5-2-9-3-14-3s-9 1-14 3Z" fill={color} />
    case 6:
      return (
        <g fill={color}>
          <circle cx="32" cy="14.5" r="6" />
          {crop}
        </g>
      )
    case 7:
      return <path d="M18 30c1-6 6-10 14-10s13 4 14 10c-4-2.5-9-3.5-14-3.5S22 27.5 18 30Z" fill={color} />
    default:
      return null
  }
}

const stroke = { stroke: INK, strokeWidth: 1.6, strokeLinecap: 'round' as const, fill: 'none' }

function Eyes({ style }: { style: number }) {
  switch (style) {
    case 1:
      return (
        <g {...stroke}>
          <path d="M24.5 34.5q2-2.5 4 0" />
          <path d="M35.5 34.5q2-2.5 4 0" />
        </g>
      )
    case 2:
      return (
        <g>
          <circle cx="26.5" cy="33.5" r="2.6" fill="#fff" />
          <circle cx="37.5" cy="33.5" r="2.6" fill="#fff" />
          <circle cx="27" cy="33.8" r="1.3" fill={INK} />
          <circle cx="38" cy="33.8" r="1.3" fill={INK} />
        </g>
      )
    case 3:
      return (
        <g {...stroke}>
          <path d="M24.5 34h4" />
          <path d="M35.5 34h4" />
        </g>
      )
    case 4:
      return (
        <g>
          <circle cx="26.5" cy="34" r="1.6" fill={INK} />
          <path d="M35.5 34.5q2-2.5 4 0" {...stroke} />
        </g>
      )
    default:
      return (
        <g fill={INK}>
          <circle cx="26.5" cy="34" r="1.6" />
          <circle cx="37.5" cy="34" r="1.6" />
        </g>
      )
  }
}

function Mouth({ style }: { style: number }) {
  switch (style) {
    case 1:
      return <path d="M28 39h8c-.5 4-4 4-4 4s-3.5 0-4-4Z" fill="#7A2E2E" />
    case 2:
      return <path d="M29 40.5h6" {...stroke} />
    case 3:
      return <circle cx="32" cy="40.5" r="1.7" fill={INK} />
    case 4:
      return <path d="M29 40.5q3.5 1.5 6-1" {...stroke} />
    default:
      return <path d="M28.5 39.5q3.5 3 7 0" {...stroke} />
  }
}

function Accessory({ style }: { style: number }) {
  const line = { stroke: INK, strokeWidth: 1.3, fill: 'none' }
  if (style === 1)
    return (
      <g {...line}>
        <circle cx="26.5" cy="34" r="4" />
        <circle cx="37.5" cy="34" r="4" />
        <path d="M30.5 34h3" />
      </g>
    )
  if (style === 2)
    return (
      <g {...line}>
        <rect x="22" y="30.5" width="9" height="7" rx="1.5" />
        <rect x="33" y="30.5" width="9" height="7" rx="1.5" />
        <path d="M31 34h2" />
      </g>
    )
  if (style === 3)
    return (
      <g fill="#C9A227">
        <circle cx="18.5" cy="38.5" r="1.6" />
        <circle cx="45.5" cy="38.5" r="1.6" />
      </g>
    )
  return null
}

type Face = Extract<AvatarConfig, { style: 'face' }>

/** The face itself, at any size (clipped round by its container). Exported for the builder's previews. */
export function AvatarArt({ config, size }: { config: Face; size: number }) {
  const skin = AVATAR_SKIN[config.skin] ?? AVATAR_SKIN[0]!
  const hair = AVATAR_HAIR_COLORS[config.hairColor] ?? INK
  return (
    <svg viewBox="0 0 64 64" width={size} height={size} aria-hidden="true" focusable="false">
      <rect width="64" height="64" fill={AVATAR_BACKGROUNDS[config.background] ?? AVATAR_BACKGROUNDS[0]} />
      <HairBack style={config.hair} color={hair} />
      <rect x="27.5" y="42" width="9" height="9" rx="3" fill={skin} />
      <path d="M11 64c1-11 9-16 21-16s20 5 21 16Z" fill={SHIRTS[config.background] ?? SHIRTS[0]} />
      <circle cx="18.5" cy="34.5" r="3" fill={skin} />
      <circle cx="45.5" cy="34.5" r="3" fill={skin} />
      <circle cx="32" cy="33" r="14" fill={skin} />
      <circle cx="23" cy="38.5" r="2" fill="#E58F7A" opacity=".35" />
      <circle cx="41" cy="38.5" r="2" fill="#E58F7A" opacity=".35" />
      <HairFront style={config.hair} color={hair} />
      <Eyes style={config.eyes} />
      <Mouth style={config.mouth} />
      <Accessory style={config.accessory} />
    </svg>
  )
}

export function Avatar({
  name,
  seed,
  avatar = null,
  size = 40,
  badge = null,
}: {
  name: string
  seed: string
  avatar?: AvatarConfig | null
  size?: number
  /** worn on the avatar: a gold ring and the latest badge's medal at the corner (sizes 28 and up) */
  badge?: AvatarBadge | null | undefined
}) {
  const face = <AvatarFace name={name} seed={seed} avatar={avatar} size={size} />
  if (!badge || size < 28) return face
  const pip = Math.max(14, Math.round(size * 0.42))
  return (
    <span
      aria-hidden="true"
      title={`${badge.name}${badge.count > 1 ? ` and ${badge.count - 1} more badge${badge.count > 2 ? 's' : ''}` : ''}`}
      className="relative inline-block shrink-0 rounded-full"
      style={{
        width: size,
        height: size,
        boxShadow: `0 0 0 ${size >= 64 ? 3 : 2}px var(--bg-canvas), 0 0 0 ${size >= 64 ? 5 : 3.5}px var(--decor-ornament)`,
      }}
    >
      {face}
      <span
        className="badge-pop absolute grid place-items-center rounded-full bg-canvas"
        style={{ width: pip + 4, height: pip + 4, right: -pip * 0.22, bottom: -pip * 0.22 }}
      >
        <BadgeMedal code={badge.code} size={pip} />
        {badge.count > 1 && size >= 64 && (
          <span className="absolute -right-1.5 -top-1.5 grid min-w-[18px] place-items-center rounded-full bg-[var(--text-primary)] px-1 font-ui text-[10px] font-semibold leading-[18px] text-canvas">
            {badge.count}
          </span>
        )}
      </span>
    </span>
  )
}

function AvatarFace({
  name,
  seed,
  avatar,
  size,
}: {
  name: string
  seed: string
  avatar: AvatarConfig | null
  size: number
}) {
  if (avatar?.style === 'face')
    return (
      <span
        aria-hidden="true"
        className="inline-block shrink-0 overflow-hidden rounded-full"
        style={{ width: size, height: size }}
      >
        <AvatarArt config={avatar} size={size} />
      </span>
    )
  const [background, color] =
    avatar?.style === 'initials'
      ? [AVATAR_BACKGROUNDS[avatar.background] ?? AVATAR_BACKGROUNDS[0]!, INK]
      : PAIRS[[...seed].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7) % PAIRS.length]!
  return (
    <span
      aria-hidden="true"
      className="inline-grid shrink-0 place-items-center rounded-full font-ui font-semibold"
      style={{ width: size, height: size, background, color, fontSize: Math.round(size * 0.38) }}
    >
      {initialsOf(name)}
    </span>
  )
}

/** Overlapping avatars, as in "with Tolu and 2 others". */
export function AvatarStack({
  people,
  size = 24,
}: {
  people: { displayName: string; avatarSeed: string; avatar: AvatarConfig | null }[]
  size?: number
}) {
  return (
    <span className="inline-flex -space-x-2" aria-hidden="true">
      {people.map((p, i) => (
        <span key={`${p.avatarSeed}${i}`} className="inline-flex rounded-full ring-2 ring-[var(--bg-canvas)]">
          <Avatar name={p.displayName} seed={p.avatarSeed} avatar={p.avatar} size={size} />
        </span>
      ))}
    </span>
  )
}

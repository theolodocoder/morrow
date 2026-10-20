/**
 * Design tokens (design-system §2–3, P-021). Components use semantic tokens only; primitives appear
 * nowhere outside this package. Every text and control pairing is contrast-tested (test/contrast.test.ts).
 */
export const primitives = {
  ink950: '#22221F',
  ink800: '#393833',
  slate600: '#65645E',
  paper50: '#FBF8F1',
  paper100: '#F3EEE4',
  paper200: '#E7DFD2',
  stone500: '#8A867C',
  clay600: '#BD5438',
  clay700: '#99412C',
  moss600: '#667A5A',
  moss700: '#546648',
  gold500: '#C69B45',
  gold700: '#7A5C24',
  rose700: '#A8323E',
  white: '#FFFFFF',
  nightBg: '#191A18',
  nightCanvas: '#20211E',
  nightSidebar: '#242520',
  nightRaised: '#2A2B26',
  nightHover: '#2F302B',
  nightBorder: '#393A34',
  nightStone: '#7A7971',
  nightText: '#F1EDE4',
  nightText2: '#B7B3A9',
  nightText3: '#8F8B82',
  nightAccent: '#E17A5D',
  nightAccentHover: '#EA9077',
  nightPositive: '#9BAF8B',
  nightGold: '#DDBA6D',
  nightDanger: '#EF8A93',
  tintSelected: '#F4E4DC',
  tintInsert: '#E2EAD9',
  tintDelete: '#F6DEDA',
  tintWarning: '#F5EBD3',
  nightTintSelected: '#3A2B25',
  nightTintInsert: '#2B3427',
  nightTintDelete: '#3B2726',
  nightTintWarning: '#353022',
  sepia50: '#F4ECD8',
  sepia100: '#EADFC6',
  sepiaInk: '#3B2F22',
  sepiaInk2: '#5A4A38',
  sepiaInk3: '#6B5A45',
  sepiaBorder: '#DDCFAE',
  sepiaStone: '#857860',
  sepiaTintSelected: '#EFDDC9',
} as const

const p = primitives
type Theme = Record<SemanticToken, string>
export type SemanticToken =
  | 'bg-app'
  | 'bg-canvas'
  | 'bg-sidebar'
  | 'bg-raised'
  | 'bg-hover'
  | 'bg-selected'
  | 'text-primary'
  | 'text-secondary'
  | 'text-tertiary'
  | 'text-accent'
  | 'text-success'
  | 'text-warning'
  | 'text-danger'
  | 'action-primary-bg'
  | 'action-primary-fg'
  | 'action-primary-hover'
  | 'border-subtle'
  | 'border-control'
  | 'focus-ring'
  | 'decor-ornament'
  | 'tint-insert'
  | 'tint-delete'
  | 'tint-warning'

export const light: Theme = {
  'bg-app': p.paper100,
  'bg-canvas': p.paper50,
  'bg-sidebar': p.paper100,
  'bg-raised': p.paper50,
  'bg-hover': p.paper200,
  'bg-selected': p.tintSelected,
  'text-primary': p.ink950,
  'text-secondary': p.ink800,
  'text-tertiary': p.slate600,
  'text-accent': p.clay700,
  'text-success': p.moss700,
  'text-warning': p.gold700,
  'text-danger': p.rose700,
  'action-primary-bg': p.clay600,
  'action-primary-fg': p.white,
  'action-primary-hover': p.clay700,
  'border-subtle': p.paper200,
  'border-control': p.stone500,
  'focus-ring': p.clay700,
  'decor-ornament': p.gold500,
  'tint-insert': p.tintInsert,
  'tint-delete': p.tintDelete,
  'tint-warning': p.tintWarning,
}

export const dark: Theme = {
  'bg-app': p.nightBg,
  'bg-canvas': p.nightCanvas,
  'bg-sidebar': p.nightSidebar,
  'bg-raised': p.nightRaised,
  'bg-hover': p.nightHover,
  'bg-selected': p.nightTintSelected,
  'text-primary': p.nightText,
  'text-secondary': p.nightText2,
  'text-tertiary': p.nightText3,
  'text-accent': p.nightAccent,
  'text-success': p.nightPositive,
  'text-warning': p.nightGold,
  'text-danger': p.nightDanger,
  // White on the dark accent is 2.94:1, so the primary button carries dark text (measured).
  'action-primary-bg': p.nightAccent,
  'action-primary-fg': p.nightBg,
  'action-primary-hover': p.nightAccentHover,
  'border-subtle': p.nightBorder,
  'border-control': p.nightStone,
  'focus-ring': p.nightAccent,
  'decor-ornament': p.nightGold,
  'tint-insert': p.nightTintInsert,
  'tint-delete': p.nightTintDelete,
  'tint-warning': p.nightTintWarning,
}

/** The reader's sepia page: warm paper, brown ink. Accent, status and button roles reuse the light hues (measured on sepia). */
export const sepia: Theme = {
  ...light,
  'bg-app': p.sepia100,
  'bg-canvas': p.sepia50,
  'bg-sidebar': p.sepia100,
  'bg-raised': p.sepia50,
  'bg-hover': p.sepia100,
  'bg-selected': p.sepiaTintSelected,
  'text-primary': p.sepiaInk,
  'text-secondary': p.sepiaInk2,
  'text-tertiary': p.sepiaInk3,
  'border-subtle': p.sepiaBorder,
  'border-control': p.sepiaStone,
}

/** Eight collaborator hues: caret ≥ 3:1 on the canvas, label text ≥ 4.5:1 (design-system §3). */
export const presence = {
  light: ['#B4502F', '#53704A', '#8C6A1E', '#3A679A', '#7A4A8C', '#2B7472', '#A8425F', '#525A9E'],
  dark: ['#E8876A', '#A3B992', '#DDBA6D', '#8EB3DD', '#C49AD6', '#7FC2BE', '#E78FA8', '#A6ADE6'],
} as const

export const fonts = {
  display: '"Instrument Serif", "Iowan Old Style", "Palatino Linotype", Georgia, serif',
  manuscript: 'Literata, "Iowan Old Style", Georgia, serif',
  ui: '"DM Sans", system-ui, -apple-system, "Segoe UI", sans-serif',
  mono: '"IBM Plex Mono", ui-monospace, "SF Mono", Menlo, monospace',
} as const

export const motion = {
  fast: '160ms',
  base: '220ms',
  slow: '300ms',
  easeOut: 'cubic-bezier(.2,0,0,1)',
  easeIn: 'cubic-bezier(.4,0,1,1)',
} as const
export const radius = { sm: '4px', md: '6px', lg: '10px' } as const

/** WCAG 2.x contrast ratio. Exported for the contrast test and for runtime presence-colour checks. */
export function contrast(a: string, b: string): number {
  const lum = (hex: string) => {
    const c = [1, 3, 5]
      .map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
      .map((x) => (x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4))
    return 0.2126 * c[0]! + 0.7152 * c[1]! + 0.0722 * c[2]!
  }
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x)
  return (hi! + 0.05) / (lo! + 0.05)
}

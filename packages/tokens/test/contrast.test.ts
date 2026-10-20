import { describe, expect, it } from 'vitest'
import { contrast, dark, light, presence, primitives as p } from '../src/index.ts'

const TEXT = 4.5,
  UI = 3
const textOn = ['bg-app', 'bg-canvas', 'bg-sidebar', 'bg-hover', 'bg-selected'] as const
const strongText = [
  'text-primary',
  'text-secondary',
  'text-accent',
  'text-success',
  'text-warning',
  'text-danger',
] as const

describe.each([
  ['light', light],
  ['dark', dark],
] as const)('%s theme', (name, t) => {
  for (const fg of strongText)
    for (const bg of [...textOn, 'bg-raised'] as const)
      it(`${fg} on ${bg} ≥ ${TEXT}`, () => expect(contrast(t[fg], t[bg])).toBeGreaterThanOrEqual(TEXT))
  // Tertiary text is restricted to app, canvas and sidebar surfaces (measured; design-system §3).
  for (const bg of ['bg-app', 'bg-canvas', 'bg-sidebar'] as const)
    it(`text-tertiary on ${bg} ≥ ${TEXT}`, () =>
      expect(contrast(t['text-tertiary'], t[bg])).toBeGreaterThanOrEqual(TEXT))
  it('primary button text ≥ 4.5 on its fill and hover', () => {
    expect(contrast(t['action-primary-fg'], t['action-primary-bg'])).toBeGreaterThanOrEqual(TEXT)
    expect(contrast(t['action-primary-fg'], t['action-primary-hover'])).toBeGreaterThanOrEqual(TEXT)
  })
  const controlSurfaces =
    name === 'light'
      ? (['bg-canvas', 'bg-app'] as const)
      : (['bg-app', 'bg-canvas', 'bg-sidebar', 'bg-raised', 'bg-hover'] as const)
  for (const bg of controlSurfaces) {
    it(`control border on ${bg} ≥ ${UI}`, () =>
      expect(contrast(t['border-control'], t[bg])).toBeGreaterThanOrEqual(UI))
    it(`focus ring on ${bg} ≥ ${UI}`, () =>
      expect(contrast(t['focus-ring'], t[bg])).toBeGreaterThanOrEqual(UI))
  }
  for (const bg of ['tint-insert', 'tint-delete', 'tint-warning'] as const)
    it(`text-primary on ${bg} ≥ ${TEXT}`, () =>
      expect(contrast(t['text-primary'], t[bg])).toBeGreaterThanOrEqual(TEXT))
})

describe('presence colours', () => {
  it.each(presence.light)('light %s: caret ≥ 3 on canvas, white label ≥ 4.5', (c) => {
    expect(contrast(c, p.paper50)).toBeGreaterThanOrEqual(UI)
    expect(contrast(p.white, c)).toBeGreaterThanOrEqual(TEXT)
  })
  it.each(presence.dark)('dark %s: caret ≥ 3 on canvas, dark label ≥ 4.5', (c) => {
    expect(contrast(c, p.nightCanvas)).toBeGreaterThanOrEqual(UI)
    expect(contrast(p.nightBg, c)).toBeGreaterThanOrEqual(TEXT)
  })
})

describe('known failures stay excluded (guards against "fixing" the tokens back)', () => {
  it('clay-600 is not used as text', () =>
    expect(Object.entries(light).filter(([k, v]) => k.startsWith('text-') && v === p.clay600)).toEqual([]))
  it('gold-500 and moss-600 are not used as text', () => {
    for (const v of [p.gold500, p.moss600])
      expect(Object.entries(light).filter(([k, x]) => k.startsWith('text-') && x === v)).toEqual([])
  })
})

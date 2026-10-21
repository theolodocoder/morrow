import { describe, expect, it } from 'vitest'
import { creditLine, mergePositions, minutesFor, minutesLeft, sectionLabel } from '../src/index.ts'

describe('sectionLabel', () => {
  it('names fiction chapters in words', () => {
    for (const form of ['fiction', 'novel', 'novella', 'short_story', 'collection', 'other'] as const)
      expect(sectionLabel(form, 2, 12)).toBe('Chapter three')
    expect(sectionLabel('novel', 0, 2)).toBe('Chapter one')
    expect(sectionLabel('novel', 19, 30)).toBe('Chapter twenty')
  })
  it('switches to digits past twenty', () => {
    expect(sectionLabel('novel', 20, 30)).toBe('Chapter 21')
  })
  it('names parts and sections for non-fiction', () => {
    for (const form of ['article', 'essay', 'educational', 'general_document'] as const)
      expect(sectionLabel(form, 1, 4)).toBe('Part 2')
    expect(sectionLabel('research_paper', 1, 4)).toBe('Section 2')
  })
  it('labels poetry like fiction', () => {
    expect(sectionLabel('poetry', 0, 3)).toBe('Chapter one')
  })
  it('gives a single-piece work no label', () => {
    for (const form of ['novel', 'essay', 'research_paper', 'poetry'] as const)
      expect(sectionLabel(form, 0, 1)).toBeNull()
  })
})

describe('minutesFor', () => {
  it('rounds up at 230 words a minute', () => {
    expect(minutesFor(0)).toBe(0)
    expect(minutesFor(1)).toBe(1)
    expect(minutesFor(230)).toBe(1)
    expect(minutesFor(231)).toBe(2)
    expect(minutesFor(460)).toBe(2)
  })
})

describe('minutesLeft', () => {
  it('counts the unread share, rounded up', () => {
    expect(minutesLeft(2300, 0)).toBe(10)
    expect(minutesLeft(2300, 0.5)).toBe(5)
    expect(minutesLeft(2300, 0.95)).toBe(1)
  })
  it('shows nothing for an empty chapter or once it is finished', () => {
    expect(minutesLeft(0, 0.3)).toBeNull()
    expect(minutesLeft(2300, 1)).toBeNull()
  })
  it('clamps progress to 0..1', () => {
    expect(minutesLeft(2300, -1)).toBe(10)
    expect(minutesLeft(2300, 2)).toBeNull()
  })
})

describe('creditLine', () => {
  it('names the author, then who they wrote with', () => {
    expect(creditLine([])).toBe('')
    expect(creditLine(['Ama Owusu'])).toBe('Ama Owusu')
    expect(creditLine(['Ama Owusu', 'Tolu Ade'])).toBe('Ama Owusu, with Tolu Ade')
    expect(creditLine(['Ama', 'Tolu', 'Kemi'])).toBe('Ama, with Tolu and Kemi')
  })
  it('counts the rest past three', () => {
    expect(creditLine(['Ama', 'Tolu', 'Kemi', 'Ife'])).toBe('Ama, with Tolu, Kemi and 1 other')
    expect(creditLine(['Ama', 'Tolu', 'Kemi', 'Ife', 'Bayo'])).toBe('Ama, with Tolu, Kemi and 2 others')
  })
})

describe('mergePositions', () => {
  const live = ['one-aaaaaa', 'two-bbbbbb', 'three-cccccc']
  it('furthest wins per chapter, in reading order', () => {
    const local = [
      { chapterSlug: 'two-bbbbbb', blockId: 'b9', percent: 80 },
      { chapterSlug: 'one-aaaaaa', blockId: 'a2', percent: 10 },
    ]
    const server = [
      { chapterSlug: 'one-aaaaaa', blockId: 'a7', percent: 60 },
      { chapterSlug: 'two-bbbbbb', blockId: 'b1', percent: 5 },
      { chapterSlug: 'three-cccccc', blockId: null, percent: 0 },
    ]
    expect(mergePositions(local, server, live)).toEqual([
      { chapterSlug: 'one-aaaaaa', blockId: 'a7', percent: 60 },
      { chapterSlug: 'two-bbbbbb', blockId: 'b9', percent: 80 },
      { chapterSlug: 'three-cccccc', blockId: null, percent: 0 },
    ])
  })
  it('stale localStorage entry for a removed chapter is dropped', () => {
    const local = [
      { chapterSlug: 'gone-zzzzzz', blockId: 'z1', percent: 90 },
      { chapterSlug: 'one-aaaaaa', blockId: 'a1', percent: 20 },
    ]
    expect(mergePositions(local, [], live)).toEqual([
      { chapterSlug: 'one-aaaaaa', blockId: 'a1', percent: 20 },
    ])
  })
  it('ignores malformed device entries instead of throwing', () => {
    const junk = [
      null,
      'x',
      { chapterSlug: 'one-aaaaaa', percent: 'lots' },
      { chapterSlug: 'two-bbbbbb', blockId: 4, percent: 140 },
    ]
    expect(mergePositions(junk as never, [], live)).toEqual([
      { chapterSlug: 'two-bbbbbb', blockId: null, percent: 100 },
    ])
    expect(mergePositions('nonsense' as never, [], live)).toEqual([])
  })
})

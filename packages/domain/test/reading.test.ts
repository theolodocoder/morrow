import { describe, expect, it } from 'vitest'
import { creditLine, minutesFor, sectionLabel } from '../src/index.ts'

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

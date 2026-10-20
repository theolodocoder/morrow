import { describe, expect, it } from 'vitest'
import { openingLine, type PMNode } from '../src/index.ts'

const p = (text?: string): PMNode => ({
  type: 'paragraph',
  ...(text ? { content: [{ type: 'text', text }] } : {}),
})
const doc = (...content: PMNode[]): PMNode => ({ type: 'doc', content })

describe('openingLine', () => {
  it('returns a short first paragraph whole', () => {
    expect(openingLine(doc(p('The first frost came early.'), p('Second.')))).toBe(
      'The first frost came early.',
    )
  })

  it('cuts a long paragraph at a word boundary with an ellipsis', () => {
    const long = Array.from({ length: 60 }, (_, i) => `word${i}`).join(' ')
    const line = openingLine(doc(p(long)))!
    expect(line.length).toBeLessThanOrEqual(201)
    expect(line.endsWith('…')).toBe(true)
    expect(long.startsWith(line.slice(0, -1))).toBe(true)
    expect(long[line.length - 1]).toBe(' ')
  })

  it('skips empty paragraphs and scene breaks to the first text', () => {
    expect(openingLine(doc(p(), { type: 'sceneBreak' }, { type: 'horizontalRule' }, p('Then rain.')))).toBe(
      'Then rain.',
    )
  })

  it('reads text nested in marks and blocks', () => {
    const quote: PMNode = {
      type: 'blockquote',
      content: [
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: 'Hello, ' },
            { type: 'text', text: 'world', marks: [{ type: 'bold' }] },
          ],
        },
      ],
    }
    expect(openingLine(doc(quote))).toBe('Hello, world')
  })

  it('is null when there is no text', () => {
    expect(openingLine(doc(p(), { type: 'sceneBreak' }))).toBeNull()
    expect(openingLine({ type: 'doc' })).toBeNull()
    expect(openingLine(null)).toBeNull()
  })
})

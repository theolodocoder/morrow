import { describe, expect, it } from 'vitest'
import { diffDocuments, diffSummary, diffWords, type PMNode } from '../src/index.ts'

const p = (id: string, text: string): PMNode => ({
  type: 'paragraph',
  attrs: { id },
  content: [{ type: 'text', text }],
})
const doc = (...content: PMNode[]): PMNode => ({ type: 'doc', content })

describe('proposal display diff', () => {
  it('compares words inside a changed paragraph', () => {
    expect(diffWords('She did not look back.', 'She never looked back.')).toEqual([
      { op: 'same', text: 'She ' },
      { op: 'removed', text: 'did not look' },
      { op: 'added', text: 'never looked' },
      { op: 'same', text: ' back.' },
    ])
    const ops = diffWords('She did not look back.', 'She never looked back.')
    expect(
      ops
        .filter((o) => o.op !== 'removed')
        .map((o) => o.text)
        .join(''),
    ).toBe('She never looked back.')
    expect(
      ops
        .filter((o) => o.op !== 'added')
        .map((o) => o.text)
        .join(''),
    ).toBe('She did not look back.')
  })

  it('matches paragraphs by id and reports added, removed and changed blocks in reading order', () => {
    const before = doc(p('a', 'One.'), p('b', 'Two.'), p('c', 'Three.'))
    const after = doc(p('a', 'One.'), p('n', 'New.'), p('c', 'Three, changed.'))
    const changes = diffDocuments(before, after)
    expect(changes.map((c) => `${c.type}:${c.id}`)).toEqual(['same:a', 'removed:b', 'added:n', 'changed:c'])
    expect(diffSummary(changes)).toEqual({ changed: 1, added: 1, removed: 1 })
  })

  it('ignores key order: stored JSON (jsonb) and live JSON of the same paragraph are the same', () => {
    const stored = JSON.parse(
      '{"type":"doc","content":[{"attrs":{"id":"a"},"content":[{"text":"One.","type":"text"}],"type":"paragraph"}]}',
    )
    expect(diffDocuments(stored, doc(p('a', 'One.')))[0]!.type).toBe('same')
  })

  it('treats a mark change as a change even when the words are equal', () => {
    const bold: PMNode = {
      type: 'paragraph',
      attrs: { id: 'a' },
      content: [{ type: 'text', text: 'One.', marks: [{ type: 'bold' }] }],
    }
    expect(diffDocuments(doc(p('a', 'One.')), doc(bold))[0]!.type).toBe('changed')
  })
})

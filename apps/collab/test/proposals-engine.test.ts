import { describe, expect, it } from 'vitest'
import fc from 'fast-check'
import * as Y from 'yjs'
import { diffBlocks, type Block } from '@morrow/domain'
import { documentToJSON } from '@morrow/editor/server'
import {
  applyProposal,
  applyUsingProposal,
  blocksOf,
  classifyDocs,
  freeze,
  refreshWorkspace,
} from '../src/proposals.ts'

// Documents shaped exactly as y-prosemirror stores them: paragraph elements with an id attribute and an XmlText.
const F = 'default'
function block(id: string, text: string) {
  const el = new Y.XmlElement('paragraph')
  el.setAttribute('id', id)
  const t = new Y.XmlText()
  t.insert(0, text)
  el.insert(0, [t])
  return el
}
function docOf(blocks: [string, string][]) {
  const d = new Y.Doc()
  d.transact(() =>
    d.getXmlFragment(F).insert(
      0,
      blocks.map(([id, t]) => block(id, t)),
    ),
  )
  return d
}
const el = (d: Y.Doc, i: number) => d.getXmlFragment(F).get(i) as Y.XmlElement
const txt = (d: Y.Doc, i: number) => el(d, i).get(0) as Y.XmlText
const len = (d: Y.Doc) => d.getXmlFragment(F).length
const texts = (d: Y.Doc) =>
  d
    .getXmlFragment(F)
    .toArray()
    .map((n) => ((n as Y.XmlElement).get(0) as Y.XmlText | undefined)?.toString() ?? '')
const rewrite = (d: Y.Doc, i: number, s: string) =>
  d.transact(() => {
    const t = txt(d, i)
    t.delete(0, t.length)
    t.insert(0, s)
  })

/** The proposal flow: base snapshot = the chapter at fork time; workspace = a lineage-preserving copy. */
const fork = (head: Y.Doc) => ({ base: freeze(head), workspace: freeze(head) })
const story = () =>
  docOf([
    ['a', 'The salt had come up through the roots again.'],
    ['b', 'Ama walked the rows with her palms open.'],
    ['c', 'She did not look back.'],
    ['d', 'The orchard was quiet.'],
  ])

describe('proposal engine', () => {
  it('fast-forward: applies when the chapter has not moved', () => {
    const head = story()
    const p = fork(head)
    txt(p.workspace, 2).insert(0, 'At the gate, ')
    const r = applyProposal(head, p.workspace, p.base, 'p1')
    expect(r).toMatchObject({ applied: true, classification: { kind: 'fast-forward' } })
    expect(texts(head)[2]).toBe('At the gate, She did not look back.')
  })

  it('clean: both sides changed different paragraphs, and each change lands in the right place', () => {
    const head = story()
    const p = fork(head)
    rewrite(p.workspace, 2, 'She looked back once.')
    head.getXmlFragment(F).insert(0, [block('h1', 'Prologue.')])
    txt(head, 1).insert(0, 'That spring, ')
    expect(applyProposal(head, p.workspace, p.base, 'p1')).toMatchObject({
      applied: true,
      classification: { kind: 'clean' },
    })
    expect(texts(head)).toEqual([
      'Prologue.',
      'That spring, The salt had come up through the roots again.',
      'Ama walked the rows with her palms open.',
      'She looked back once.',
      'The orchard was quiet.',
    ])
  })

  it('conflict: both rewrote the same paragraph; nothing is applied (a raw merge would interleave them)', () => {
    const head = story()
    const p = fork(head)
    rewrite(p.workspace, 2, 'She looked back once.')
    rewrite(head, 2, 'She never turned around.')
    const before = texts(head)
    const r = applyProposal(head, p.workspace, p.base, 'p1')
    expect(r).toMatchObject({ applied: false, classification: { kind: 'conflict', blockIds: ['c'] } })
    expect(texts(head)).toEqual(before)
  })

  it('identity, not text: a paragraph deleted and retyped identically on head still conflicts with a proposal edit', () => {
    const head = story()
    const p = fork(head)
    txt(p.workspace, 1).insert(0, 'Slowly, ')
    rewrite(head, 1, 'Ama walked the rows with her palms open.') // same text, new items
    expect(classifyDocs(p.base, head, p.workspace).kind).toBe('conflict')
  })

  it('accept is idempotent: a retry applies nothing twice', () => {
    const head = story()
    const p = fork(head)
    txt(p.workspace, 0).insert(0, 'Again: ')
    applyProposal(head, p.workspace, p.base, 'p1')
    const once = texts(head)
    expect(applyProposal(head, p.workspace, p.base, 'p1')).toMatchObject({
      applied: false,
      alreadyApplied: true,
    })
    expect(texts(head)).toEqual(once)
  })

  it('refresh: the chapter’s other changes flow in, the proposal keeps its own version of contested paragraphs', () => {
    const head = story()
    const p = fork(head)
    rewrite(p.workspace, 2, 'She looked back once.')
    rewrite(head, 2, 'She never turned around.')
    txt(head, 3).insert(0, 'Later, ')
    const { reference } = refreshWorkspace(p.workspace, head, p.base)
    expect(reference.map((r) => r.blockId)).toEqual(['c'])
    expect(JSON.stringify(reference[0]!.chapter)).toContain('She never turned around.')
    expect(texts(p.workspace)).toEqual([
      'The salt had come up through the roots again.',
      'Ama walked the rows with her palms open.',
      'She looked back once.',
      'Later, The orchard was quiet.',
    ])
    // re-based on the chapter as merged, the proposal now applies as a fast-forward
    const newBase = freeze(head)
    const r = applyProposal(head, p.workspace, newBase, 'p1')
    expect(r).toMatchObject({ applied: true, classification: { kind: 'fast-forward' } })
    expect(texts(head)).toEqual([
      'The salt had come up through the roots again.',
      'Ama walked the rows with her palms open.',
      'She looked back once.',
      'Later, The orchard was quiet.',
    ])
    expect(documentToJSON(head).content).toHaveLength(4)
  })

  it('refresh: a paragraph the chapter deleted but the proposal rewrote is put back', () => {
    const head = story()
    const p = fork(head)
    rewrite(p.workspace, 2, 'She looked back once.')
    head.getXmlFragment(F).delete(2, 1)
    refreshWorkspace(p.workspace, head, p.base)
    expect(texts(p.workspace)).toEqual([
      'The salt had come up through the roots again.',
      'Ama walked the rows with her palms open.',
      'She looked back once.',
      'The orchard was quiet.',
    ])
  })
})

describe('branch merges (FR-018)', () => {
  it('merging twice: the second merge starts from the branch as last merged, so the parent’s own edits never conflict or revert', async () => {
    const main = story()
    const branch = freeze(main) // fork
    let base = freeze(main) // first base: the fork point
    rewrite(branch, 1, 'Ama ran the rows.') // branch edits b
    txt(main, 0).insert(0, 'That spring, ') // main edits a meanwhile
    expect(applyProposal(main, freeze(branch), base, 'merge-1')).toMatchObject({
      applied: true,
      classification: { kind: 'clean' },
    })
    base = freeze(branch) // as collab records it: the branch state that was merged

    // After the merge: main keeps writing in b; the branch writes in c only.
    txt(main, 1).insert(txt(main, 1).length, ' Then stopped.')
    rewrite(branch, 2, 'She looked back.')
    const second = applyProposal(main, freeze(branch), base, 'merge-2')
    expect(second).toMatchObject({ applied: true, classification: { kind: 'clean' } })
    expect(texts(main)).toEqual([
      'That spring, The salt had come up through the roots again.',
      'Ama ran the rows. Then stopped.',
      'She looked back.',
      'The orchard was quiet.',
    ])
  })

  it('a branch edit to a paragraph the parent also changed since the last merge is a conflict', async () => {
    const main = story()
    const branch = freeze(main)
    const base = freeze(main) // the real fork point
    rewrite(branch, 1, 'Ama ran the rows.')
    rewrite(main, 1, 'Ama sat down.')
    const r = applyProposal(main, freeze(branch), base, 'm')
    expect(r).toMatchObject({ applied: false, classification: { kind: 'conflict', blockIds: ['b'] } })
    expect(texts(main)[1]).toBe('Ama sat down.')
  })
})

describe('reviewer resolves a conflict using the proposal’s wording', () => {
  it('contested paragraphs take the proposal’s wording, the chapter’s other edits stay, the workspace is untouched', () => {
    const head = story()
    const p = fork(head)
    rewrite(p.workspace, 2, 'She looked back once.')
    rewrite(head, 2, 'She never turned around.')
    txt(head, 3).insert(0, 'Later, ')
    head.getXmlFragment(F).insert(3, [block('n', 'A new paragraph from the writer.')])
    expect(classifyDocs(p.base, head, p.workspace).kind).toBe('conflict')
    const before = texts(p.workspace)
    const r = applyUsingProposal(head, p.workspace, p.base, 'p1')
    expect(r).toMatchObject({ applied: true, contested: 1 })
    expect(texts(head)).toEqual([
      'The salt had come up through the roots again.',
      'Ama walked the rows with her palms open.',
      'She looked back once.',
      'A new paragraph from the writer.',
      'Later, The orchard was quiet.',
    ])
    expect(texts(p.workspace)).toEqual(before) // nothing of the chapter was written into the proposal
    expect(applyUsingProposal(head, p.workspace, p.base, 'p1')).toMatchObject({
      applied: false,
      alreadyApplied: true,
    })
    expect(texts(head)).toHaveLength(5)
  })
})

// ---- Property test (S2): clean and fast-forward proposals always equal an independent block-level 3-way merge ----
type Op = {
  k: 'insT' | 'delT' | 'insB' | 'delB' | 'split' | 'join'
  i: number
  pos: number
  n: number
  s: string
}
const word = fc.constantFrom('salt ', 'root ', 'gate ', 'tide ', 'letter ', 'Ama ', '')
const opArb: fc.Arbitrary<Op> = fc.record({
  k: fc.constantFrom('insT', 'delT', 'insB', 'delB', 'split', 'join'),
  i: fc.nat(10),
  pos: fc.nat(30),
  n: fc.integer({ min: 1, max: 10 }),
  s: word,
})
function run(d: Y.Doc, list: Op[], prefix: string) {
  let c = 0
  for (const o of list) {
    const L = len(d)
    const i = o.i % L
    if (o.k === 'insT' && o.s) {
      const t = txt(d, i)
      t.insert(Math.min(o.pos, t.length), o.s)
    }
    if (o.k === 'delT') {
      const t = txt(d, i)
      const p = Math.min(o.pos, t.length)
      t.delete(p, Math.min(o.n, t.length - p))
    }
    if (o.k === 'insB') d.getXmlFragment(F).insert(o.i % (L + 1), [block(`${prefix}${c++}`, o.s || 'new ')])
    if (o.k === 'delB' && L > 1) d.getXmlFragment(F).delete(i, 1)
    if (o.k === 'split')
      d.transact(() => {
        const t = txt(d, i)
        const p = Math.min(o.pos, t.length)
        const rest = t.toString().slice(p)
        t.delete(p, t.length - p)
        d.getXmlFragment(F).insert(i + 1, [block(`${prefix}${c++}`, rest)])
      })
    if (o.k === 'join' && L > 1) {
      const j = o.i % (L - 1)
      d.transact(() => {
        const next = txt(d, j + 1).toString()
        txt(d, j).insert(txt(d, j).length, next)
        d.getXmlFragment(F).delete(j + 1, 1)
      })
    }
  }
}
const withText = (d: Y.Doc) => blocksOf(d).map((b, i) => ({ ...b, text: texts(d)[i] }))
function expectedMerge(
  base: Block[],
  head: (Block & { text?: string })[],
  prop: (Block & { text?: string })[],
) {
  const p = diffBlocks(base, prop)
  const byId = new Map(prop.map((b) => [b.id, b]))
  let out = head.filter((b) => !p.deleted.has(b.id)).map((b) => (p.modified.has(b.id) ? byId.get(b.id)! : b))
  const baseIds = new Set(base.map((b) => b.id))
  let prev: string | null = null
  let pending: typeof prop = []
  const place = () => {
    if (!pending.length) return
    const at = prev === null ? 0 : out.findIndex((b) => b.id === prev) + 1
    out = [...out.slice(0, at), ...pending, ...out.slice(at)]
    pending = []
  }
  for (const b of prop) {
    if (baseIds.has(b.id)) {
      place()
      prev = b.id
    } else pending.push(b)
  }
  place()
  return out.map((b) => b.text)
}

it('clean and fast-forward proposals always produce the block-level 3-way merge', () => {
  fc.assert(
    fc.property(
      fc.array(
        fc.array(word, { minLength: 1, maxLength: 4 }).map((w) => w.join('') || 'x'),
        { minLength: 1, maxLength: 8 },
      ),
      fc.array(opArb, { maxLength: 6 }),
      fc.array(opArb, { maxLength: 6 }),
      (initial, headOps, propOps) => {
        const head = docOf(initial.map((t, i) => [`b${i}`, t]))
        const p = fork(head)
        run(head, headOps, 'h')
        run(p.workspace, propOps, 'p')
        const base = blocksOf(p.base)
        const headBefore = withText(head)
        const prop = withText(p.workspace)
        const before = texts(head)
        const r = applyProposal(head, p.workspace, p.base, 'prop')
        if (!r.applied) {
          expect(texts(head)).toEqual(before)
          return
        }
        expect(texts(head)).toEqual(expectedMerge(base, headBefore, prop))
      },
    ),
    { numRuns: 3000, seed: 20261019 },
  )
}, 120_000)

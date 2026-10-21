// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest'
import * as Y from 'yjs'
import { Editor } from '@tiptap/core'
import {
  isSafeLinkUrl,
  manuscriptExtensions,
  plainText,
  stripBlockIds,
  wordCount,
  findDuplicateBlockIds,
} from '../src/index.ts'
import {
  documentFromJSON,
  documentToJSON,
  initialDocumentState,
  manuscriptSchema,
  project,
} from '../src/server.ts'

describe('schema (Q-019 working assumption)', () => {
  it('contains exactly the launch node and mark types', () => {
    expect(Object.keys(manuscriptSchema.nodes).sort()).toEqual(
      [
        'blockquote',
        'bulletList',
        'callout',
        'codeBlock',
        'doc',
        'hardBreak',
        'heading',
        'horizontalRule',
        'listItem',
        'note',
        'orderedList',
        'paragraph',
        'sceneBreak',
        'table',
        'tableCell',
        'tableHeader',
        'tableRow',
        'taskItem',
        'taskList',
        'text',
        'verse',
      ].sort(),
    )
    expect(Object.keys(manuscriptSchema.marks).sort()).toEqual(
      [
        'bold',
        'code',
        'highlight',
        'italic',
        'link',
        'strike',
        'subscript',
        'superscript',
        'underline',
      ].sort(),
    )
  })
  it('allows h2 to h4 inside a chapter (the chapter title is the h1)', () => {
    const e = new Editor({
      element: document.createElement('div'),
      extensions: manuscriptExtensions(),
      content: '<h1>A</h1><h2>B</h2><h4>C</h4><h5>D</h5>',
    })
    const types = e.getJSON().content!.map((n) => `${n.type}${n.attrs?.level ?? ''}`)
    expect(types).toEqual(['paragraph', 'heading2', 'heading4', 'paragraph'])
    e.destroy()
  })
})

describe('links', () => {
  it.each(['https://example.com', 'http://example.com/a?b', 'mailto:a@example.com'])('allows %s', (u) =>
    expect(isSafeLinkUrl(u)).toBe(true),
  )
  it.each(['javascript:alert(1)', 'data:text/html,x', 'vbscript:x', 'file:///etc/passwd', 'not a url'])(
    'rejects %s',
    (u) => expect(isSafeLinkUrl(u)).toBe(false),
  )
  it('drops unsafe links from pasted or set content', () => {
    const e = new Editor({
      element: document.createElement('div'),
      extensions: manuscriptExtensions(),
      content: '<p><a href="javascript:alert(1)">x</a> <a href="https://ok.example">y</a></p>',
    })
    const marks = JSON.stringify(e.getJSON())
    expect(marks).not.toContain('javascript:')
    expect(marks).toContain('https://ok.example')
    e.destroy()
  })
})

describe('block ids', () => {
  it('every top-level block gets a unique id, persisted in Yjs when collaborating', () => {
    const doc = new Y.Doc()
    const e = new Editor({
      element: document.createElement('div'),
      extensions: manuscriptExtensions({ collaboration: { document: doc } }),
    })
    e.commands.setContent('<p>One.</p><blockquote><p>Two.</p></blockquote><hr><ul><li><p>Three</p></li></ul>')
    const ids = documentToJSON(doc).content!.map((b) => b.attrs?.id)
    expect(ids.every((id) => typeof id === 'string')).toBe(true)
    expect(new Set(ids).size).toBe(ids.length)
    e.destroy()
  })
  it('stripBlockIds removes ids at every depth and keeps other attrs', () => {
    const json = {
      type: 'doc',
      content: [{ type: 'heading', attrs: { id: 'x', level: 2 }, content: [{ type: 'text', text: 'T' }] }],
    }
    expect(stripBlockIds(json)).toEqual({
      type: 'doc',
      content: [{ type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'T' }] }],
    })
  })
  it('findDuplicateBlockIds reports repeated ids', () => {
    expect(
      findDuplicateBlockIds({
        type: 'doc',
        content: [
          { type: 'paragraph', attrs: { id: 'a' } },
          { type: 'paragraph', attrs: { id: 'a' } },
        ],
      }),
    ).toEqual(['a'])
  })
})

describe('server conversion and projection', () => {
  const json = {
    type: 'doc',
    content: [
      {
        type: 'paragraph',
        attrs: { id: 'p1' },
        content: [{ type: 'text', text: 'The salt had come up — again.' }],
      },
      { type: 'horizontalRule', attrs: { id: 'hr' } },
      {
        type: 'paragraph',
        attrs: { id: 'p2' },
        content: [
          { type: 'text', text: 'Ama walked' },
          { type: 'hardBreak' },
          { type: 'text', text: 'the rows.' },
        ],
      },
    ],
  }
  it('round-trips JSON → Y.Doc → JSON without loss', () => {
    expect(documentToJSON(documentFromJSON(json))).toEqual(json)
  })
  it('rejects content the schema does not allow', () => {
    expect(() => documentFromJSON({ type: 'doc', content: [{ type: 'table', content: [] }] })).toThrow()
  })
  it('projects plain text and a prose word count', () => {
    const p = project(documentFromJSON(json))
    expect(p.plainText).toBe('The salt had come up — again.\nAma walked\nthe rows.')
    expect(p.wordCount).toBe(10)
    expect(p.duplicateBlockIds).toEqual([])
  })
  it('wordCount ignores punctuation-only tokens and handles non-Latin scripts', () => {
    expect(wordCount('— " … ok')).toBe(1)
    expect(wordCount('Ẹ kú àárọ̀ ọ̀rẹ́')).toBe(4)
    expect(plainText({ type: 'doc' })).toBe('')
  })
})

describe('initial document state', () => {
  it('is one empty paragraph, byte-identical across calls, and merges to one paragraph', () => {
    const a = initialDocumentState('doc-1'),
      b = initialDocumentState('doc-1')
    expect([...a]).toEqual([...b])
    const d = new Y.Doc()
    Y.applyUpdate(d, a)
    Y.applyUpdate(d, b)
    expect(documentToJSON(d)).toEqual({
      type: 'doc',
      content: [{ type: 'paragraph', attrs: { id: 'doc-1:p0' } }],
    })
  })
  it('an editor bound to a seeded document does not add another first paragraph', () => {
    const doc = new Y.Doc()
    Y.applyUpdate(doc, initialDocumentState('doc-2'))
    const e1 = new Editor({
      element: document.createElement('div'),
      extensions: manuscriptExtensions({ collaboration: { document: doc } }),
    })
    const e2 = new Editor({
      element: document.createElement('div'),
      extensions: manuscriptExtensions({ collaboration: { document: doc } }),
    })
    e1.commands.insertContent('Hello')
    expect(documentToJSON(doc).content).toHaveLength(1)
    e1.destroy()
    e2.destroy()
  })
})

describe('replaceDocumentContent (restore)', () => {
  it('turns the live document into the given content as a forward change that other replicas receive', async () => {
    const { replaceDocumentContent } = await import('../src/server.ts')
    const a = documentFromJSON({
      type: 'doc',
      content: [{ type: 'paragraph', attrs: { id: 'p1' }, content: [{ type: 'text', text: 'New draft.' }] }],
    })
    const b = new Y.Doc()
    Y.applyUpdate(b, Y.encodeStateAsUpdate(a))
    a.on('update', (u: Uint8Array) => Y.applyUpdate(b, u))
    const old = {
      type: 'doc',
      content: [
        { type: 'paragraph', attrs: { id: 'p0' }, content: [{ type: 'text', text: 'First draft.' }] },
      ],
    }
    replaceDocumentContent(a, old)
    expect(documentToJSON(a)).toEqual(old)
    expect(documentToJSON(b)).toEqual(old)
  })
})

describe('forms of writing (schema v3)', () => {
  const editor = (content: string) =>
    new Editor({ element: document.createElement('div'), extensions: manuscriptExtensions(), content })
  const doc = {
    type: 'doc',
    content: [
      { type: 'paragraph', content: [{ type: 'text', text: 'Before.' }] },
      { type: 'sceneBreak' },
      { type: 'verse', content: [{ type: 'text', text: 'The tide comes in,\n  then goes out.' }] },
      {
        type: 'callout',
        attrs: { tone: 'abstract' },
        content: [{ type: 'paragraph', content: [{ type: 'text', text: 'We study tides.' }] }],
      },
      {
        type: 'paragraph',
        content: [
          { type: 'text', text: 'A claim' },
          { type: 'note', attrs: { kind: 'citation', text: 'Okafor (2026), Tides.' } },
          { type: 'text', text: ' and an aside' },
          { type: 'note', attrs: { kind: 'footnote', text: 'Not always.' } },
          { type: 'text', text: '.' },
        ],
      },
      {
        type: 'table',
        content: [
          {
            type: 'tableRow',
            content: [
              {
                type: 'tableHeader',
                content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Tide' }] }],
              },
              {
                type: 'tableHeader',
                content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Height' }] }],
              },
            ],
          },
          {
            type: 'tableRow',
            content: [
              {
                type: 'tableCell',
                content: [{ type: 'paragraph', content: [{ type: 'text', text: 'High' }] }],
              },
              {
                type: 'tableCell',
                content: [{ type: 'paragraph', content: [{ type: 'text', text: '4m' }] }],
              },
            ],
          },
        ],
      },
      {
        type: 'taskList',
        content: [
          {
            type: 'taskItem',
            attrs: { checked: true },
            content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Draft' }] }],
          },
        ],
      },
    ],
  }

  it('survive the collaborative round trip (Y.Doc) with ids, tones, notes and line breaks intact', () => {
    const back = documentToJSON(documentFromJSON(doc as never))
    const types = back.content!.map((b) => b.type)
    expect(types).toEqual(['paragraph', 'sceneBreak', 'verse', 'callout', 'paragraph', 'table', 'taskList'])
    expect(back.content![2]!.content![0]!.text).toBe('The tide comes in,\n  then goes out.')
    expect(back.content![3]!.attrs?.tone).toBe('abstract')
    expect(back.content![4]!.content!.find((n) => n.type === 'note')?.attrs).toMatchObject({
      kind: 'citation',
      text: 'Okafor (2026), Tides.',
    })
  })

  it('notes are not words; verse keeps its lines', () => {
    const text = plainText(doc as never)
    expect(text).toContain('A claim and an aside.')
    expect(text).not.toContain('Okafor')
    expect(text).toContain('The tide comes in,\n  then goes out.')
  })

  it('"***" on its own line becomes a scene break; Enter in verse is a new line, twice leaves it', () => {
    const e = editor('<p></p>')
    e.commands.focus('end')
    e.commands.insertContent('***')
    const at = e.state.selection.from
    // typing the final space is what triggers the rule, as for real
    e.view.someProp('handleTextInput', (f) =>
      f(e.view, at, at, ' ', () => e.state.tr.insertText(' ', at, at)),
    )
    expect(e.getJSON().content!.map((b) => b.type)).toContain('sceneBreak')

    const v = editor('<div data-verse>one</div>')
    v.commands.focus('end')
    v.commands.keyboardShortcut('Enter')
    v.commands.insertContent('two')
    v.commands.keyboardShortcut('Enter')
    v.commands.keyboardShortcut('Enter')
    const out = v.getJSON().content!
    expect(out[0]).toMatchObject({ type: 'verse', content: [{ text: 'one\ntwo' }] })
    expect(out[1]!.type).toBe('paragraph')
    e.destroy()
    v.destroy()
  })
})

describe('concurrent typing next to a deleted letter (R2-B1)', () => {
  // Two replicas apart (one offline): A types where B deletes. Each letter A types must stay A's, even when it is
  // the same letter as the one right after the caret — the editor→Yjs diff must not credit it to that letter.
  const pair = (text: string) => {
    const seed = new Y.Doc()
    const s = new Editor({
      element: document.createElement('div'),
      extensions: manuscriptExtensions({ collaboration: { document: seed } }),
    })
    s.commands.setContent(`<p>${text}</p>`)
    const replica = () => {
      const doc = new Y.Doc()
      Y.applyUpdate(doc, Y.encodeStateAsUpdate(seed))
      const e = new Editor({
        element: document.createElement('div'),
        extensions: manuscriptExtensions({ collaboration: { document: doc } }),
      })
      return { doc, e }
    }
    s.destroy()
    return [replica(), replica()] as const
  }
  const type = (e: Editor, at: number, s: string) => {
    e.commands.setTextSelection(at)
    for (const ch of s) e.view.dispatch(e.state.tr.insertText(ch)) // one transaction per keystroke, at the caret
  }
  const merge = (a: Y.Doc, b: Y.Doc) => {
    Y.applyUpdate(a, Y.encodeStateAsUpdate(b))
    Y.applyUpdate(b, Y.encodeStateAsUpdate(a))
  }

  it('keeps a letter typed right before the same letter a co-writer deletes', () => {
    const [a, b] = pair('Keep this start. Doomed sentence here. Keep this end.')
    type(a.e, 1 + 'Keep this start. Doomed '.length, 'willow words ')
    expect(a.e.getText()).toBe('Keep this start. Doomed willow words sentence here. Keep this end.')
    const from = 1 + 'Keep this start. '.length
    b.e.commands.deleteRange({ from, to: from + 'Doomed sentence here. '.length })
    merge(a.doc, b.doc)
    expect(a.e.getText()).toBe('Keep this start. willow words Keep this end.')
    expect(b.e.getText()).toBe(a.e.getText())
    a.e.destroy()
    b.e.destroy()
  })

  it('a change away from the caret leaves the unchanged text after it alone', () => {
    const [a, b] = pair('xab')
    // A's caret sits at the end while something (a command, not typing) changes the "x": only the "x" may be redone,
    // so B's concurrent delete of the "a" stays deleted.
    a.e.commands.setTextSelection(1 + 'xab'.length)
    a.e.view.dispatch(a.e.state.tr.insertText('y', 1, 2))
    expect(a.e.getText()).toBe('yab')
    b.e.commands.deleteRange({ from: 2, to: 3 })
    merge(a.doc, b.doc)
    expect(a.e.getText()).toBe('yb')
    expect(b.e.getText()).toBe(a.e.getText())
    a.e.destroy()
    b.e.destroy()
  })

  it('backspace deletes the letter before the caret, not its identical neighbour', () => {
    const [a, b] = pair('a ssx b')
    // A deletes the first "s" (caret after it); B, apart, deletes the second — together, both are gone.
    const caret = 1 + 'a s'.length
    a.e.commands.setTextSelection(caret)
    a.e.view.dispatch(a.e.state.tr.delete(caret - 1, caret)) // what Backspace does at the caret
    expect(a.e.getText()).toBe('a sx b')
    b.e.commands.deleteRange({ from: 1 + 'a s'.length, to: 1 + 'a ss'.length })
    merge(a.doc, b.doc)
    expect(a.e.getText()).toBe('a x b')
    expect(b.e.getText()).toBe(a.e.getText())
    a.e.destroy()
    b.e.destroy()
  })
})

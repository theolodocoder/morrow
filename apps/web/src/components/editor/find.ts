/**
 * Find within the document (PRD FR-007). A small ProseMirror plugin: highlights every match as a decoration
 * (nothing is written to the document) and tracks the current one. Case-insensitive; matches within text runs.
 */
import { Extension } from '@tiptap/react'
import { Plugin, PluginKey, TextSelection, type EditorState, type Transaction } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'
import type { Node as PMNode } from '@tiptap/pm/model'

export interface FindState {
  query: string
  matches: { from: number; to: number }[]
  index: number
}
export const findKey = new PluginKey<FindState>('morrow-find')

function search(doc: PMNode, query: string) {
  const out: { from: number; to: number }[] = []
  if (!query) return out
  const needle = query.toLocaleLowerCase()
  doc.descendants((node, pos) => {
    if (!node.isText || !node.text) return
    const hay = node.text.toLocaleLowerCase()
    for (let i = hay.indexOf(needle); i !== -1; i = hay.indexOf(needle, i + needle.length))
      out.push({ from: pos + i, to: pos + i + needle.length })
  })
  return out
}

export const Find = Extension.create({
  name: 'find',
  addProseMirrorPlugins() {
    return [
      new Plugin<FindState>({
        key: findKey,
        state: {
          init: () => ({ query: '', matches: [], index: 0 }),
          apply(tr, prev) {
            const meta = tr.getMeta(findKey) as Partial<FindState> | undefined
            if (meta) {
              const query = meta.query ?? prev.query
              const matches = search(tr.doc, query)
              return { query, matches, index: Math.min(meta.index ?? 0, Math.max(matches.length - 1, 0)) }
            }
            if (tr.docChanged && prev.query) {
              const matches = search(tr.doc, prev.query)
              return { ...prev, matches, index: Math.min(prev.index, Math.max(matches.length - 1, 0)) }
            }
            return prev
          },
        },
        props: {
          decorations(state) {
            const f = findKey.getState(state)
            if (!f?.matches.length) return null
            return DecorationSet.create(
              state.doc,
              f.matches.map((m, i) =>
                Decoration.inline(m.from, m.to, {
                  class: i === f.index ? 'find-match find-current' : 'find-match',
                }),
              ),
            )
          },
        },
      }),
    ]
  },
})

/** Set the query and/or move to a match, selecting it and scrolling it into view. */
export function findTransaction(state: EditorState, query: string, index: number): Transaction {
  const matches = search(state.doc, query)
  const i = matches.length ? ((index % matches.length) + matches.length) % matches.length : 0
  const tr = state.tr.setMeta(findKey, { query, index: i })
  const m = matches[i]
  return m ? tr.setSelection(TextSelection.create(state.doc, m.from, m.to)).scrollIntoView() : tr
}

/**
 * Comment highlights and paragraph reaction chips (PRD FR-016/017), drawn as decorations: nothing is ever written
 * into the document. Anchors are re-resolved from their Yjs relative positions after every change, so a highlight
 * always shows where its passage is now, and a passage that's gone is reported as detached.
 */
import { Extension } from '@tiptap/react'
import { Plugin, PluginKey, type EditorState } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'
import { resolveAnchor, type RangeAnchor } from '@morrow/editor/anchors'

export interface FeedbackDecorData {
  threads: { id: string; anchor: RangeAnchor; resolved: boolean }[]
  activeId: string | null
  /** feedback is shown only while the writer opens it: it should never interrupt writing (FR-017) */
  show: boolean
  /** blockId → chip text, e.g. "Beautiful line 2 · Plot twist 1" */
  reactions: Record<string, string>
}
export interface FeedbackStorage {
  data: FeedbackDecorData
  /** thread id → current range, or null when detached */
  positions: Map<string, { from: number; to: number } | null>
  onActivate: (threadId: string) => void
  onPositions: (positions: Map<string, { from: number; to: number } | null>) => void
}

export const feedbackKey = new PluginKey<DecorationSet>('morrow-feedback')

function build(state: EditorState, storage: FeedbackStorage): DecorationSet {
  const { threads, activeId, show, reactions } = storage.data
  const positions = new Map<string, { from: number; to: number } | null>()
  const decos: Decoration[] = []
  for (const t of threads) {
    const r = resolveAnchor(state, t.anchor)
    positions.set(t.id, r)
    if (r && show && !t.resolved)
      decos.push(
        Decoration.inline(
          r.from,
          r.to,
          { class: t.id === activeId ? 'comment-anchor comment-anchor--active' : 'comment-anchor' },
          { threadId: t.id },
        ),
      )
  }
  if (show)
    state.doc.forEach((node, offset) => {
      const label = reactions[String(node.attrs.id)]
      if (!label) return
      decos.push(
        Decoration.widget(
          offset + node.nodeSize - 1,
          () => {
            const chip = document.createElement('span')
            chip.className = 'reaction-chip'
            chip.contentEditable = 'false' // the caret must never enter it (same lesson as remote carets)
            chip.setAttribute('aria-hidden', 'true') // the feedback panel lists reactions accessibly
            chip.textContent = label
            return chip
          },
          { side: 1, ignoreSelection: true, key: `${String(node.attrs.id)}:${label}` },
        ),
      )
    })
  storage.positions = positions
  queueMicrotask(() => storage.onPositions(positions))
  return DecorationSet.create(state.doc, decos)
}

export const FeedbackHighlights = Extension.create<object, FeedbackStorage>({
  name: 'feedbackHighlights',
  addStorage() {
    return {
      data: { threads: [], activeId: null, show: false, reactions: {} },
      positions: new Map(),
      onActivate: () => {},
      onPositions: () => {},
    }
  },
  addProseMirrorPlugins() {
    const storage = this.storage
    let frame = 0
    return [
      new Plugin({
        key: feedbackKey,
        state: {
          init: () => DecorationSet.empty,
          // Local edits update the Yjs binding only after this transaction applies, so map now and re-resolve on the
          // next frame (see `view.update`); explicit rebuilds and remote changes resolve straight away.
          apply: (tr, old, _prev, next) =>
            tr.getMeta(feedbackKey)
              ? build(next, storage)
              : tr.docChanged
                ? old.map(tr.mapping, tr.doc)
                : old,
        },
        props: {
          decorations: (state) => feedbackKey.getState(state),
          handleClick: (view, pos) => {
            const hit = feedbackKey
              .getState(view.state)
              ?.find(pos, pos, (spec) => typeof spec.threadId === 'string')[0]
            if (hit) storage.onActivate(hit.spec.threadId as string)
            return false // never swallow the click: placing the caret still works
          },
        },
        view: () => ({
          update: (view, prevState) => {
            if (view.state.doc === prevState.doc) return
            cancelAnimationFrame(frame)
            frame = requestAnimationFrame(() => {
              if (!view.isDestroyed)
                view.dispatch(view.state.tr.setMeta(feedbackKey, 'rebuild').setMeta('addToHistory', false))
            })
          },
          destroy: () => cancelAnimationFrame(frame),
        }),
      }),
    ]
  },
})

/** Push new feedback data into the editor and redraw. */
export function setFeedback(
  view: { state: EditorState; dispatch: (tr: EditorState['tr']) => void; isDestroyed: boolean },
  storage: FeedbackStorage,
  data: Partial<FeedbackDecorData>,
) {
  storage.data = { ...storage.data, ...data }
  if (!view.isDestroyed)
    view.dispatch(view.state.tr.setMeta(feedbackKey, 'rebuild').setMeta('addToHistory', false))
}

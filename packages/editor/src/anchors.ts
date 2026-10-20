/**
 * Comment anchors (PRD FR-016): ProseMirror ranges ⇄ Yjs relative positions. A relative position points at a CRDT
 * item, not an offset, so the anchor follows its passage through everyone's concurrent edits. Browser-side: it needs
 * the live editor's Yjs binding.
 */
import * as Y from 'yjs'
import type { EditorState } from '@tiptap/pm/state'
import {
  absolutePositionToRelativePosition,
  relativePositionToAbsolutePosition,
  ySyncPluginKey,
} from '@tiptap/y-tiptap'

export interface RangeAnchor {
  start: unknown
  end: unknown
}

function binding(state: EditorState) {
  const sync = ySyncPluginKey.getState(state)
  if (!sync?.binding) return null
  return { doc: sync.doc, type: sync.type, mapping: sync.binding.mapping }
}

/** Anchor a selection. Start sticks to the text after it and end to the text before it, so typing at either edge
 * doesn't stretch the comment over new words. */
export function anchorRange(state: EditorState, from: number, to: number): RangeAnchor | null {
  const b = binding(state)
  if (!b || to <= from) return null
  const start = absolutePositionToRelativePosition(from, b.type, b.mapping)
  const end = absolutePositionToRelativePosition(to, b.type, b.mapping)
  end.assoc = -1
  return { start: Y.relativePositionToJSON(start), end: Y.relativePositionToJSON(end) }
}

/**
 * Where an anchor points now, or null when its passage is gone (deleted, or collapsed to nothing): the comment is
 * then shown as detached rather than pinned to unrelated text (FR-016 acceptance criteria).
 */
export function resolveAnchor(state: EditorState, anchor: RangeAnchor): { from: number; to: number } | null {
  const b = binding(state)
  if (!b) return null
  try {
    const from = relativePositionToAbsolutePosition(
      b.doc,
      b.type,
      Y.createRelativePositionFromJSON(anchor.start),
      b.mapping,
    )
    const to = relativePositionToAbsolutePosition(
      b.doc,
      b.type,
      Y.createRelativePositionFromJSON(anchor.end),
      b.mapping,
    )
    if (from === null || to === null || to <= from) return null
    return { from, to }
  } catch {
    return null // malformed or from another document
  }
}

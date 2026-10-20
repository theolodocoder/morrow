/**
 * Blocks for the kinds of writing Morrow is for (schema v3): scene breaks for fiction, verse for poetry, callouts for
 * articles and teaching material, and footnotes and citations for essays, books and papers. All additive: documents
 * from earlier versions load unchanged.
 */
import { Node, mergeAttributes, nodeInputRule } from '@tiptap/core'
import HorizontalRule from '@tiptap/extension-horizontal-rule'
import { TextSelection } from '@tiptap/pm/state'

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    sceneBreak: { insertSceneBreak: () => ReturnType }
    verse: { setVerse: () => ReturnType; toggleVerse: () => ReturnType }
    callout: {
      setCallout: (tone?: CalloutTone) => ReturnType
      toggleCallout: (tone?: CalloutTone) => ReturnType
    }
    note: { insertNote: (kind: NoteKind, text?: string) => ReturnType }
  }
}

export const CALLOUT_TONES = ['note', 'tip', 'warning', 'abstract'] as const
export type CalloutTone = (typeof CALLOUT_TONES)[number]
export const NOTE_KINDS = ['footnote', 'citation'] as const
export type NoteKind = (typeof NOTE_KINDS)[number]

/** A break between scenes (⁂). Not a rule: it's part of the story's rhythm, and reads as a pause. */
export const SceneBreak = Node.create({
  name: 'sceneBreak',
  group: 'block',
  atom: true,
  selectable: true,
  draggable: true,
  parseHTML: () => [{ tag: 'div[data-scene-break]' }],
  renderHTML: ({ HTMLAttributes }) => [
    'div',
    mergeAttributes(HTMLAttributes, { 'data-scene-break': '', class: 'scene-break', role: 'separator' }),
  ],
  addCommands() {
    return {
      insertSceneBreak:
        () =>
        ({ chain }) =>
          chain()
            .insertContent([{ type: this.name }, { type: 'paragraph' }])
            .run(),
    }
  },
  addInputRules() {
    // "***" then a space on its own line, the manuscript convention (a plain divider is "---")
    return [nodeInputRule({ find: /^\*\*\*\s$/, type: this.type })]
  },
})

/**
 * Verse: line breaks and indentation are the poem, so they're kept exactly. Enter starts a new line; Enter on an
 * empty last line (or Mod-Enter) leaves the stanza.
 */
export const Verse = Node.create({
  name: 'verse',
  group: 'block',
  content: 'text*',
  marks: 'bold italic underline strike highlight',
  whitespace: 'pre',
  defining: true,
  parseHTML: () => [{ tag: 'div[data-verse]', preserveWhitespace: 'full' }],
  renderHTML: ({ HTMLAttributes }) => [
    'div',
    mergeAttributes(HTMLAttributes, { 'data-verse': '', class: 'verse' }),
    0,
  ],
  addCommands() {
    return {
      setVerse:
        () =>
        ({ commands }) =>
          commands.setNode(this.name),
      toggleVerse:
        () =>
        ({ commands }) =>
          commands.toggleNode(this.name, 'paragraph'),
    }
  },
  addKeyboardShortcuts() {
    /** Leave the verse: a new paragraph after it (dropping a trailing empty line first). */
    const leave = (dropTrailing: boolean) =>
      this.editor.commands.command(({ tr, state }) => {
        const { $from } = state.selection
        const after = $from.after()
        if (dropTrailing) tr.delete($from.pos - 1, $from.pos)
        const at = tr.mapping.map(after)
        tr.insert(at, state.schema.nodes.paragraph!.create())
        tr.setSelection(TextSelection.create(tr.doc, at + 1))
        return true
      })
    return {
      Enter: () => {
        const { $from, empty } = this.editor.state.selection
        if ($from.parent.type.name !== this.name || !empty) return false
        const text = $from.parent.textContent
        const atEnd = $from.parentOffset === $from.parent.content.size
        if (atEnd && (text === '' || text.endsWith('\n'))) return leave(text.endsWith('\n'))
        return this.editor.commands.command(({ tr }) => {
          tr.insertText('\n')
          return true
        })
      },
      'Mod-Enter': () => (this.editor.isActive(this.name) ? leave(false) : false),
    }
  },
})

/** A boxed aside: a note, a tip, a warning, or a paper's abstract. Holds ordinary paragraphs and lists. */
export const Callout = Node.create({
  name: 'callout',
  group: 'block',
  content: '(paragraph | bulletList | orderedList)+',
  defining: true,
  addAttributes: () => ({
    tone: {
      default: 'note',
      parseHTML: (el) => {
        const t = el.getAttribute('data-tone')
        return (CALLOUT_TONES as readonly string[]).includes(t ?? '') ? t : 'note'
      },
      renderHTML: (attrs) => ({ 'data-tone': attrs.tone }),
    },
  }),
  addKeyboardShortcuts() {
    const inCallout = () => this.editor.state.selection.$from.node(-1)?.type.name === this.name
    return {
      // Enter on an empty last line leaves the box (as in lists); Backspace at the very start unwraps it.
      Enter: () => {
        const { $from, empty } = this.editor.state.selection
        if (!empty || !inCallout() || $from.parent.content.size > 0) return false
        if ($from.index(-1) !== $from.node(-1).childCount - 1) return false
        return this.editor.commands.lift(this.name)
      },
      Backspace: () => {
        const { $from, empty } = this.editor.state.selection
        if (!empty || !inCallout() || $from.parentOffset > 0 || $from.index(-1) !== 0) return false
        return this.editor.commands.lift(this.name)
      },
    }
  },
  parseHTML: () => [{ tag: 'aside[data-callout]' }],
  renderHTML: ({ HTMLAttributes }) => [
    'aside',
    mergeAttributes(HTMLAttributes, { 'data-callout': '', class: 'callout' }),
    0,
  ],
  addCommands() {
    return {
      setCallout:
        (tone = 'note') =>
        ({ commands }) =>
          commands.wrapIn(this.name, { tone }),
      toggleCallout:
        (tone = 'note') =>
        ({ commands }) =>
          commands.toggleWrap(this.name, { tone }),
    }
  },
})

/**
 * A footnote or citation: a numbered marker in the text, with its note kept in the marker itself (so it moves with the
 * sentence, and merges and proposals carry it). Readers get the notes listed at the end, in order.
 */
export const Note = Node.create({
  name: 'note',
  group: 'inline',
  inline: true,
  atom: true,
  selectable: true,
  addAttributes: () => ({
    kind: {
      default: 'footnote',
      parseHTML: (el) => (el.getAttribute('data-note') === 'citation' ? 'citation' : 'footnote'),
      renderHTML: (attrs) => ({ 'data-note': attrs.kind }),
    },
    text: {
      default: '',
      parseHTML: (el) => el.getAttribute('data-text') ?? '',
      renderHTML: (attrs) => ({ 'data-text': attrs.text, title: attrs.text }),
    },
  }),
  parseHTML: () => [{ tag: 'sup[data-note]' }],
  renderHTML: ({ HTMLAttributes }) => ['sup', mergeAttributes(HTMLAttributes, { class: 'note-marker' })],
  // Not part of the sentence's words (word counts, search, diffs).
  renderText: () => '',
  addCommands() {
    return {
      insertNote:
        (kind, text = '') =>
        ({ commands }) =>
          commands.insertContent({ type: this.name, attrs: { kind, text } }),
    }
  },
})

/** A plain divider, typed as "---" (or "___ "). "***" belongs to the scene break. */
export const Divider = HorizontalRule.extend({
  addInputRules() {
    return [nodeInputRule({ find: /^(?:---|—-|___\s)$/, type: this.type })]
  },
})

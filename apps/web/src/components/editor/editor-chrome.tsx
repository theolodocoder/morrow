'use client'
/**
 * The editor's quiet chrome (Notion-like): nothing shows until it's useful.
 * - Block handle: hover a block for + (add a block below) and ⋮⋮ (drag to move; click for turn into, duplicate, delete).
 * - Note editor: select a footnote or citation marker to write its text.
 * - Table bar: inside a table, add or remove rows and columns.
 */
import { useState } from 'react'
import { useEditorState, type Editor } from '@tiptap/react'
import { BubbleMenu } from '@tiptap/react/menus'
import { DragHandle } from '@tiptap/extension-drag-handle-react'
import { NodeSelection } from '@tiptap/pm/state'
import type { Node as PMNode } from '@tiptap/pm/model'
import { ActionMenu } from '@/components/ui/menu'
import { Icon, PlusIcon, TrashIcon } from '@/components/ui/icons'
import { BLOCKS } from './blocks'

const GripIcon = () => (
  <Icon size={16}>
    <path d="M7.5 5h.01M7.5 10h.01M7.5 15h.01M12.5 5h.01M12.5 10h.01M12.5 15h.01" strokeWidth={2.4} />
  </Icon>
)

const handleButton =
  'grid size-6 place-items-center rounded-sm text-tertiary outline-none hover:bg-hover hover:text-primary focus-visible:ring-2 focus-visible:ring-focus'

export function BlockHandle({ editor }: { editor: Editor }) {
  const [target, setTarget] = useState<{ node: PMNode; pos: number } | null>(null)
  if (!editor.isEditable) return null

  /** Put the cursor at the start of the hovered block so block commands act on it. */
  const focusTarget = () => {
    if (!target) return false
    const inside = target.node.isTextblock ? target.pos + 1 : target.pos
    if (target.node.isAtom) editor.commands.setNodeSelection(target.pos)
    else editor.commands.setTextSelection(inside)
    return true
  }
  const turnInto = BLOCKS.filter((b) => b.turnInto).map((b) => ({
    id: `turn-${b.id}`,
    label: `Turn into ${b.label.toLowerCase()}`,
    icon: b.icon,
    onAction: () => {
      if (focusTarget()) b.run(editor)
    },
  }))

  return (
    <DragHandle
      editor={editor}
      onNodeChange={({ node, pos }) => setTarget(node ? { node, pos } : null)}
      className="flex items-center gap-0.5 pr-2"
    >
      <button
        type="button"
        aria-label="Add a block below"
        title="Add a block below"
        className={handleButton}
        onClick={() => {
          if (!target) return
          const after = target.pos + target.node.nodeSize
          editor
            .chain()
            .focus()
            .insertContentAt(after, { type: 'paragraph' })
            .setTextSelection(after + 1)
            .insertContent('/')
            .run()
        }}
      >
        <PlusIcon size={16} />
      </button>
      <ActionMenu
        label="Block options (drag to move)"
        trigger={<GripIcon />}
        actions={[
          ...(target?.node.isTextblock ? turnInto : []),
          {
            id: 'duplicate',
            label: 'Duplicate',
            onAction: () => {
              if (!target) return
              const json = target.node.toJSON() as { attrs?: Record<string, unknown> }
              // a copy is a new block: it must not share the original's id (comments and proposals rely on it)
              if (json.attrs) delete json.attrs.id
              editor
                .chain()
                .focus()
                .insertContentAt(target.pos + target.node.nodeSize, json)
                .run()
            },
          },
          {
            id: 'delete',
            label: 'Delete',
            tone: 'danger',
            icon: <TrashIcon size={16} />,
            onAction: () => {
              if (!target) return
              editor
                .chain()
                .focus()
                .deleteRange({ from: target.pos, to: target.pos + target.node.nodeSize })
                .run()
            },
          },
        ]}
      />
    </DragHandle>
  )
}

const isNoteSelected = (e: Editor) =>
  e.state.selection instanceof NodeSelection && e.state.selection.node.type.name === 'note'
// Stable references: a new function or options object on each render makes the bubble menu re-register and replace
// its DOM, which drops focus from the note's text box mid-typing.
const showNote = ({ editor: e }: { editor: Editor }) => isNoteSelected(e)
const NOTE_OPTIONS = {
  placement: 'bottom',
  // A new, empty note: straight to typing, once the menu is actually showing (it can't take focus while hidden).
  onShow: () =>
    requestAnimationFrame(() =>
      document.querySelector<HTMLTextAreaElement>('textarea[data-note-text][data-empty="true"]')?.focus(),
    ),
} as const
const showTable = ({ editor: e }: { editor: Editor }) =>
  e.isEditable && e.isActive('table') && e.state.selection.empty
const TABLE_OPTIONS = { placement: 'top' } as const

/** Write a footnote's or citation's text right where it is. */
export function NoteEditor({ editor }: { editor: Editor }) {
  // Tiptap doesn't re-render React per transaction: follow the selection explicitly.
  const state = useEditorState({
    editor,
    selector: ({ editor: e }) => {
      const s = e.state.selection
      const n = s instanceof NodeSelection && s.node.type.name === 'note' ? s.node : null
      return n
        ? { from: s.from, to: s.to, kind: String(n.attrs.kind), text: String(n.attrs.text ?? '') }
        : null
    },
  })
  const note = state
  const sel = { from: state?.from ?? 0, to: state?.to ?? 0 }
  const kind = note?.kind === 'citation' ? 'citation' : 'footnote'
  return (
    <BubbleMenu editor={editor} pluginKey="noteEditor" shouldShow={showNote} options={NOTE_OPTIONS}>
      {note && (
        <div
          role="dialog"
          aria-label={kind === 'citation' ? 'Citation' : 'Footnote'}
          className="flex w-[min(340px,calc(100vw-2rem))] flex-col gap-2 rounded-md border border-subtle bg-raised p-3 font-ui shadow-[0_2px_4px_rgb(34_34_31/.06),0_12px_32px_rgb(34_34_31/.16)]"
        >
          <div className="flex items-center justify-between">
            <div role="radiogroup" aria-label="Kind" className="flex gap-1">
              {(['footnote', 'citation'] as const).map((k) => (
                <button
                  key={k}
                  type="button"
                  role="radio"
                  aria-checked={kind === k}
                  disabled={!editor.isEditable}
                  onClick={() => editor.commands.updateAttributes('note', { kind: k })}
                  className="rounded-sm px-2 py-0.5 text-[12px] text-secondary outline-none aria-checked:bg-selected aria-checked:text-primary focus-visible:ring-2 focus-visible:ring-focus"
                >
                  {k === 'footnote' ? 'Footnote' : 'Citation'}
                </button>
              ))}
            </div>
            {editor.isEditable && (
              <button
                type="button"
                aria-label="Remove"
                onClick={() => editor.chain().focus().deleteSelection().run()}
                className="grid size-7 place-items-center rounded-sm text-secondary hover:bg-hover hover:text-danger"
              >
                <TrashIcon size={15} />
              </button>
            )}
          </div>
          <NoteText key={`${sel.from}-${kind}`} editor={editor} kind={kind} initial={note.text} at={sel.to} />
        </div>
      )}
    </BubbleMenu>
  )
}

const tableButton =
  'h-7 rounded-sm px-2 text-[12px] font-medium outline-none hover:bg-[rgb(255_255_255/.12)] focus-visible:ring-2 focus-visible:ring-focus'

/** Rows and columns, only while the cursor is in a table. */
export function TableBar({ editor }: { editor: Editor }) {
  return (
    <BubbleMenu editor={editor} pluginKey="tableBar" shouldShow={showTable} options={TABLE_OPTIONS}>
      <div
        role="toolbar"
        aria-label="Table"
        className="flex items-center gap-0.5 rounded-md bg-primary p-1 font-ui text-canvas shadow-[0_6px_16px_rgb(34_34_31/.18)]"
      >
        {(
          [
            ['+ Row', () => editor.chain().focus().addRowAfter().run()],
            ['+ Column', () => editor.chain().focus().addColumnAfter().run()],
            ['− Row', () => editor.chain().focus().deleteRow().run()],
            ['− Column', () => editor.chain().focus().deleteColumn().run()],
            ['Header row', () => editor.chain().focus().toggleHeaderRow().run()],
          ] as const
        ).map(([label, run]) => (
          <button
            key={label}
            type="button"
            onMouseDown={(e) => e.preventDefault()}
            onClick={run}
            className={tableButton}
          >
            {label}
          </button>
        ))}
        <span aria-hidden="true" className="mx-1 h-5 w-px bg-[rgb(255_255_255/.25)]" />
        <button
          type="button"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => editor.chain().focus().deleteTable().run()}
          className={tableButton}
        >
          Delete table
        </button>
      </div>
    </BubbleMenu>
  )
}

/**
 * The note's text is kept here while typing and written to the document on Done, Escape, Mod+Enter or leaving the
 * box: one change per edit (not per keystroke), and the popover never re-renders under the writer's cursor.
 */
function NoteText({
  editor,
  kind,
  initial,
  at,
}: {
  editor: Editor
  kind: 'footnote' | 'citation'
  initial: string
  at: number
}) {
  const [text, setText] = useState(initial)
  const commit = () => {
    if (text !== initial && isNoteSelected(editor)) editor.commands.updateAttributes('note', { text })
  }
  const back = () => {
    commit()
    editor.commands.setTextSelection(at)
    // Synchronously: Tiptap's focus command waits a frame, and a key typed in that gap would land on the page.
    editor.view.focus()
  }
  return (
    <>
      <textarea
        aria-label={kind === 'citation' ? 'Source' : 'Footnote text'}
        placeholder={
          kind === 'citation'
            ? 'Author, Title (Year), publisher or link'
            : 'The note readers will find at the end of the chapter'
        }
        readOnly={!editor.isEditable}
        rows={3}
        data-note-text=""
        data-empty={!initial && editor.isEditable}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Escape' || (e.key === 'Enter' && (e.metaKey || e.ctrlKey))) {
            e.preventDefault()
            back()
          }
        }}
        className="w-full resize-y rounded-sm border border-control bg-app px-2.5 py-2 text-[14px] text-primary outline-none placeholder:text-tertiary focus:ring-2 focus:ring-focus"
      />
      <div className="flex items-center justify-between">
        <p className="text-[11px] text-tertiary">Esc or Done to go back to writing.</p>
        {editor.isEditable && (
          <button
            type="button"
            onClick={back}
            className="h-7 rounded-full bg-action px-3 text-[12px] font-medium text-action-fg outline-none hover:bg-action-hover focus-visible:ring-2 focus-visible:ring-focus"
          >
            Done
          </button>
        )}
      </div>
    </>
  )
}

'use client'
/**
 * Writing on a phone (design/product-redesign.md §7): a toolbar pinned just above the on-screen keyboard while you
 * write, instead of a floating bubble that fights the phone's own selection menu. `+` opens every block as a sheet.
 * Shown below the `md` breakpoint only; desktop keeps "/", the block handle and the selection toolbar.
 */
import { useEffect, useState } from 'react'
import { useEditorState, type Editor } from '@tiptap/react'
import { Sheet } from '@/components/ui/sheet'
import { BoldIcon, CommentIcon, Icon, ItalicIcon, PlusIcon, QuoteIcon } from '@/components/ui/icons'
import { blocksFor } from './blocks'

const tb =
  'press grid size-11 shrink-0 place-items-center rounded-md text-primary outline-none aria-pressed:bg-selected focus-visible:ring-2 focus-visible:ring-focus disabled:opacity-35'

/** How far the keyboard pushes the toolbar up: the gap between the layout and the visual viewport. */
function useKeyboardInset() {
  const [inset, setInset] = useState(0)
  useEffect(() => {
    const vv = window.visualViewport
    if (!vv) return
    const update = () => setInset(Math.max(0, window.innerHeight - vv.height - vv.offsetTop))
    update()
    vv.addEventListener('resize', update)
    vv.addEventListener('scroll', update)
    return () => {
      vv.removeEventListener('resize', update)
      vv.removeEventListener('scroll', update)
    }
  }, [])
  return inset
}

export function MobileToolbar({
  editor,
  form,
  onComment,
}: {
  editor: Editor
  form?: string
  /** comment on the selection (when the person may comment) */
  onComment?: () => void
}) {
  const inset = useKeyboardInset()
  const [blocks, setBlocks] = useState(false)
  const s = useEditorState({
    editor,
    selector: ({ editor: e }) => ({
      focused: e.isFocused,
      editable: e.isEditable,
      empty: e.state.selection.empty,
      bold: e.isActive('bold'),
      italic: e.isActive('italic'),
      heading: e.isActive('heading'),
      list: e.isActive('bulletList'),
      quote: e.isActive('blockquote'),
      canUndo: e.can().undo?.() ?? false,
      canRedo: e.can().redo?.() ?? false,
    }),
  })
  if (!s.editable || (!s.focused && !blocks)) return null
  // keep focus in the editor: buttons act on mousedown/touch without taking it
  const keep = (e: React.SyntheticEvent) => e.preventDefault()
  return (
    <>
      <div
        role="toolbar"
        aria-label="Formatting"
        style={{ bottom: inset }}
        className="fixed inset-x-0 z-40 flex items-center gap-0.5 overflow-x-auto border-t border-subtle bg-raised px-1.5 py-1 pb-[max(0.25rem,env(safe-area-inset-bottom))] shadow-[0_-4px_16px_rgb(34_34_31/.08)] [scrollbar-width:none] md:hidden"
      >
        <button
          type="button"
          aria-label="Add a block"
          onMouseDown={keep}
          onClick={() => setBlocks(true)}
          className={tb}
        >
          <PlusIcon size={20} />
        </button>
        <span aria-hidden="true" className="mx-0.5 h-6 w-px shrink-0 bg-[var(--border-subtle)]" />
        <button
          type="button"
          aria-label="Bold"
          aria-pressed={s.bold}
          onMouseDown={keep}
          onClick={() => editor.chain().focus().toggleBold().run()}
          className={tb}
        >
          <BoldIcon size={19} />
        </button>
        <button
          type="button"
          aria-label="Italic"
          aria-pressed={s.italic}
          onMouseDown={keep}
          onClick={() => editor.chain().focus().toggleItalic().run()}
          className={tb}
        >
          <ItalicIcon size={19} />
        </button>
        <button
          type="button"
          aria-label="Heading"
          aria-pressed={s.heading}
          onMouseDown={keep}
          onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
          className={tb}
        >
          <Icon size={19}>
            <path d="M4 5v10M11 5v10M4 10h7M14 9l2-1v7" />
          </Icon>
        </button>
        <button
          type="button"
          aria-label="Bulleted list"
          aria-pressed={s.list}
          onMouseDown={keep}
          onClick={() => editor.chain().focus().toggleBulletList().run()}
          className={tb}
        >
          <Icon size={19}>
            <path d="M8 6h8M8 10h8M8 14h8M4.5 6h.01M4.5 10h.01M4.5 14h.01" />
          </Icon>
        </button>
        <button
          type="button"
          aria-label="Quote"
          aria-pressed={s.quote}
          onMouseDown={keep}
          onClick={() => editor.chain().focus().toggleBlockquote().run()}
          className={tb}
        >
          <QuoteIcon size={18} />
        </button>
        {onComment && (
          <button
            type="button"
            aria-label="Comment on the selection"
            disabled={s.empty}
            onMouseDown={keep}
            onClick={onComment}
            className={tb}
          >
            <CommentIcon size={19} />
          </button>
        )}
        <span aria-hidden="true" className="mx-0.5 h-6 w-px shrink-0 bg-[var(--border-subtle)]" />
        <button
          type="button"
          aria-label="Undo"
          disabled={!s.canUndo}
          onMouseDown={keep}
          onClick={() => editor.chain().focus().undo().run()}
          className={tb}
        >
          <Icon size={19}>
            <path d="M7.5 6 4 9.5 7.5 13M4 9.5h8a4 4 0 0 1 0 8h-2" />
          </Icon>
        </button>
        <button
          type="button"
          aria-label="Redo"
          disabled={!s.canRedo}
          onMouseDown={keep}
          onClick={() => editor.chain().focus().redo().run()}
          className={tb}
        >
          <Icon size={19}>
            <path d="M12.5 6 16 9.5 12.5 13M16 9.5H8a4 4 0 0 0 0 8h2" />
          </Icon>
        </button>
        <button
          type="button"
          onMouseDown={keep}
          onClick={() => editor.commands.blur()}
          className="press ml-auto h-11 shrink-0 rounded-md px-3 text-[14px] font-medium text-accent outline-none focus-visible:ring-2 focus-visible:ring-focus"
        >
          Done
        </button>
      </div>
      <Sheet title="Add a block" isOpen={blocks} onOpenChange={setBlocks}>
        <ul className="grid grid-cols-2 gap-1.5">
          {blocksFor(form, '').map((b) => (
            <li key={b.id}>
              <button
                type="button"
                onClick={() => {
                  setBlocks(false)
                  b.run(editor)
                }}
                className="press flex w-full items-center gap-2.5 rounded-md border border-subtle px-2.5 py-2.5 text-left outline-none hover:bg-hover focus-visible:ring-2 focus-visible:ring-focus"
              >
                <span className="grid size-8 shrink-0 place-items-center rounded-sm bg-canvas text-primary">
                  {b.icon}
                </span>
                <span className="min-w-0 text-[14px] text-primary">{b.label}</span>
              </button>
            </li>
          ))}
        </ul>
      </Sheet>
    </>
  )
}

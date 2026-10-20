'use client'
import { useWritingTracker } from './writing-tracker'
import { EditorContent, useEditor, useEditorState, type Editor } from '@tiptap/react'
import { BubbleMenu } from '@tiptap/react/menus'
import { Placeholder } from '@tiptap/extensions'
import CollaborationCaret from '@tiptap/extension-collaboration-caret'
import { Find } from './find'
import { FindBar } from './find-bar'
import type { PresenceUser } from '@/lib/presence'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Selection, TextSelection } from '@tiptap/pm/state'
import { manuscriptExtensions } from '@morrow/editor'
import type { Collab } from './use-collab'
import { REACTION_LABELS, type ReactionKind } from '@morrow/contracts'
import { anchorRange } from '@morrow/editor/anchors'
import { FeedbackHighlights } from './feedback-highlights'
import { BLOCKS, DEFAULT_PLACEHOLDER, PLACEHOLDER } from './blocks'
import { SlashMenu } from './slash-menu'
import { BlockHandle, NoteEditor, TableBar } from './editor-chrome'
import { MobileToolbar } from './mobile-toolbar'
import {
  BoldIcon,
  CodeIcon,
  ChevronDownIcon,
  CommentIcon,
  Icon,
  ItalicIcon,
  LinkIcon,
  MoreIcon,
  ReactIcon,
  StrikeIcon,
  UnderlineIcon,
} from '@/components/ui/icons'

/** A passage someone is about to comment on. */
export interface CommentDraft {
  anchor: { start: unknown; end: unknown }
  quote: string
  blockId: string | null
}
export interface CanvasFeedback {
  canComment: boolean
  reactionKinds: ReactionKind[]
  onComment: (draft: CommentDraft) => void
  onReact: (blockId: string, kind: ReactionKind) => void
}

export function ManuscriptCanvas({
  collab,
  chapterTitle,
  chapterNumber,
  me,
  feedback,
  onEditor,
  form,
}: {
  /** the work's category: orders the "/" menu and sets the typography */
  form?: string
  collab: Collab
  chapterTitle: string
  chapterNumber: number
  me: PresenceUser
  feedback?: CanvasFeedback
  /** the live editor, for the feedback panel (resolving anchors, jumping to passages) */
  onEditor?: (editor: Editor | null) => void
}) {
  const editor = useEditor(
    {
      // Placeholder is presentation only; it adds nothing to the stored schema.
      extensions: [
        ...manuscriptExtensions({ collaboration: { document: collab.doc } }),
        // Shown on the line you're on, only while it's empty: the one hint that blocks exist.
        Placeholder.configure({
          placeholder: ({ editor: e, node }) =>
            e.isEmpty
              ? 'Begin writing…'
              : node.type.name === 'paragraph'
                ? (PLACEHOLDER[form as keyof typeof PLACEHOLDER] ?? DEFAULT_PLACEHOLDER)
                : '',
        }),
        SlashMenu.configure({ form: () => form }),
        Find,
        FeedbackHighlights,
        // Remote carets (design system §11): a 2px caret plus a name flag that fades when the person pauses.
        CollaborationCaret.configure({
          provider: collab.provider,
          user: { id: me.id, name: me.name, color: me.color },
          render: renderCaret,
        }),
      ],
      immediatelyRender: false,
      // The canvas mounts only after first sync, so the role is already known: start in the right state instead of
      // flipping editable a frame later (a click in that gap was ignored and typing landed at the document start).
      editable: !collab.readOnly,
      editorProps: {
        attributes: { 'aria-label': `${chapterTitle} — manuscript`, class: 'ProseMirror' },
        handleDOMEvents: {
          // Clicking the empty space below the text continues writing at the end. Left to the browser, the caret
          // briefly sits at the document start, and fast typing landed there (found in the M2 two-writer test).
          mousedown: (view, event) => {
            const last = view.dom.lastElementChild
            if (event.target !== view.dom || !last || event.clientY <= last.getBoundingClientRect().bottom)
              return false
            event.preventDefault()
            view.focus()
            view.dispatch(view.state.tr.setSelection(Selection.atEnd(view.state.doc)).scrollIntoView())
            return true
          },
        },
      },
    },
    [collab.doc],
  )
  // your own words count toward your daily goal and streak (P-055); read-only views count nothing
  useWritingTracker(editor, !collab.readOnly)

  // Editable only once synced, and never for read-only access (enforced again on the server).
  const [findOpen, setFindOpen] = useState(false)
  // ⌘/Ctrl+F searches this chapter (PRD FR-007) instead of the browser page.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && !e.shiftKey && e.key.toLowerCase() === 'f') {
        e.preventDefault()
        setFindOpen(true)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  useEffect(() => {
    editor?.setEditable(collab.synced && !collab.readOnly)
  }, [editor, collab.synced, collab.readOnly])

  useEffect(() => {
    onEditor?.(editor)
    return () => onEditor?.(null)
  }, [editor, onEditor])

  return (
    <article className="manuscript px-5 pt-12 sm:px-8 lg:pt-24" data-form={form}>
      <header className="mx-auto mb-12 max-w-[68ch]">
        <p className="mb-3 font-mono text-[11px] uppercase tracking-[0.08em] text-tertiary">
          Chapter {chapterNumber}
        </p>
        <h1 className="font-display text-[30px] leading-tight text-primary md:text-[36px] lg:text-[40px]">
          {chapterTitle}
        </h1>
      </header>
      {editor && <FindBar editor={editor} open={findOpen} onClose={() => setFindOpen(false)} />}
      {editor && <SelectionToolbar editor={editor} feedback={feedback} />}
      {editor && collab.synced && !collab.readOnly && <BlockHandle editor={editor} />}
      {editor && <NoteEditor editor={editor} />}
      {editor && <TableBar editor={editor} />}
      {editor && collab.synced && !collab.readOnly && (
        <MobileToolbar
          editor={editor}
          form={form}
          {...(feedback?.canComment
            ? {
                onComment: () => {
                  const draft = draftFrom(editor)
                  if (draft) feedback.onComment(draft)
                },
              }
            : {})}
        />
      )}
      <EditorContent editor={editor} />
    </article>
  )
}

function renderCaret(user: Record<string, unknown>): HTMLElement {
  const color = typeof user.color === 'string' ? user.color : 'var(--text-tertiary)'
  const caret = document.createElement('span')
  caret.className = 'collaboration-carets__caret'
  caret.style.setProperty('--caret-color', color)
  caret.setAttribute('aria-hidden', 'true') // never announce remote caret movement (design system §11)
  // Not editable: otherwise the browser's caret can enter the name label (e.g. on End), ProseMirror can't map
  // that position, and the writer's typing lands in the wrong place.
  caret.contentEditable = 'false'
  const label = document.createElement('span')
  label.className = 'collaboration-carets__label'
  label.textContent = typeof user.name === 'string' ? user.name : 'Someone'
  caret.append(label)
  return caret
}

const isPhone = () => typeof window !== 'undefined' && window.matchMedia('(max-width: 767.98px)').matches

/** The platform's modifier, for shortcut hints (Tiptap's Mod = ⌘ on Apple devices, Ctrl elsewhere). */
const MOD = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform) ? '⌘' : 'Ctrl+'
const SHIFT = MOD === '⌘' ? '⇧' : 'Shift+'

type Tool = {
  label: string
  icon: React.ReactNode
  shortcut?: string
  isActive: (e: Editor) => boolean
  run: (e: Editor) => void
}
const tools: Tool[] = [
  {
    label: 'Bold',
    icon: <BoldIcon />,
    shortcut: `${MOD}B`,
    isActive: (e) => e.isActive('bold'),
    run: (e) => e.chain().focus().toggleBold().run(),
  },
  {
    label: 'Italic',
    icon: <ItalicIcon />,
    shortcut: `${MOD}I`,
    isActive: (e) => e.isActive('italic'),
    run: (e) => e.chain().focus().toggleItalic().run(),
  },
  {
    label: 'Underline',
    icon: <UnderlineIcon />,
    shortcut: `${MOD}U`,
    isActive: (e) => e.isActive('underline'),
    run: (e) => e.chain().focus().toggleUnderline().run(),
  },
  {
    label: 'Highlight',
    icon: (
      <Icon>
        <path d="m11.5 4.5 4 4-6 6H5.5v-4l6-6ZM3.5 17h13" />
      </Icon>
    ),
    shortcut: `${MOD}${SHIFT}H`,
    isActive: (e) => e.isActive('highlight'),
    run: (e) => e.chain().focus().toggleHighlight().run(),
  },
]
/** Less common marks: one tap away under "More", not in the way. */
const moreTools: Tool[] = [
  {
    label: 'Strikethrough',
    icon: <StrikeIcon />,
    shortcut: `${MOD}${SHIFT}S`,
    isActive: (e) => e.isActive('strike'),
    run: (e) => e.chain().focus().toggleStrike().run(),
  },
  {
    label: 'Inline code',
    icon: <CodeIcon />,
    shortcut: `${MOD}E`,
    isActive: (e) => e.isActive('code'),
    run: (e) => e.chain().focus().toggleCode().run(),
  },
  {
    label: 'Superscript',
    icon: (
      <Icon>
        <path d="m3.5 6 7 9M10.5 6l-7 9M13.5 6.5c.4-1 2.8-1.2 2.8.3 0 1.3-2.8 1.8-2.8 3.2h3" />
      </Icon>
    ),
    shortcut: `${MOD}.`,
    isActive: (e) => e.isActive('superscript'),
    run: (e) => e.chain().focus().toggleSuperscript().run(),
  },
  {
    label: 'Subscript',
    icon: (
      <Icon>
        <path d="m3.5 5 7 9M10.5 5l-7 9M13.5 13c.4-1 2.8-1.2 2.8.3 0 1.3-2.8 1.8-2.8 3.2h3" />
      </Icon>
    ),
    shortcut: `${MOD},`,
    isActive: (e) => e.isActive('subscript'),
    run: (e) => e.chain().focus().toggleSubscript().run(),
  },
]

/** The passage under the selection, as a comment draft: a CRDT anchor, the quoted text and its paragraph. */
function draftFrom(editor: Editor): CommentDraft | null {
  const { from, to } = editor.state.selection
  const anchor = anchorRange(editor.state, from, to)
  if (!anchor) return null
  const block = editor.state.doc.resolve(from).node(1)
  return {
    anchor,
    quote: editor.state.doc.textBetween(from, to, ' ').slice(0, 500),
    blockId: typeof block?.attrs.id === 'string' ? block.attrs.id : null,
  }
}

const capsuleButton =
  'h-8 min-w-8 rounded-sm px-2 font-ui text-[13px] font-semibold outline-none hover:bg-[rgb(255_255_255/.12)] focus-visible:ring-2 focus-visible:ring-focus aria-pressed:bg-[rgb(255_255_255/.18)]'

/**
 * An ink capsule above the selection, only while something is selected (design system §9). Writers get formatting;
 * anyone who may give feedback gets Comment and React, readers included (they can select but not edit).
 */
function SelectionToolbar({ editor, feedback }: { editor: Editor; feedback?: CanvasFeedback }) {
  const [mode, setMode] = useState<'format' | 'react' | 'turn' | 'link' | 'more'>('format')
  const reacting = mode === 'react'
  const setReacting = (on: boolean) => setMode(on ? 'react' : 'format')
  // Follow the selection so the active states (bold, the current block) are always right.
  useEditorState({
    editor,
    selector: ({ editor: e }) => ({
      from: e.state.selection.from,
      to: e.state.selection.to,
      active: [...tools, ...moreTools].map((t) => t.isActive(e)).join(''),
      block: BLOCKS.find((b) => b.turnInto && b.isActive?.(e))?.id,
      link: e.isActive('link'),
    }),
  })
  const current = BLOCKS.find((b) => b.turnInto && b.isActive?.(editor)) ?? BLOCKS[0]!
  const canFeedback = !!feedback && (feedback.canComment || feedback.reactionKinds.length > 0)
  // Stable across renders (this toolbar re-renders with the selection): new ones would make the menu re-register.
  const shouldShow = useCallback(
    ({ editor: e, state }: { editor: Editor; state: Editor['state'] }) =>
      // text selections only: a selected footnote, scene break or table cell has its own controls. On phones the
      // keyboard toolbar takes over for writers (the bubble would fight the phone's own selection menu).
      state.selection instanceof TextSelection &&
      !state.selection.empty &&
      (e.isEditable ? !isPhone() : canFeedback),
    [canFeedback],
  )
  const options = useMemo(() => ({ onHide: () => setMode('format') }), [])
  return (
    <BubbleMenu editor={editor} shouldShow={shouldShow} options={options}>
      <div
        role="toolbar"
        aria-label={editor.isEditable ? 'Format text' : 'Feedback'}
        className="flex items-center gap-0.5 rounded-md bg-primary p-1 text-canvas shadow-[0_6px_16px_rgb(34_34_31/.18)]"
      >
        {mode === 'turn' ? (
          <div role="menu" aria-label="Turn into" className="flex max-w-[min(520px,90vw)] flex-wrap gap-0.5">
            {BLOCKS.filter((b) => b.turnInto).map((b) => (
              <button
                key={b.id}
                type="button"
                role="menuitemradio"
                aria-checked={b.id === current.id}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  b.run(editor)
                  setMode('format')
                }}
                className={`${capsuleButton} font-normal aria-checked:bg-[rgb(255_255_255/.18)]`}
              >
                {b.label}
              </button>
            ))}
          </div>
        ) : mode === 'link' ? (
          <LinkInput editor={editor} onDone={() => setMode('format')} />
        ) : mode === 'more' ? (
          moreTools.map((t) => (
            <button
              key={t.label}
              type="button"
              aria-label={t.label}
              title={t.shortcut ? `${t.label} (${t.shortcut})` : t.label}
              aria-pressed={t.isActive(editor)}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => t.run(editor)}
              className={`${capsuleButton} inline-flex items-center justify-center`}
            >
              {t.icon}
            </button>
          ))
        ) : reacting && feedback ? (
          feedback.reactionKinds.map((k) => (
            <button
              key={k}
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => {
                const block = editor.state.doc.resolve(editor.state.selection.from).node(1)
                if (typeof block?.attrs.id === 'string') feedback.onReact(block.attrs.id, k)
                setReacting(false)
              }}
              className={`${capsuleButton} font-normal`}
            >
              {REACTION_LABELS[k]}
            </button>
          ))
        ) : (
          <>
            {editor.isEditable && (
              <button
                type="button"
                aria-label={`Turn into: ${current.label}`}
                aria-haspopup="menu"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => setMode('turn')}
                className={`${capsuleButton} inline-flex items-center gap-1 font-normal`}
              >
                {current.label}
                <ChevronDownIcon size={14} />
              </button>
            )}
            {editor.isEditable && (
              <span aria-hidden="true" className="mx-0.5 h-5 w-px bg-[rgb(255_255_255/.25)]" />
            )}
            {editor.isEditable &&
              tools.map((t) => (
                <button
                  key={t.label}
                  type="button"
                  aria-label={t.label}
                  title={t.shortcut ? `${t.label} (${t.shortcut})` : t.label}
                  aria-pressed={t.isActive(editor)}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => t.run(editor)}
                  className={`${capsuleButton} inline-flex items-center justify-center`}
                >
                  {t.icon}
                </button>
              ))}
            {editor.isEditable && (
              <>
                <button
                  type="button"
                  aria-label="Link"
                  title="Link"
                  aria-pressed={editor.isActive('link')}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => setMode('link')}
                  className={`${capsuleButton} inline-flex items-center justify-center`}
                >
                  <LinkIcon />
                </button>
                <button
                  type="button"
                  aria-label="More formatting"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => setMode('more')}
                  className={`${capsuleButton} inline-flex items-center justify-center`}
                >
                  <MoreIcon />
                </button>
              </>
            )}
            {canFeedback && editor.isEditable && (
              <span aria-hidden="true" className="mx-1 h-5 w-px bg-[rgb(255_255_255/.25)]" />
            )}
            {feedback?.canComment && (
              <button
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  const draft = draftFrom(editor)
                  if (draft) feedback.onComment(draft)
                }}
                className={`${capsuleButton} inline-flex items-center gap-1.5`}
              >
                <CommentIcon size={16} />
                Comment
              </button>
            )}
            {feedback && feedback.reactionKinds.length > 0 && (
              <button
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => setReacting(true)}
                className={`${capsuleButton} inline-flex items-center gap-1.5`}
              >
                <ReactIcon size={16} />
                React
              </button>
            )}
          </>
        )}
      </div>
    </BubbleMenu>
  )
}

/** Add, change or remove a link on the selection. Only http(s) and mailto are accepted (the schema enforces it too). */
function LinkInput({ editor, onDone }: { editor: Editor; onDone: () => void }) {
  const existing = editor.getAttributes('link').href as string | undefined
  const [href, setHref] = useState(existing ?? '')
  const apply = () => {
    const url = href.trim()
    if (!url) editor.chain().focus().extendMarkRange('link').unsetLink().run()
    else {
      const full = /^[a-z]+:/i.test(url) ? url : `https://${url}`
      editor.chain().focus().extendMarkRange('link').setLink({ href: full }).run()
    }
    onDone()
  }
  return (
    <form
      className="flex items-center gap-1"
      onSubmit={(e) => {
        e.preventDefault()
        apply()
      }}
    >
      <input
        autoFocus
        aria-label="Link address"
        placeholder="Paste or type a link"
        value={href}
        onChange={(e) => setHref(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.preventDefault()
            editor.commands.focus()
            onDone()
          }
        }}
        className="h-8 w-56 rounded-sm bg-[rgb(255_255_255/.1)] px-2 font-ui text-[13px] text-canvas outline-none placeholder:text-[rgb(255_255_255/.55)] focus:ring-2 focus:ring-focus"
      />
      <button type="submit" className={`${capsuleButton} font-normal`}>
        {href.trim() ? 'Apply' : existing ? 'Remove' : 'Cancel'}
      </button>
    </form>
  )
}

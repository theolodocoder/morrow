'use client'
import { useEffect, useRef, useState } from 'react'
import type { Editor } from '@tiptap/react'
import { findKey, findTransaction } from './find'
import { CloseIcon } from '@/components/ui/icons'

/** ⌘/Ctrl+F opens it; Enter / Shift+Enter move between matches; Escape closes and returns to the text. */
export function FindBar({ editor, open, onClose }: { editor: Editor; open: boolean; onClose: () => void }) {
  const input = useRef<HTMLInputElement>(null)
  const [query, setQuery] = useState('')
  const [, rerender] = useState(0)
  const state = findKey.getState(editor.state)

  useEffect(() => {
    const onTx = () => rerender((n) => n + 1)
    editor.on('transaction', onTx)
    return () => {
      editor.off('transaction', onTx)
    }
  }, [editor])
  useEffect(() => {
    if (open) {
      input.current?.focus()
      input.current?.select()
    }
  }, [open])

  if (!open) return null
  const go = (index: number, q = query) => editor.view.dispatch(findTransaction(editor.state, q, index))
  const close = () => {
    editor.view.dispatch(editor.state.tr.setMeta(findKey, { query: '', index: 0 }))
    onClose()
    editor.commands.focus()
  }
  const total = state?.matches.length ?? 0
  const current = total ? (state?.index ?? 0) + 1 : 0

  return (
    <div
      role="search"
      className="sticky top-2 z-10 mx-auto mb-4 flex w-fit items-center gap-2 rounded-md border border-subtle bg-raised px-2 py-1.5 shadow-[0_1px_2px_rgb(34_34_31/.06),0_6px_16px_rgb(34_34_31/.08)]"
    >
      <label htmlFor="find-input" className="sr-only">
        Find in chapter
      </label>
      <input
        id="find-input"
        ref={input}
        value={query}
        placeholder="Find in chapter"
        spellCheck={false}
        onChange={(e) => {
          setQuery(e.target.value)
          go(0, e.target.value)
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault()
            go((state?.index ?? 0) + (e.shiftKey ? -1 : 1))
          }
          if (e.key === 'Escape') {
            e.preventDefault()
            close()
          }
        }}
        className="h-8 w-56 rounded-sm border border-control bg-canvas px-2 font-ui text-[14px] text-primary outline-none focus:ring-2 focus:ring-focus"
      />
      <span aria-live="polite" className="w-16 text-center font-mono text-[11px] text-tertiary">
        {query ? `${current} of ${total}` : ''}
      </span>
      <button
        type="button"
        aria-label="Previous match"
        disabled={!total}
        onClick={() => go((state?.index ?? 0) - 1)}
        className="size-8 rounded-sm text-secondary hover:bg-hover disabled:opacity-40"
      >
        ↑
      </button>
      <button
        type="button"
        aria-label="Next match"
        disabled={!total}
        onClick={() => go((state?.index ?? 0) + 1)}
        className="size-8 rounded-sm text-secondary hover:bg-hover disabled:opacity-40"
      >
        ↓
      </button>
      <button
        type="button"
        aria-label="Close find"
        onClick={close}
        className="inline-flex size-8 items-center justify-center rounded-sm text-secondary hover:bg-hover"
      >
        <CloseIcon size={16} />
      </button>
    </div>
  )
}

'use client'
import { useEffect, useId, useRef, useState } from 'react'
import { flushSync } from 'react-dom'
import type { Mentionable } from '@morrow/contracts'
import { api } from '@/lib/client-api'

/** The "@partial" right before the caret, if the writer is typing a mention. */
function mentionAt(text: string, caret: number): { start: number; query: string } | null {
  const m = /(?:^|[^\w@])@([a-z0-9_]{0,30})$/i.exec(text.slice(0, caret))
  return m ? { start: caret - m[1]!.length - 1, query: m[1]!.toLowerCase() } : null
}

/**
 * A text field with @mention autocomplete (FR-016). ARIA combobox pattern: the field keeps focus, arrow keys move
 * through suggestions, Enter or Tab inserts, Escape closes. Suggestions come from people who can read the work.
 */
export function MentionField({
  workId,
  value,
  onChange,
  multiline = true,
  rows = 3,
  id,
  placeholder,
  className,
  autoFocus,
  onSubmitShortcut,
}: {
  workId: string
  value: string
  onChange: (v: string) => void
  multiline?: boolean
  rows?: number
  id?: string
  placeholder?: string
  className?: string
  autoFocus?: boolean
  /** ⌘/Ctrl+Enter */
  onSubmitShortcut?: () => void
}) {
  const ref = useRef<HTMLTextAreaElement & HTMLInputElement>(null)
  const listId = useId()
  const [mention, setMention] = useState<{ start: number; query: string } | null>(null)
  const [options, setOptions] = useState<Mentionable[]>([])
  const [active, setActive] = useState(0)
  const open = mention !== null && options.length > 0

  useEffect(() => {
    if (!mention) return setOptions([])
    const t = setTimeout(() => {
      api<{ items: Mentionable[] }>(`/works/${workId}/mentionable?q=${encodeURIComponent(mention.query)}`)
        .then((r) => {
          setOptions(r.items)
          setActive(0)
        })
        .catch(() => setOptions([]))
    }, 120)
    return () => clearTimeout(t)
  }, [mention, workId])

  const sync = (text: string, caret: number) => setMention(mentionAt(text, caret))

  function choose(o: Mentionable) {
    if (!mention || !ref.current) return
    const caret = ref.current.selectionStart ?? value.length
    const next = `${value.slice(0, mention.start)}@${o.username} ${value.slice(caret)}`
    const at = mention.start + o.username.length + 2
    // Commit the new value now and put the caret after the mention in the same tick: waiting a frame let fast
    // typing land at the old caret position, in the middle of the text.
    flushSync(() => {
      onChange(next)
      setMention(null)
    })
    ref.current.setSelectionRange(at, at)
  }

  const common = {
    ref,
    id,
    value,
    placeholder,
    autoFocus,
    maxLength: 4000,
    role: 'combobox',
    'aria-autocomplete': 'list' as const,
    'aria-expanded': open,
    'aria-controls': listId,
    'aria-activedescendant': open ? `${listId}-${active}` : undefined,
    className,
    onChange: (e: React.ChangeEvent<HTMLTextAreaElement | HTMLInputElement>) => {
      onChange(e.target.value)
      sync(e.target.value, e.target.selectionStart ?? e.target.value.length)
    },
    onClick: (e: React.MouseEvent<HTMLTextAreaElement | HTMLInputElement>) =>
      sync(value, e.currentTarget.selectionStart ?? value.length),
    onBlur: () => setTimeout(() => setMention(null), 150),
    onKeyDown: (e: React.KeyboardEvent<HTMLTextAreaElement | HTMLInputElement>) => {
      if (open) {
        if (e.key === 'ArrowDown') {
          e.preventDefault()
          setActive((a) => (a + 1) % options.length)
          return
        }
        if (e.key === 'ArrowUp') {
          e.preventDefault()
          setActive((a) => (a - 1 + options.length) % options.length)
          return
        }
        if (e.key === 'Enter' || e.key === 'Tab') {
          e.preventDefault()
          choose(options[active]!)
          return
        }
        if (e.key === 'Escape') {
          e.preventDefault()
          setMention(null)
          return
        }
      }
      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && onSubmitShortcut) {
        e.preventDefault()
        onSubmitShortcut()
      }
    },
  }

  return (
    <div className="relative">
      {multiline ? <textarea rows={rows} {...common} /> : <input {...common} />}
      <ul
        id={listId}
        role="listbox"
        aria-label="People you can mention"
        hidden={!open}
        className="absolute left-0 right-0 top-full z-40 mt-1 max-h-56 overflow-y-auto rounded-md border border-subtle bg-raised p-1 shadow-[0_6px_16px_rgb(34_34_31/.12)]"
      >
        {options.map((o, i) => (
          <li
            key={o.id}
            id={`${listId}-${i}`}
            role="option"
            aria-selected={i === active}
            onMouseDown={(e) => {
              e.preventDefault()
              choose(o)
            }}
            onMouseEnter={() => setActive(i)}
            className={`flex cursor-default items-baseline gap-2 rounded-sm px-2.5 py-1.5 text-[14px] ${i === active ? 'bg-selected' : ''}`}
          >
            <span className="text-primary">{o.name}</span>
            <span className="font-mono text-[12px] text-secondary">@{o.username}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}

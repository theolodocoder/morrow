'use client'
/**
 * The "/" menu: type / anywhere to add a block, then keep typing to filter. Arrow keys move, Enter picks, Escape
 * closes and leaves the "/" as text. The editor stays focused throughout (the menu never takes focus), so typing
 * carries on naturally. The same blocks are reachable without the menu through the + handle and "Turn into".
 */
import { Extension, type Editor, type Range } from '@tiptap/react'
import { PluginKey } from '@tiptap/pm/state'
import { ReactRenderer } from '@tiptap/react'
import Suggestion, { type SuggestionProps } from '@tiptap/suggestion'
import { computePosition, flip, offset, shift } from '@floating-ui/dom'
import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react'
import { blocksFor, type MenuItem as BlockItem } from './blocks'

export const slashMenuKey = new PluginKey('slashMenu')

interface MenuHandle {
  onKeyDown: (e: KeyboardEvent) => boolean
}
interface MenuProps {
  items: BlockItem[]
  command: (item: BlockItem) => void
  query: string
}

const SlashList = forwardRef<MenuHandle, MenuProps>(function SlashList({ items, command, query }, ref) {
  const [active, setActive] = useState(0)
  const list = useRef<HTMLDivElement>(null)
  useEffect(() => setActive(0), [query])
  useEffect(() => {
    list.current?.querySelector(`[data-index="${active}"]`)?.scrollIntoView({ block: 'nearest' })
  }, [active])
  useImperativeHandle(ref, () => ({
    onKeyDown: (e) => {
      if (!items.length) return false
      if (e.key === 'ArrowDown') {
        setActive((i) => (i + 1) % items.length)
        return true
      }
      if (e.key === 'ArrowUp') {
        setActive((i) => (i - 1 + items.length) % items.length)
        return true
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        command(items[active]!)
        return true
      }
      return false
    },
  }))
  let lastGroup = ''
  return (
    <div
      ref={list}
      id="slash-menu"
      // reachable for scrolling (axe: scrollable-region-focusable); typing stays in the editor, where Tab picks
      tabIndex={0}
      role="listbox"
      aria-label="Add a block"
      className="max-h-[min(360px,50vh)] w-[min(320px,calc(100vw-2rem))] overflow-y-auto rounded-md border border-subtle bg-raised p-1 font-ui shadow-[0_2px_4px_rgb(34_34_31/.06),0_12px_32px_rgb(34_34_31/.16)]"
    >
      {items.length === 0 ? (
        <p className="px-3 py-2 text-[13px] text-secondary">No blocks match “{query}”.</p>
      ) : (
        items.map((item, i) => {
          const header = item.section && item.section !== lastGroup ? item.section : null
          lastGroup = item.section
          return (
            <div key={item.id}>
              {header && (
                <p className="px-2.5 pb-1 pt-2.5 text-[11px] font-medium uppercase tracking-[0.06em] text-tertiary">
                  {header}
                </p>
              )}
              <div
                id={`slash-${item.id}`}
                role="option"
                aria-selected={i === active}
                data-index={i}
                onMouseDown={(e) => e.preventDefault()}
                onMouseEnter={() => setActive(i)}
                onClick={() => command(item)}
                className={`flex cursor-default items-center gap-3 rounded-sm px-2.5 py-1.5 ${i === active ? 'bg-selected' : ''}`}
              >
                <span className="grid size-8 shrink-0 place-items-center rounded-sm border border-subtle bg-canvas text-primary">
                  {item.icon}
                </span>
                <span className="min-w-0">
                  <span className="block text-[14px] text-primary">{item.label}</span>
                  <span className="block truncate text-[12px] text-secondary">{item.description}</span>
                </span>
              </div>
            </div>
          )
        })
      )}
    </div>
  )
})

/** The form decides the order (a poem's menu leads with Verse); read at open time so it can change. */
export const SlashMenu = Extension.create<{ form: () => string | undefined }>({
  name: 'slashMenu',
  addOptions: () => ({ form: () => undefined }),
  addProseMirrorPlugins() {
    const form = this.options.form
    return [
      Suggestion<BlockItem>({
        editor: this.editor,
        pluginKey: slashMenuKey,
        char: '/',
        startOfLine: false,
        allowSpaces: false,
        // Not inside code or verse (a slash there is just a slash), and only for people who can write.
        allow: ({ editor, state, range }) => {
          if (!editor.isEditable) return false
          const parent = state.doc.resolve(range.from).parent.type.name
          return parent !== 'codeBlock' && parent !== 'verse'
        },
        items: ({ query }) => blocksFor(form(), query).slice(0, 30),
        command: ({ editor, range, props }) => props.run(editor as Editor, range as Range),
        render: () => {
          let renderer: ReactRenderer<MenuHandle, MenuProps> | null = null
          let el: HTMLElement | null = null
          const place = (props: SuggestionProps<BlockItem>) => {
            const rect = props.clientRect?.()
            if (!rect || !el) return
            void computePosition({ getBoundingClientRect: () => rect }, el, {
              placement: 'bottom-start',
              strategy: 'fixed',
              middleware: [offset(6), flip(), shift({ padding: 8 })],
            }).then(({ x, y }) => {
              if (el) Object.assign(el.style, { left: `${x}px`, top: `${y}px` })
            })
          }
          return {
            onStart: (props) => {
              renderer = new ReactRenderer(SlashList, {
                editor: props.editor,
                props: { items: props.items, command: props.command, query: props.query },
              })
              el = document.createElement('div')
              el.style.position = 'fixed'
              el.style.zIndex = '60'
              el.append(renderer.element)
              document.body.append(el)
              place(props)
            },
            onUpdate: (props) => {
              renderer?.updateProps({ items: props.items, command: props.command, query: props.query })
              place(props)
            },
            onKeyDown: ({ event }) => {
              if (event.key === 'Escape') {
                el?.remove()
                return true
              }
              return renderer?.ref?.onKeyDown(event) ?? false
            },
            onExit: () => {
              renderer?.destroy()
              el?.remove()
              renderer = null
              el = null
            },
          }
        },
      }),
    ]
  },
})

/** Open the menu at the cursor, as if "/" had been typed (used by the + handle). */
export function openSlashMenu(editor: Editor) {
  editor.chain().focus().insertContent('/').run()
}

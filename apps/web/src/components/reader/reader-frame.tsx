'use client'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { createContext, useContext, useEffect, useRef, useState } from 'react'
import { minutesLeft } from '@morrow/domain'
import { Button as AriaButton, Dialog, DialogTrigger, Popover } from 'react-aria-components'
import { Sheet } from '@/components/ui/sheet'
import { ArrowLeftIcon, ChaptersIcon } from '@/components/ui/icons'
import { routes } from '@/lib/routes'

type Size = 's' | 'm' | 'l' | 'xl'
type Tone = 'paper' | 'sepia' | 'night'
type Face = 'serif' | 'sans'
type Leading = 'normal' | 'roomy'
export interface Prefs {
  size: Size
  tone: Tone
  face: Face
  leading: Leading
  /** Whether paragraph comment markers show in the margin; off by default so the page stays quiet. */
  marginComments: boolean
}
const KEY = 'morrow:reader'
const DEFAULTS: Prefs = { size: 'm', tone: 'paper', face: 'serif', leading: 'normal', marginComments: false }

const PrefsContext = createContext<{ prefs: Prefs; set: (p: Partial<Prefs>) => void }>({
  prefs: DEFAULTS,
  set: () => {},
})
/** The reader's saved preferences, for anything rendered inside the frame (paragraph markers, last-read storage). */
export const useReaderPrefs = () => useContext(PrefsContext)

const INTERACTIVE =
  'a, button, input, textarea, select, summary, label, [role=button], [role=switch], [role=dialog]'
function isInteractive(el: EventTarget | null) {
  return el instanceof Element && !!el.closest(INTERACTIVE)
}

/** True while typing or choosing in a control, where arrow keys belong to that control, not to chapter paging. */
function inField(el: EventTarget | null) {
  return (
    el instanceof Element &&
    !!el.closest('input, textarea, select, [contenteditable]:not([contenteditable=false]), [role=dialog]')
  )
}

function load(): Prefs {
  try {
    return { ...DEFAULTS, ...(JSON.parse(localStorage.getItem(KEY) ?? '{}') as Partial<Prefs>) }
  } catch {
    return DEFAULTS
  }
}

const seg =
  'press flex-1 rounded-sm px-2 py-1.5 text-[13px] text-secondary outline-none aria-pressed:bg-selected aria-pressed:text-primary focus-visible:ring-2 focus-visible:ring-focus'

/**
 * The reader's frame (design/product-redesign.md §4): a quiet running head with the way back, where you are, and two
 * controls only: Aa (text size, page tone, typeface; remembered on this device) and Contents. It hides as you read
 * down and comes back when you scroll up.
 */
export function ReaderFrame({
  publicPath,
  workTitle,
  chapterIndex,
  chapters,
  wordCount,
  prevHref,
  nextHref,
  children,
}: {
  publicPath: string
  workTitle: string
  chapterIndex: number
  chapters: { title: string; slug: string }[]
  wordCount: number
  prevHref: string | null
  nextHref: string | null
  children: React.ReactNode
}) {
  const [prefs, setPrefs] = useState<Prefs>(DEFAULTS)
  const [contents, setContents] = useState(false)
  const [hidden, setHidden] = useState(false)
  const [left, setLeft] = useState<number | null>(null)
  const router = useRouter()
  const headRef = useRef<HTMLElement>(null)
  useEffect(() => setPrefs(load()), [])
  const set = (p: Partial<Prefs>) => {
    const next = { ...prefs, ...p }
    setPrefs(next)
    try {
      localStorage.setItem(KEY, JSON.stringify(next))
    } catch {
      // private window: this visit only
    }
  }
  // Out of the way while reading down; back as soon as you scroll up.
  useEffect(() => {
    let last = window.scrollY
    const measure = () => {
      // Progress through the chapter text itself (not the page): 0 when its top reaches the foot of the screen, 1
      // when its end does. Only the minute count is state, so this re-renders once a minute, not on every scroll.
      const body = document.querySelector('.reading-body')
      if (body) {
        const r = body.getBoundingClientRect()
        setLeft(minutesLeft(wordCount, r.height > 0 ? (window.innerHeight - r.top) / r.height : 0))
      }
    }
    // Only scroll decides the head's visibility: phones fire `resize` as the URL bar collapses mid-read, and that
    // must not bring the head back.
    // Never hide the head over keyboard focus: that would strand the user on an invisible control. Only
    // :focus-visible counts, since a mouse click on Aa leaves focus on that button after the popover closes.
    const keyboardFocusInHead = () => {
      const el = document.activeElement
      return !!el && !!headRef.current?.contains(el) && el.matches(':focus-visible')
    }
    const onScroll = () => {
      const y = window.scrollY
      setHidden(y > last && y > 120 && !keyboardFocusInHead())
      last = y
      measure()
    }
    measure()
    window.addEventListener('scroll', onScroll, { passive: true })
    window.addEventListener('resize', measure)
    return () => {
      window.removeEventListener('scroll', onScroll)
      window.removeEventListener('resize', measure)
    }
  }, [wordCount])
  // ← / → turn the chapter, unless the reader is typing or a modifier is held (browser back/forward, word-jump).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (
        e.repeat ||
        e.defaultPrevented ||
        e.altKey ||
        e.ctrlKey ||
        e.metaKey ||
        e.shiftKey ||
        inField(e.target)
      )
        return
      const href = e.key === 'ArrowRight' ? nextHref : e.key === 'ArrowLeft' ? prevHref : null
      if (href) router.push(href)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [router, prevHref, nextHref])

  return (
    <div
      className="reader min-h-dvh bg-canvas"
      data-tone={prefs.tone}
      data-size={prefs.size}
      data-face={prefs.face}
      data-leading={prefs.leading}
      data-margin-comments={prefs.marginComments}
      // A tap on the text brings the head back; links, controls and a text selection keep their own meaning.
      onClick={(e) => {
        if (hidden && !isInteractive(e.target) && window.getSelection()?.isCollapsed !== false)
          setHidden(false)
      }}
    >
      <PrefsContext.Provider value={{ prefs, set }}>
        <header
          ref={headRef}
          // Tabbing into a hidden head must show it, or focus would land on controls you cannot see.
          onFocus={() => setHidden(false)}
          className={`sticky top-0 z-30 border-b border-subtle bg-canvas/95 backdrop-blur-sm transition-transform duration-200 ${hidden ? '-translate-y-full' : ''}`}
        >
          <div className="mx-auto flex h-12 max-w-[72ch] items-center gap-1 px-2 text-[13px]">
            <Link
              href={routes.publicWork(publicPath)}
              aria-label={`Back to ${workTitle}`}
              className="press grid size-9 shrink-0 place-items-center rounded-full text-secondary hover:bg-hover hover:text-primary"
            >
              <ArrowLeftIcon size={18} />
            </Link>
            <p className="min-w-0 flex-1 truncate text-secondary">{workTitle}</p>
            {left !== null && (
              <span className="shrink-0 px-1 font-ui text-[12px] text-tertiary">
                {left} min left in chapter
              </span>
            )}
            <span className="shrink-0 px-1 font-mono text-[11px] uppercase tracking-[0.08em] text-tertiary">
              {chapterIndex + 1} / {chapters.length}
            </span>
            <DialogTrigger>
              <AriaButton
                aria-label="Reading settings"
                className="press grid size-9 place-items-center rounded-full font-display text-[17px] text-primary outline-none hover:bg-hover data-[focus-visible]:ring-2 data-[focus-visible]:ring-focus"
              >
                Aa
              </AriaButton>
              <Popover
                placement="bottom end"
                className="popover w-64 rounded-md border border-subtle bg-raised p-3 font-ui shadow-[0_2px_4px_rgb(34_34_31/.06),0_12px_32px_rgb(34_34_31/.14)]"
              >
                <Dialog aria-label="Reading settings" className="flex flex-col gap-3 outline-none">
                  <div>
                    <p className="mb-1 text-[12px] text-tertiary">Text size</p>
                    <div role="group" aria-label="Text size" className="flex gap-1 rounded-md bg-app p-0.5">
                      {(['s', 'm', 'l', 'xl'] as const).map((s, i) => (
                        <button
                          key={s}
                          type="button"
                          aria-pressed={prefs.size === s}
                          onClick={() => set({ size: s })}
                          className={seg}
                        >
                          <span style={{ fontSize: 12 + i * 2 }}>A</span>
                          <span className="sr-only"> {['Small', 'Medium', 'Large', 'Extra large'][i]}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                  <div>
                    <p className="mb-1 text-[12px] text-tertiary">Page</p>
                    <div role="group" aria-label="Page tone" className="flex gap-1 rounded-md bg-app p-0.5">
                      {(['paper', 'sepia', 'night'] as const).map((t) => (
                        <button
                          key={t}
                          type="button"
                          aria-pressed={prefs.tone === t}
                          onClick={() => set({ tone: t })}
                          className={seg}
                        >
                          {t[0]!.toUpperCase() + t.slice(1)}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div>
                    <p className="mb-1 text-[12px] text-tertiary">Typeface</p>
                    <div role="group" aria-label="Typeface" className="flex gap-1 rounded-md bg-app p-0.5">
                      {(['serif', 'sans'] as const).map((f) => (
                        <button
                          key={f}
                          type="button"
                          aria-pressed={prefs.face === f}
                          onClick={() => set({ face: f })}
                          className={seg}
                        >
                          <span className={f === 'serif' ? 'font-manuscript' : 'font-ui'}>
                            {f === 'serif' ? 'Serif' : 'Sans'}
                          </span>
                        </button>
                      ))}
                    </div>
                  </div>
                  <div>
                    <p className="mb-1 text-[12px] text-tertiary">Line spacing</p>
                    <div
                      role="group"
                      aria-label="Line spacing"
                      className="flex gap-1 rounded-md bg-app p-0.5"
                    >
                      {(['normal', 'roomy'] as const).map((l) => (
                        <button
                          key={l}
                          type="button"
                          aria-pressed={prefs.leading === l}
                          onClick={() => set({ leading: l })}
                          className={seg}
                        >
                          {l === 'normal' ? 'Normal' : 'Roomy'}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className="flex items-center justify-between gap-3">
                    <span id="margin-comments-label" className="text-[13px] text-primary">
                      Comments in the margin
                    </span>
                    <button
                      type="button"
                      role="switch"
                      aria-checked={prefs.marginComments}
                      aria-labelledby="margin-comments-label"
                      onClick={() => set({ marginComments: !prefs.marginComments })}
                      className="press relative h-6 w-10 shrink-0 rounded-full border border-control bg-app outline-none aria-checked:border-transparent aria-checked:bg-action focus-visible:ring-2 focus-visible:ring-focus"
                    >
                      <span
                        aria-hidden="true"
                        className={`absolute left-0.5 top-0.5 size-4 rounded-full bg-raised shadow-[0_1px_2px_rgb(34_34_31/.3)] transition-transform ${prefs.marginComments ? 'translate-x-4' : ''}`}
                      />
                    </button>
                  </div>
                </Dialog>
              </Popover>
            </DialogTrigger>
            <button
              type="button"
              aria-label="Contents"
              onClick={() => setContents(true)}
              className="press grid size-9 place-items-center rounded-full text-secondary hover:bg-hover hover:text-primary"
            >
              <ChaptersIcon size={18} />
            </button>
          </div>
        </header>
        {children}
        <Sheet title="Contents" isOpen={contents} onOpenChange={setContents}>
          <ol className="-mx-2 flex flex-col">
            {chapters.map((c, i) => (
              <li key={c.slug}>
                <Link
                  href={routes.readChapter(publicPath, c.slug)}
                  aria-current={i === chapterIndex ? 'page' : undefined}
                  onClick={() => setContents(false)}
                  className={`press flex items-baseline gap-3 rounded-md px-2 py-2.5 hover:bg-hover ${i === chapterIndex ? 'bg-selected' : ''}`}
                >
                  <span className="w-6 text-right font-mono text-[12px] text-tertiary">{i + 1}</span>
                  <span className="min-w-0 truncate font-manuscript text-[16px] text-primary">{c.title}</span>
                </Link>
              </li>
            ))}
          </ol>
        </Sheet>
      </PrefsContext.Provider>
    </div>
  )
}

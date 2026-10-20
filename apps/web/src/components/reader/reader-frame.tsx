'use client'
import Link from 'next/link'
import { useEffect, useState } from 'react'
import { Button as AriaButton, Dialog, DialogTrigger, Popover } from 'react-aria-components'
import { Sheet } from '@/components/ui/sheet'
import { ArrowLeftIcon, ChaptersIcon } from '@/components/ui/icons'
import { routes } from '@/lib/routes'

type Size = 's' | 'm' | 'l' | 'xl'
type Tone = 'paper' | 'sepia' | 'night'
type Face = 'serif' | 'sans'
interface Prefs {
  size: Size
  tone: Tone
  face: Face
}
const KEY = 'morrow:reader'
const DEFAULTS: Prefs = { size: 'm', tone: 'paper', face: 'serif' }

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
  children,
}: {
  publicPath: string
  workTitle: string
  chapterIndex: number
  chapters: { title: string; slug: string }[]
  children: React.ReactNode
}) {
  const [prefs, setPrefs] = useState<Prefs>(DEFAULTS)
  const [contents, setContents] = useState(false)
  const [hidden, setHidden] = useState(false)
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
    const on = () => {
      const y = window.scrollY
      setHidden(y > last && y > 120)
      last = y
    }
    window.addEventListener('scroll', on, { passive: true })
    return () => window.removeEventListener('scroll', on)
  }, [])

  return (
    <div
      className="reader min-h-dvh bg-canvas"
      data-tone={prefs.tone}
      data-size={prefs.size}
      data-face={prefs.face}
    >
      <header
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
    </div>
  )
}

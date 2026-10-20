'use client'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'
import { Form, Label, Radio, RadioGroup } from 'react-aria-components'
import type { Work } from '@morrow/contracts'
import { Button } from '@/components/ui/button'
import { InlineAlert } from '@/components/ui/inline-alert'
import { Sheet } from '@/components/ui/sheet'
import { TextField } from '@/components/ui/text-field'
import { WorkCover } from '@/components/work-cover'
import { ComicGlyph, KindGlyph } from '@/components/brand/kind-glyphs'
import { api, newIdempotencyKey } from '@/lib/client-api'
import { timeAgo } from '@/lib/format'
import { routes } from '@/lib/routes'

/**
 * What you're writing sets the editor up for it: the "/" menu leads with that form's blocks, and the page uses its
 * typography (indented fiction, spaced articles, numbered papers, kept lines for poetry). Changeable in Work settings.
 */
export const KINDS: { id: Work['category']; label: string; hint: string }[] = [
  { id: 'short_story', label: 'Story', hint: 'Short fiction' },
  { id: 'novel', label: 'Book', hint: 'Novel or long fiction, in chapters' },
  { id: 'poetry', label: 'Poetry', hint: 'Poems, with lines kept as written' },
  { id: 'article', label: 'Article', hint: 'Headings, lists, callouts' },
  { id: 'essay', label: 'Essay', hint: 'Argument, quotes, footnotes' },
  { id: 'research_paper', label: 'Paper', hint: 'Abstract, sections, tables, citations' },
  { id: 'educational', label: 'Guide', hint: 'Lessons, steps and tips' },
  { id: 'general_document', label: 'Document', hint: 'Anything else' },
]

/** Start a new work: a title and what kind of writing it is. */
export function NewWorkForm({
  onCancel,
  prompt,
}: {
  onCancel?: () => void
  /** writing for the weekly prompt (P-059): the new work carries its tag */
  prompt?: { title: string; tag: string } | undefined
}) {
  const router = useRouter()
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)
  const [category, setCategory] = useState<Work['category']>('short_story')
  const [key] = useState(newIdempotencyKey) // one key per form: a double-submit can't create two works

  async function create(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const title = String(new FormData(e.currentTarget).get('title') ?? '')
    setPending(true)
    setError(null)
    try {
      const work = await api<Work>('/works', {
        method: 'POST',
        body: { title, category },
        headers: { 'idempotency-key': key },
      })
      if (prompt)
        await api(`/works/${work.id}`, { method: 'PATCH', body: { tags: [prompt.tag] } }).catch(() => {})
      router.push(routes.work(work.id))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create the work.')
      setPending(false)
    }
  }

  return (
    <Form onSubmit={create} className="flex flex-col gap-5">
      {error && <InlineAlert>{error}</InlineAlert>}
      {prompt && (
        <p className="rounded-md bg-selected px-3 py-2 text-[13px] text-primary">
          For this week’s prompt: <span className="font-medium">{prompt.title}</span>. It’s tagged, so readers
          find it with the other entries when you publish.
        </p>
      )}
      <TextField
        name="title"
        label="Title"
        isRequired
        autoFocus
        maxLength={200}
        description="You can change it any time. New works are private."
      />
      <RadioGroup
        value={category}
        onChange={(v) => setCategory(v as Work['category'])}
        className="flex flex-col gap-2"
      >
        <Label className="text-sm font-medium text-primary">What are you writing?</Label>
        <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-4">
          {KINDS.map((k) => (
            <Radio
              key={k.id}
              value={k.id}
              aria-label={`${k.label}: ${k.hint}`}
              className="kind-tile press group cursor-default rounded-md border border-subtle px-2.5 py-2 outline-none transition-colors data-[selected]:border-action data-[selected]:bg-selected data-[focus-visible]:ring-2 data-[focus-visible]:ring-focus"
            >
              <span className="mb-1 block text-secondary group-data-[selected]:text-accent">
                <KindGlyph kind={k.id} size={20} />
              </span>
              <span className="block text-[13px] font-medium text-primary">{k.label}</span>
              <span className="block text-[11px] leading-snug text-secondary">{k.hint}</span>
            </Radio>
          ))}
          <Link
            href={routes.comics}
            onClick={onCancel}
            className="press rounded-md border border-dashed border-control px-2.5 py-2 outline-none hover:bg-hover focus-visible:ring-2 focus-visible:ring-focus"
          >
            <span className="mb-1 flex items-center justify-between text-secondary">
              <ComicGlyph size={20} />
              <span className="rounded-full bg-[var(--decor-ornament)] px-1.5 py-px text-[10px] font-semibold uppercase tracking-[0.06em] text-[#22221F]">
                Soon
              </span>
            </span>
            <span className="block text-[13px] font-medium text-primary">Comic</span>
            <span className="block text-[11px] leading-snug text-secondary">Script and art, as a team</span>
          </Link>
        </div>
      </RadioGroup>
      <div className="flex justify-end gap-2">
        {onCancel && (
          <Button variant="quiet" onPress={onCancel}>
            Cancel
          </Button>
        )}
        <Button type="submit" variant="primary" isDisabled={pending}>
          {pending ? 'Creating…' : 'Create'}
        </Button>
      </div>
    </Form>
  )
}

/**
 * Write (+): pick up where you left off, or start something new. One place for both, reachable from anywhere in the
 * app (the sidebar's button, the tab bar's centre button).
 */
export function WriteSheet({
  isOpen,
  onOpenChange,
  prompt,
}: {
  isOpen: boolean
  onOpenChange: (o: boolean) => void
  prompt?: { title: string; tag: string } | undefined
}) {
  const [recent, setRecent] = useState<Work[] | null>(null)
  const [mode, setMode] = useState<'choose' | 'new'>('choose')
  useEffect(() => {
    if (!isOpen) return
    setMode('choose')
    void api<{ items: Work[] }>('/works').then(
      (r) => setRecent(r.items.slice(0, 3)),
      () => setRecent([]),
    )
  }, [isOpen])

  return (
    <Sheet
      title={prompt || mode === 'new' ? 'Begin a new work' : 'Write'}
      isOpen={isOpen}
      onOpenChange={onOpenChange}
    >
      {prompt || mode === 'new' || (recent && recent.length === 0) ? (
        <NewWorkForm
          prompt={prompt}
          onCancel={recent?.length && !prompt ? () => setMode('choose') : () => onOpenChange(false)}
        />
      ) : (
        <div className="flex flex-col gap-4">
          <Button variant="primary" size="lg" onPress={() => setMode('new')} className="w-full">
            Start something new
          </Button>
          <div>
            <p className="mb-1.5 text-[12px] font-medium uppercase tracking-[0.06em] text-tertiary">
              Continue writing
            </p>
            <ul className="flex flex-col">
              {(recent ?? []).map((w) => (
                <li key={w.id}>
                  <Link
                    href={routes.work(w.id)}
                    onClick={() => onOpenChange(false)}
                    className="press flex items-center gap-3 rounded-md px-2 py-2 hover:bg-hover"
                  >
                    <WorkCover cover={w.cover} title={w.title} />
                    <span className="min-w-0">
                      <span className="block truncate text-[15px] font-medium text-primary">{w.title}</span>
                      <span className="block text-[12px] text-tertiary">Edited {timeAgo(w.updatedAt)}</span>
                    </span>
                  </Link>
                </li>
              ))}
              {recent === null &&
                [0, 1].map((i) => (
                  <li key={i} aria-hidden="true" className="flex items-center gap-3 px-2 py-2">
                    <span className="skeleton h-[72px] w-12 rounded-[3px]" />
                    <span className="flex flex-1 flex-col gap-1.5">
                      <span className="skeleton h-3.5 w-2/3 rounded-sm" />
                      <span className="skeleton h-3 w-1/3 rounded-sm" />
                    </span>
                  </li>
                ))}
            </ul>
            <Link
              href={routes.library}
              onClick={() => onOpenChange(false)}
              className="mt-1 inline-block px-2 text-[13px] text-accent hover:underline"
            >
              All your works
            </Link>
          </div>
        </div>
      )}
    </Sheet>
  )
}

/**
 * "Write for this prompt", from anywhere: a prompt card announces `morrow:write` with the prompt, and this one sheet
 * (mounted once by the shell) opens to start a work for it.
 */
export function PromptWriter() {
  const [prompt, setPrompt] = useState<{ title: string; tag: string } | null>(null)
  useEffect(() => {
    const on = (e: Event) => setPrompt((e as CustomEvent<{ title: string; tag: string }>).detail)
    window.addEventListener('morrow:write', on)
    return () => window.removeEventListener('morrow:write', on)
  }, [])
  return (
    <WriteSheet
      isOpen={prompt !== null}
      onOpenChange={(o) => !o && setPrompt(null)}
      prompt={prompt ?? undefined}
    />
  )
}

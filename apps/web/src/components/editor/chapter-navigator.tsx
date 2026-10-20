'use client'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { Form } from 'react-aria-components'
import type { Chapter } from '@morrow/contracts'
import { Button } from '@/components/ui/button'
import { Dialog } from '@/components/ui/dialog'
import { TextField } from '@/components/ui/text-field'
import { ChoiceGroup } from '@/components/ui/choice'
import { MODE_OPTIONS } from '@/lib/work-options'
import { InlineAlert } from '@/components/ui/inline-alert'
import { ActionMenu } from '@/components/ui/menu'
import { api, newIdempotencyKey } from '@/lib/client-api'
import { routes } from '@/lib/routes'
import { MoreIcon, PlusIcon } from '@/components/ui/icons'

const words = new Intl.NumberFormat('en', { notation: 'compact' })

export function ChapterNavigator({
  workId,
  branchId,
  chapters,
  currentId,
  canEdit,
  canManage = false,
}: {
  workId: string
  branchId: string
  chapters: Chapter[]
  currentId: string
  canEdit: boolean
  /** the owner may set a section's own collaboration mode (FR-006) */
  canManage?: boolean
}) {
  const [sectionMode, setSectionMode] = useState<'inherit' | 'direct' | 'mixed' | 'proposal'>('inherit')
  const router = useRouter()
  const [renaming, setRenaming] = useState<Chapter | null>(null)
  const [error, setError] = useState<string | null>(null)

  const run = async (fn: () => Promise<unknown>) => {
    setError(null)
    try {
      await fn()
      router.refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'That didn’t work.')
    }
  }
  const add = () =>
    run(async () => {
      const c = await api<Chapter>(`/branches/${branchId}/chapters`, {
        method: 'POST',
        body: { title: `Chapter ${chapters.length + 1}` },
        headers: { 'idempotency-key': newIdempotencyKey() },
      })
      router.push(routes.chapter(workId, c.id))
    })
  // Moving "up" means placing the chapter after the one two places above it (null = to the start).
  const move = (i: number, dir: -1 | 1) =>
    run(() => {
      const target = dir === -1 ? (i >= 2 ? chapters[i - 2]!.id : null) : chapters[i + 1]!.id
      return api(`/chapters/${chapters[i]!.id}`, { method: 'PATCH', body: { moveAfterChapterId: target } })
    })
  const remove = (c: Chapter) =>
    run(async () => {
      if (!window.confirm(`Delete “${c.title}”? It can be recovered for 30 days.`)) return
      await api(`/chapters/${c.id}`, { method: 'DELETE' })
      if (c.id === currentId) router.push(routes.work(workId))
    })

  return (
    <nav aria-label="Chapters" className="flex h-full flex-col">
      <p className="px-4 pb-2 pt-4 font-mono text-[11px] uppercase tracking-[0.08em] text-tertiary">
        Chapters
      </p>
      {error && (
        <div className="px-3 pb-2">
          <InlineAlert>{error}</InlineAlert>
        </div>
      )}
      <ol className="flex-1 overflow-y-auto pb-4">
        {chapters.map((c, i) => (
          <li
            key={c.id}
            className="flex items-center pr-1 hover:bg-hover has-[a[aria-current=page]]:bg-selected"
          >
            <Link
              href={routes.chapter(workId, c.id)}
              aria-current={c.id === currentId ? 'page' : undefined}
              className="flex min-w-0 flex-1 items-baseline gap-2 py-2 pl-4 pr-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-focus aria-[current=page]:font-medium"
            >
              <span className="w-5 shrink-0 font-mono text-[11px] text-tertiary">{i + 1}</span>
              <span className="min-w-0 flex-1 truncate">{c.title}</span>
              <span className="font-mono text-[11px] text-tertiary">{words.format(c.wordCount)}</span>
            </Link>
            {canEdit && (
              <ActionMenu
                label={`Actions for ${c.title}`}
                trigger={<MoreIcon size={16} />}
                actions={[
                  {
                    id: 'rename',
                    label: 'Edit details',
                    onAction: () => {
                      setSectionMode(c.collaborationMode ?? 'inherit')
                      setRenaming(c)
                    },
                  },
                  { id: 'up', label: 'Move up', isDisabled: i === 0, onAction: () => void move(i, -1) },
                  {
                    id: 'down',
                    label: 'Move down',
                    isDisabled: i === chapters.length - 1,
                    onAction: () => void move(i, 1),
                  },
                  {
                    id: 'delete',
                    label: 'Delete',
                    tone: 'danger',
                    isDisabled: chapters.length === 1,
                    onAction: () => void remove(c),
                  },
                ]}
              />
            )}
          </li>
        ))}
      </ol>
      {canEdit && (
        <div className="border-t border-subtle p-3">
          <Button variant="quiet" size="sm" className="w-full justify-start" onPress={add}>
            <PlusIcon size={16} />
            New chapter
          </Button>
        </div>
      )}
      <Dialog
        title="Chapter details"
        isOpen={renaming !== null}
        onOpenChange={(o) => !o && setRenaming(null)}
      >
        {renaming && (
          <Form
            className="flex flex-col gap-5"
            onSubmit={(e) => {
              e.preventDefault()
              const f = new FormData(e.currentTarget)
              const body = {
                title: String(f.get('title') ?? ''),
                description: String(f.get('description') ?? ''),
                ...(canManage ? { collaborationMode: sectionMode === 'inherit' ? null : sectionMode } : {}),
              }
              void run(() => api(`/chapters/${renaming.id}`, { method: 'PATCH', body })).then(() =>
                setRenaming(null),
              )
            }}
          >
            <TextField
              name="title"
              label="Title"
              defaultValue={renaming.title}
              isRequired
              autoFocus
              maxLength={200}
            />
            <TextField
              name="description"
              label="Description (optional)"
              defaultValue={renaming.description}
              maxLength={2000}
            />
            {canManage && (
              <ChoiceGroup
                label="How people collaborate in this chapter"
                value={sectionMode}
                onChange={setSectionMode}
                options={[
                  {
                    id: 'inherit',
                    label: 'Same as the work',
                    description: 'Follow the work’s collaboration setting.',
                  },
                  ...MODE_OPTIONS,
                ]}
              />
            )}
            <div className="flex justify-end gap-2">
              <Button variant="quiet" onPress={() => setRenaming(null)}>
                Cancel
              </Button>
              <Button type="submit" variant="primary">
                Save
              </Button>
            </div>
          </Form>
        )}
      </Dialog>
    </nav>
  )
}

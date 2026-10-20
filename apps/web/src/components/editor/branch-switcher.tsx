'use client'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import {
  Button as AriaButton,
  Dialog as AriaDialog,
  DialogTrigger,
  Form,
  Label,
  ListBox,
  ListBoxItem,
  Popover,
  Select,
  SelectValue,
} from 'react-aria-components'
import type { Branch, Chapter } from '@morrow/contracts'
import { Button } from '@/components/ui/button'
import { Dialog } from '@/components/ui/dialog'
import { TextField } from '@/components/ui/text-field'
import { InlineAlert } from '@/components/ui/inline-alert'
import { api, newIdempotencyKey } from '@/lib/client-api'
import { routes } from '@/lib/routes'
import { BranchIcon, ChevronDownIcon } from '@/components/ui/icons'

const STATUS: Record<Branch['status'], string> = {
  active: '',
  abandoned: 'Abandoned',
  selected: 'Selected for publishing',
}

/**
 * Always says which version you are in (design system §12: BranchBadge) and lets you move between versions.
 * Lineage is spelled out in words, e.g. "from Main · diverges at Chapter 7".
 */
export function BranchSwitcher({
  workId,
  branch,
  branches,
  chapters,
  canCreate,
}: {
  workId: string
  branch: Branch
  branches: Branch[]
  chapters: Chapter[]
  canCreate: boolean
}) {
  const router = useRouter()
  const [creating, setCreating] = useState(false)
  return (
    <>
      <DialogTrigger>
        <AriaButton
          aria-label={`Version: ${branch.name}. Switch version`}
          className="flex max-w-[16rem] items-center gap-1.5 rounded-sm border border-subtle px-2 py-1 text-[13px] text-secondary outline-none data-[hovered]:bg-hover data-[focus-visible]:ring-2 data-[focus-visible]:ring-focus"
        >
          <BranchIcon size={15} className="shrink-0 text-tertiary" />
          <span className="truncate">{branch.name}</span>
          <ChevronDownIcon size={14} className="shrink-0 text-tertiary" />
        </AriaButton>
        <Popover
          placement="bottom start"
          className="w-80 rounded-md border border-subtle bg-raised p-1 shadow-[0_1px_2px_rgb(34_34_31/.06),0_6px_16px_rgb(34_34_31/.08)]"
        >
          <AriaDialog aria-label="Versions of this work" className="outline-none">
            {({ close }) => (
              <div>
                <p className="px-3 pb-1 pt-2 font-mono text-[11px] uppercase tracking-[0.08em] text-tertiary">
                  Versions
                </p>
                <ul>
                  {branches.map((b) => (
                    <li key={b.id}>
                      <button
                        type="button"
                        aria-current={b.id === branch.id ? 'true' : undefined}
                        onClick={() => {
                          close()
                          router.push(routes.branch(workId, b.id))
                        }}
                        className="flex w-full flex-col rounded-sm px-3 py-2 text-left outline-none hover:bg-hover focus-visible:ring-2 focus-visible:ring-focus aria-[current=true]:bg-selected"
                      >
                        <span className="text-sm font-medium text-primary">
                          {b.name}
                          {b.isDefault ? (
                            <span className="ml-1.5 font-normal text-tertiary">· main</span>
                          ) : null}
                        </span>
                        <span className="text-[12px] text-secondary">
                          {b.isDefault
                            ? 'The main manuscript'
                            : `from ${b.parentBranchName ?? 'Main'}${b.divergesAtChapterTitle ? ` · diverges at ${b.divergesAtChapterTitle}` : ''} · by ${b.createdByName}`}
                          {STATUS[b.status] ? ` · ${STATUS[b.status]}` : ''}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
                {canCreate && (
                  <div className="mt-1 border-t border-subtle p-1">
                    <Button
                      variant="quiet"
                      size="sm"
                      className="w-full justify-start"
                      onPress={() => {
                        close()
                        setCreating(true)
                      }}
                    >
                      + New branch from “{branch.name}”
                    </Button>
                  </div>
                )}
              </div>
            )}
          </AriaDialog>
        </Popover>
      </DialogTrigger>
      <NewBranchDialog
        workId={workId}
        from={branch}
        chapters={chapters}
        isOpen={creating}
        onOpenChange={setCreating}
      />
    </>
  )
}

function NewBranchDialog({
  workId,
  from,
  chapters,
  isOpen,
  onOpenChange,
}: {
  workId: string
  from: Branch
  chapters: Chapter[]
  isOpen: boolean
  onOpenChange: (o: boolean) => void
}) {
  const router = useRouter()
  const [divergesAt, setDivergesAt] = useState<string | null>(chapters.at(-1)?.id ?? null)
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)
  const [key] = useState(newIdempotencyKey)

  async function create(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const f = new FormData(e.currentTarget)
    setPending(true)
    setError(null)
    try {
      const b = await api<Branch>(`/works/${workId}/branches`, {
        method: 'POST',
        headers: { 'idempotency-key': key },
        body: {
          name: String(f.get('name') ?? ''),
          description: String(f.get('description') ?? ''),
          fromBranchId: from.id,
          ...(divergesAt ? { divergesAtChapterId: divergesAt } : {}),
        },
      })
      onOpenChange(false)
      router.push(routes.branch(workId, b.id))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Couldn’t create the branch.')
      setPending(false)
    }
  }

  return (
    <Dialog title="Explore another direction" isOpen={isOpen} onOpenChange={onOpenChange}>
      <Form onSubmit={create} className="flex flex-col gap-4">
        <p className="text-sm text-secondary">
          A branch is a separate copy of every chapter in “{from.name}”. Writing in it never changes the
          original.
        </p>
        {error && <InlineAlert>{error}</InlineAlert>}
        <TextField
          name="name"
          label="Name"
          isRequired
          autoFocus
          maxLength={120}
          placeholder="The Lighthouse Ending"
        />
        <TextField name="description" label="What’s different here? (optional)" maxLength={2000} />
        {chapters.length > 0 && (
          <Select
            selectedKey={divergesAt}
            onSelectionChange={(k) => setDivergesAt(String(k))}
            className="flex flex-col gap-1.5"
          >
            <Label className="text-sm font-medium text-primary">Where does it take a different turn?</Label>
            <AriaButton className="flex h-10 items-center justify-between rounded-sm border border-control bg-canvas px-3 text-left text-base text-primary outline-none data-[focus-visible]:ring-2 data-[focus-visible]:ring-focus">
              <SelectValue />
              <ChevronDownIcon size={16} className="text-tertiary" />
            </AriaButton>
            <Popover className="min-w-[var(--trigger-width)] rounded-md border border-subtle bg-raised p-1">
              <ListBox className="max-h-64 overflow-y-auto outline-none">
                {chapters.map((c, i) => (
                  <ListBoxItem
                    key={c.id}
                    id={c.id}
                    textValue={c.title}
                    className="cursor-default rounded-sm px-3 py-2 text-sm outline-none data-[focused]:bg-hover data-[selected]:bg-selected"
                  >
                    {i + 1}. {c.title}
                  </ListBoxItem>
                ))}
              </ListBox>
            </Popover>
          </Select>
        )}
        <div className="flex justify-end gap-2">
          <Button variant="quiet" onPress={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" isDisabled={pending}>
            {pending ? 'Creating…' : 'Create branch'}
          </Button>
        </div>
      </Form>
    </Dialog>
  )
}

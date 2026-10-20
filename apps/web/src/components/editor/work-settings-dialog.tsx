'use client'
import { useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'
import { Checkbox, CheckboxGroup, Form, Label } from 'react-aria-components'
import { OPEN_ROLE_LABELS, OPEN_ROLES, REACTION_KINDS, REACTION_LABELS, type Work } from '@morrow/contracts'
import { Button } from '@/components/ui/button'
import { Dialog } from '@/components/ui/dialog'
import { TextField } from '@/components/ui/text-field'
import { InlineAlert } from '@/components/ui/inline-alert'
import { ChoiceGroup, SelectField } from '@/components/ui/choice'
import { api } from '@/lib/client-api'
import {
  CATEGORY_OPTIONS,
  LICENSE_OPTIONS,
  MODE_OPTIONS,
  VISIBILITY_OPTIONS,
  splitLabels,
} from '@/lib/work-options'

/** Owner settings (PRD FR-004/005/013). Becoming visible to others is always confirmed (P-018). */
export function WorkSettingsDialog({
  work,
  isOpen,
  onOpenChange,
}: {
  work: Work
  isOpen: boolean
  onOpenChange: (o: boolean) => void
}) {
  const router = useRouter()
  const [category, setCategory] = useState(work.category)
  const [visibility, setVisibility] = useState(work.visibility)
  const [mode, setMode] = useState(work.collaborationMode)
  const [participation, setParticipation] = useState<'none' | 'propose'>(
    work.participation === 'none' ? 'none' : 'propose',
  )
  const [license, setLicense] = useState(work.license)
  const [reactionKinds, setReactionKinds] = useState(work.reactionKinds)
  const [releaseDay, setReleaseDay] = useState<string>(
    work.releaseDay === null ? 'none' : String(work.releaseDay),
  )
  const [openRoles, setOpenRoles] = useState(work.openRoles)
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)
  useEffect(() => {
    if (isOpen) {
      setCategory(work.category)
      setVisibility(work.visibility)
      setMode(work.collaborationMode)
      setParticipation(work.participation === 'none' ? 'none' : 'propose')
      setLicense(work.license)
      setReactionKinds(work.reactionKinds)
      setReleaseDay(work.releaseDay === null ? 'none' : String(work.releaseDay))
      setOpenRoles(work.openRoles)
      setError(null)
    }
  }, [isOpen, work])

  async function save(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const f = new FormData(e.currentTarget)
    if (
      visibility !== work.visibility &&
      visibility !== 'private' &&
      !window.confirm(
        visibility === 'public'
          ? 'Make this work public? Anyone will be able to find and read what you publish.'
          : 'Make this work unlisted? Anyone with the link will be able to read what you publish.',
      )
    )
      return
    setPending(true)
    setError(null)
    try {
      await api(`/works/${work.id}`, {
        method: 'PATCH',
        headers: { 'if-match': `"v${work.version}"` },
        body: {
          title: String(f.get('title') ?? ''),
          description: String(f.get('description') ?? ''),
          category,
          license,
          visibility,
          collaborationMode: mode,
          participation,
          reactionKinds,
          releaseDay: releaseDay === 'none' ? null : Number(releaseDay),
          openRoles,
          tags: splitLabels(String(f.get('tags') ?? '')),
          contentWarnings: splitLabels(String(f.get('warnings') ?? '')),
        },
      })
      onOpenChange(false)
      router.refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Couldn’t save settings.')
    } finally {
      setPending(false)
    }
  }

  return (
    <Dialog title="Work settings" isOpen={isOpen} onOpenChange={onOpenChange}>
      <Form onSubmit={save} className="flex max-h-[72dvh] flex-col gap-5 overflow-y-auto pr-1">
        {error && <InlineAlert>{error}</InlineAlert>}
        <TextField name="title" label="Title" defaultValue={work.title} isRequired maxLength={200} />
        <TextField name="description" label="Description" defaultValue={work.description} maxLength={2000} />
        <SelectField label="Category" value={category} onChange={setCategory} options={CATEGORY_OPTIONS} />
        <TextField
          name="tags"
          label="Tags"
          defaultValue={work.tags.join(', ')}
          description="Comma-separated, up to 10."
        />
        <TextField
          name="warnings"
          label="Content warnings"
          defaultValue={work.contentWarnings.join(', ')}
          description="Shown to readers before they begin."
        />
        <ChoiceGroup
          label="Who can read"
          value={visibility}
          onChange={setVisibility}
          options={VISIBILITY_OPTIONS}
        />
        <ChoiceGroup label="How people collaborate" value={mode} onChange={setMode} options={MODE_OPTIONS} />
        {/* Public participation (M6): suggestions start from what's published, so drafts stay private. */}
        <ChoiceGroup
          label="Who can suggest edits to what you publish"
          value={participation}
          onChange={setParticipation}
          options={[
            {
              id: 'none',
              label: 'Only people in this work',
              description: 'Readers can read what you publish, but not suggest changes.',
            },
            {
              id: 'propose',
              label: 'Anyone signed in',
              description:
                'Readers of a public work can suggest edits to published chapters. You review each one; your drafts stay private.',
            },
          ]}
        />
        <SelectField
          label="New chapters come out"
          value={releaseDay}
          onChange={setReleaseDay}
          options={[
            { id: 'none', label: 'Whenever they’re ready' },
            ...['Sundays', 'Mondays', 'Tuesdays', 'Wednesdays', 'Thursdays', 'Fridays', 'Saturdays'].map(
              (d, i) => ({
                id: String(i),
                label: `Every week, on ${d}`,
              }),
            ),
          ]}
        />
        {/* Open calls (P-058): shown on the work page and in Discover's "Looking for collaborators". */}
        <CheckboxGroup
          value={openRoles}
          onChange={(v) => setOpenRoles(v as Work['openRoles'])}
          className="flex flex-col gap-1.5"
        >
          <Label className="text-sm font-medium text-primary">Looking for</Label>
          <div className="flex flex-wrap gap-2">
            {OPEN_ROLES.map((r) => (
              <Checkbox
                key={r}
                value={r}
                className="cursor-default rounded-full border border-control px-3 py-1 text-[13px] text-primary outline-none data-[selected]:border-action data-[selected]:bg-selected data-[focus-visible]:ring-2 data-[focus-visible]:ring-focus"
              >
                {OPEN_ROLE_LABELS[r]}
              </Checkbox>
            ))}
          </div>
          <p className="text-[13px] text-secondary">
            Readers who can help see it on your work and in Discover, and can ask to collaborate.
          </p>
        </CheckboxGroup>
        <SelectField label="License" value={license} onChange={setLicense} options={LICENSE_OPTIONS} />
        {/* FR-017: a configurable vocabulary; none selected turns reactions off. */}
        <CheckboxGroup
          value={reactionKinds}
          onChange={(v) => setReactionKinds(v as Work['reactionKinds'])}
          className="flex flex-col gap-1.5"
        >
          <Label className="text-sm font-medium text-primary">Reactions people can leave on passages</Label>
          <div className="flex flex-wrap gap-2">
            {REACTION_KINDS.map((k) => (
              <Checkbox
                key={k}
                value={k}
                className="cursor-default rounded-full border border-control px-3 py-1 text-[13px] text-primary outline-none data-[selected]:border-action data-[selected]:bg-selected data-[focus-visible]:ring-2 data-[focus-visible]:ring-focus"
              >
                {REACTION_LABELS[k]}
              </Checkbox>
            ))}
          </div>
          <p className="text-[13px] text-secondary">Choose none to turn reactions off.</p>
        </CheckboxGroup>
        <div className="sticky bottom-0 flex justify-end gap-2 bg-raised pt-2">
          <Button variant="quiet" onPress={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" isDisabled={pending}>
            {pending ? 'Saving…' : 'Save settings'}
          </Button>
        </div>
      </Form>
    </Dialog>
  )
}

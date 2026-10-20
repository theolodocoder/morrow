'use client'
import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Checkbox, CheckboxGroup, Form, Label } from 'react-aria-components'
import type { Profile, UpdateProfileInput, UsernameAvailability } from '@morrow/contracts'
import { Button } from '@/components/ui/button'
import { InlineAlert } from '@/components/ui/inline-alert'
import { TextField } from '@/components/ui/text-field'
import { api } from '@/lib/client-api'
import { splitLabels } from '@/lib/work-options'

type Intent = NonNullable<UpdateProfileInput['interests']>[number]
export const INTENTS: { id: Intent; label: string }[] = [
  { id: 'write', label: 'Write my own work' },
  { id: 'collaborate', label: 'Write with others' },
  { id: 'read', label: 'Read and follow writers' },
  { id: 'edit_review', label: 'Edit and give feedback' },
  { id: 'organize', label: 'Organize research or notes' },
]

/** Live, debounced username check. The server re-checks on save; this only spares the writer a round trip. */
export function useUsernameCheck(value: string, current: string) {
  const [state, setState] = useState<{ checking: boolean; result: UsernameAvailability | null }>({
    checking: false,
    result: null,
  })
  useEffect(() => {
    const v = value.trim().toLowerCase()
    if (!v || v === current) {
      setState({ checking: false, result: null })
      return
    }
    setState((s) => ({ ...s, checking: true }))
    const t = setTimeout(() => {
      api<UsernameAvailability>(`/usernames/${encodeURIComponent(v)}/availability`)
        .then((result) => setState({ checking: false, result }))
        .catch(() => setState({ checking: false, result: null }))
    }, 300)
    return () => clearTimeout(t)
  }, [value, current])
  return state
}

function Toggle({ name, label, defaultSelected }: { name: string; label: string; defaultSelected: boolean }) {
  return (
    <Checkbox
      name={name}
      defaultSelected={defaultSelected}
      className="group flex cursor-default items-center gap-2.5 text-sm text-primary outline-none"
    >
      <span
        aria-hidden="true"
        className="grid size-4 place-items-center rounded-[3px] border border-control group-data-[selected]:border-action group-data-[selected]:bg-action group-data-[focus-visible]:ring-2 group-data-[focus-visible]:ring-focus"
      >
        <svg viewBox="0 0 12 12" className="hidden size-3 text-action-fg group-data-[selected]:block">
          <path
            d="M2.5 6.5l2.2 2.2 4.8-5"
            stroke="currentColor"
            strokeWidth="1.8"
            fill="none"
            strokeLinecap="round"
          />
        </svg>
      </span>
      {label}
    </Checkbox>
  )
}

export function IntentPicker({ value, onChange }: { value: Intent[]; onChange: (v: Intent[]) => void }) {
  return (
    <CheckboxGroup value={value} onChange={(v) => onChange(v as Intent[])} className="flex flex-col gap-2">
      <Label className="text-sm font-medium text-primary">What brings you here?</Label>
      <div className="flex flex-wrap gap-2">
        {INTENTS.map((i) => (
          <Checkbox
            key={i.id}
            value={i.id}
            className="press group inline-flex cursor-default items-center gap-1.5 rounded-full border border-control px-3 py-1.5 text-[13px] text-primary outline-none transition-colors data-[selected]:border-action data-[selected]:bg-selected data-[focus-visible]:ring-2 data-[focus-visible]:ring-focus"
          >
            {/* a check draws itself in when chosen */}
            <svg
              aria-hidden="true"
              viewBox="0 0 12 12"
              className="hidden size-3 text-accent group-data-[selected]:block"
            >
              <path
                className="check-draw"
                d="M2.5 6.5l2.2 2.2 4.8-5"
                stroke="currentColor"
                strokeWidth="1.8"
                fill="none"
                strokeLinecap="round"
              />
            </svg>
            {i.label}
          </Checkbox>
        ))}
      </div>
    </CheckboxGroup>
  )
}

export function UsernameField({
  value,
  onChange,
  current,
}: {
  value: string
  onChange: (v: string) => void
  current: string
}) {
  const { checking, result } = useUsernameCheck(value, current)
  const description = checking
    ? 'Checking…'
    : result?.available
      ? `Available: your page will be /authors/${result.username}.`
      : 'Your public address. Letters, numbers and underscores.'
  return (
    <TextField
      name="username"
      label="Username"
      value={value}
      onChange={onChange}
      isRequired
      autoComplete="username"
      description={description}
      isInvalid={result ? !result.available : false}
      errorMessage={result && !result.available ? result.reason : undefined}
    />
  )
}

/** The full profile editor (PRD FR-002): identity, about, and what others may see. */
export function ProfileForm({ profile }: { profile: Profile }) {
  const router = useRouter()
  const [username, setUsername] = useState(profile.username)
  const [interests, setInterests] = useState<Intent[]>(profile.interests as Intent[])
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)
  const [busy, setBusy] = useState(false)
  const formRef = useRef<HTMLFormElement>(null)

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const f = new FormData(e.currentTarget)
    const links = [0, 1, 2]
      .map((i) => ({
        label: String(f.get(`linkLabel${i}`) ?? '').trim(),
        url: String(f.get(`linkUrl${i}`) ?? '').trim(),
      }))
      .filter((l) => l.url)
      .map((l) => ({
        label: l.label || new URL(l.url.match(/^https?:\/\//) ? l.url : `https://${l.url}`).hostname,
        url: l.url.match(/^https?:\/\//) ? l.url : `https://${l.url}`,
      }))
    setBusy(true)
    setError(null)
    setSaved(false)
    try {
      await api<Profile>('/me/profile', {
        method: 'PUT',
        body: {
          username,
          interests,
          links,
          displayName: String(f.get('displayName') ?? ''),
          bio: String(f.get('bio') ?? ''),
          genres: splitLabels(String(f.get('genres') ?? '')),
          isPublic: f.get('isPublic') === 'on',
          showBio: f.get('showBio') === 'on',
          showInterests: f.get('showInterests') === 'on',
          showLinks: f.get('showLinks') === 'on',
          showFollows: f.get('showFollows') === 'on',
          showBadges: f.get('showBadges') === 'on',
        } satisfies UpdateProfileInput,
      })
      setSaved(true)
      router.refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'That didn’t save.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Form ref={formRef} onSubmit={submit} className="flex flex-col gap-8">
      {error && <InlineAlert>{error}</InlineAlert>}
      <section className="flex flex-col gap-4">
        <TextField
          name="displayName"
          label="Name"
          defaultValue={profile.displayName}
          isRequired
          maxLength={80}
          autoComplete="name"
        />
        <UsernameField value={username} onChange={setUsername} current={profile.username} />
        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-medium text-primary">Bio</span>
          <textarea
            name="bio"
            defaultValue={profile.bio}
            maxLength={500}
            rows={4}
            className="rounded-sm border border-control bg-canvas px-3 py-2 text-base text-primary outline-none focus:ring-2 focus:ring-focus"
          />
          <span className="text-[13px] text-secondary">
            A few lines about you and what you write. Up to 500 characters.
          </span>
        </label>
      </section>

      <section className="flex flex-col gap-4">
        <IntentPicker value={interests} onChange={setInterests} />
        <TextField
          name="genres"
          label="Genres and subjects"
          defaultValue={profile.genres.join(', ')}
          description="Separate with commas, e.g. literary fiction, essays, history."
        />
      </section>

      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 text-sm font-medium text-primary">Links</legend>
        {[0, 1, 2].map((i) => (
          <div key={i} className="grid grid-cols-[minmax(0,1fr)_minmax(0,2fr)] gap-2">
            <input
              name={`linkLabel${i}`}
              aria-label={`Link ${i + 1} label`}
              placeholder="Label"
              defaultValue={profile.links[i]?.label}
              maxLength={40}
              className="h-10 rounded-sm border border-control bg-canvas px-3 text-base text-primary outline-none placeholder:text-tertiary focus:ring-2 focus:ring-focus"
            />
            <input
              name={`linkUrl${i}`}
              aria-label={`Link ${i + 1} address`}
              placeholder="https://"
              type="url"
              defaultValue={profile.links[i]?.url}
              className="h-10 rounded-sm border border-control bg-canvas px-3 text-base text-primary outline-none placeholder:text-tertiary focus:ring-2 focus:ring-focus"
            />
          </div>
        ))}
      </fieldset>

      <fieldset className="flex flex-col gap-2.5">
        <legend className="mb-1 text-sm font-medium text-primary">What others can see</legend>
        <Toggle name="isPublic" label="Show my profile page to anyone" defaultSelected={profile.isPublic} />
        <Toggle name="showBio" label="Show my bio" defaultSelected={profile.showBio} />
        <Toggle
          name="showInterests"
          label="Show my interests and genres"
          defaultSelected={profile.showInterests}
        />
        <Toggle name="showLinks" label="Show my links" defaultSelected={profile.showLinks} />
        <Toggle
          name="showFollows"
          label="Show how many people follow me"
          defaultSelected={profile.showFollows}
        />
        <Toggle name="showBadges" label="Show my badges" defaultSelected={profile.showBadges} />
        <p className="text-[13px] text-secondary">
          Your email is never shown. Only works you publish publicly appear on your profile.
        </p>
      </fieldset>

      <div className="flex items-center justify-end gap-3">
        {saved && (
          <span role="status" className="text-[13px] text-success">
            Saved
          </span>
        )}
        <Button type="submit" variant="primary" isDisabled={busy}>
          {busy ? 'Saving…' : 'Save profile'}
        </Button>
      </div>
    </Form>
  )
}

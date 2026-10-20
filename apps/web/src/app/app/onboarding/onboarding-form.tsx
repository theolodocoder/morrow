'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Form } from 'react-aria-components'
import type { AvatarConfig, Profile } from '@morrow/contracts'
import { Button } from '@/components/ui/button'
import { InlineAlert } from '@/components/ui/inline-alert'
import { TextField } from '@/components/ui/text-field'
import { INTENTS, IntentPicker, UsernameField } from '@/components/profile/profile-form'
import { AvatarBuilder, randomFace } from '@/components/profile/avatar-builder'
import { Avatar } from '@/components/profile/avatar'
import { api } from '@/lib/client-api'
import { routes } from '@/lib/routes'
import { splitLabels } from '@/lib/work-options'

type Intents = Parameters<typeof IntentPicker>[0]['value']

const step =
  'flex size-6 shrink-0 items-center justify-center rounded-full bg-selected font-mono text-[11px] text-accent'

/**
 * How others will see you, as you fill it in: the avatar, the name, the handle and what you're here for. Purely a
 * preview (hidden from assistive tech: the form fields already say all of it).
 */
function ProfilePreview({
  profile,
  avatar,
  username,
  interests,
  genres,
}: {
  profile: Profile
  avatar: AvatarConfig
  username: string
  interests: Intents
  genres: string[]
}) {
  return (
    <div aria-hidden="true" className="overflow-hidden rounded-xl border border-subtle bg-canvas shadow-sm">
      {/* a sunrise for a first page */}
      <svg viewBox="0 0 320 88" preserveAspectRatio="xMidYMid slice" className="block h-[88px] w-full">
        <defs>
          <linearGradient id="onb-sky" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#F1E2A9" />
            <stop offset="1" stopColor="#F1C9A8" />
          </linearGradient>
        </defs>
        <rect width="320" height="88" fill="url(#onb-sky)" />
        <circle className="spot-bob" cx="236" cy="80" r="30" fill="#BD5438" opacity=".85" />
        <path d="M0 80h320" stroke="#22221F" strokeOpacity=".25" strokeWidth="1.5" />
        <path
          d="M0 66c40-10 70-10 110 0s70 10 110 0 70-10 100 0"
          fill="none"
          stroke="#FBF8F1"
          strokeOpacity=".7"
          strokeWidth="2"
        />
      </svg>
      <div className="-mt-10 flex flex-col gap-2 px-5 pb-5">
        <span
          key={JSON.stringify(avatar)}
          className="badge-pop inline-block w-fit rounded-full ring-4 ring-[var(--bg-canvas)]"
        >
          <Avatar name={profile.displayName} seed={profile.avatarSeed} avatar={avatar} size={76} />
        </span>
        <div>
          <p className="font-display text-[22px] leading-tight text-primary">{profile.displayName}</p>
          <p className="truncate font-mono text-[12px] text-secondary">@{username || 'username'}</p>
        </div>
        {interests.length > 0 && (
          <ul className="flex flex-wrap gap-1.5">
            {interests.map((i) => (
              <li key={i} className="badge-pop rounded-full bg-selected px-2 py-0.5 text-[11px] text-primary">
                {INTENTS.find((x) => x.id === i)?.label}
              </li>
            ))}
          </ul>
        )}
        {genres.length > 0 && (
          <p className="text-[12px] text-secondary">
            Writes about <span className="text-primary">{genres.slice(0, 4).join(', ')}</span>
          </p>
        )}
        <div className="mt-1 grid grid-cols-3 gap-2 border-t border-subtle pt-3 text-center">
          {['Works', 'Followers', 'Following'].map((l) => (
            <span key={l}>
              <span className="block font-display text-[18px] text-primary">0</span>
              <span className="block text-[11px] text-tertiary">{l}</span>
            </span>
          ))}
        </div>
      </div>
    </div>
  )
}

/** One short, skippable step (PRD FR-003): a face, a username, and optionally what they're here for. */
export function OnboardingForm({ profile }: { profile: Profile }) {
  const router = useRouter()
  const [username, setUsername] = useState(profile.username)
  const [interests, setInterests] = useState(profile.interests as Intents)
  const [genres, setGenres] = useState('')
  const [avatar, setAvatar] = useState<AvatarConfig>(() => profile.avatar ?? randomFace())
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const finish = async (body: object) => {
    setBusy(true)
    setError(null)
    try {
      await api('/me/profile', { method: 'PUT', body: { ...body, onboarded: true } })
      router.replace(routes.library)
      router.refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'That didn’t save.')
      setBusy(false)
    }
  }

  return (
    <div className="grid gap-8 lg:grid-cols-[1fr_300px] lg:gap-12">
      {/* the preview leads on phones (it's the reward for filling in the form), and stays beside it on desktop */}
      <div className="lg:order-2">
        <div className="lg:sticky lg:top-8">
          <p className="mb-2 text-[12px] font-medium uppercase tracking-[0.06em] text-tertiary">
            How others will see you
          </p>
          <ProfilePreview
            profile={profile}
            avatar={avatar}
            username={username}
            interests={interests}
            genres={splitLabels(genres)}
          />
        </div>
      </div>
      <Form
        onSubmit={(e) => {
          e.preventDefault()
          void finish({ username, avatar, interests, genres: splitLabels(genres) })
        }}
        className="flex flex-col gap-8"
      >
        {error && <InlineAlert>{error}</InlineAlert>}
        <fieldset className="flex flex-col gap-3">
          <legend className="mb-3 flex items-center gap-2 text-sm font-medium text-primary">
            <span aria-hidden="true" className={step}>
              1
            </span>
            Your avatar
          </legend>
          <AvatarBuilder
            name={profile.displayName}
            seed={profile.avatarSeed}
            value={avatar}
            onChange={setAvatar}
          />
        </fieldset>
        <div className="flex gap-2">
          <span aria-hidden="true" className={`${step} mt-0.5`}>
            2
          </span>
          <div className="flex-1">
            <UsernameField value={username} onChange={setUsername} current="" />
          </div>
        </div>
        <div className="flex gap-2">
          <span aria-hidden="true" className={`${step} mt-0.5`}>
            3
          </span>
          <div className="flex flex-1 flex-col gap-5">
            <IntentPicker value={interests} onChange={setInterests} />
            <TextField
              name="genres"
              label="Genres and subjects (optional)"
              description="Separate with commas."
              value={genres}
              onChange={setGenres}
            />
          </div>
        </div>
        <div className="sticky bottom-0 -mx-4 flex items-center justify-between gap-3 border-t border-subtle bg-app px-4 py-3 sm:static sm:mx-0 sm:border-0 sm:bg-transparent sm:px-0 sm:py-0">
          {/* skipping still keeps the suggested username, so the account has a stable public handle */}
          <Button variant="quiet" isDisabled={busy} onPress={() => void finish({ avatar })}>
            Skip for now
          </Button>
          <Button type="submit" variant="primary" size="lg" isDisabled={busy}>
            {busy ? 'One moment…' : 'Continue'}
          </Button>
        </div>
      </Form>
    </div>
  )
}

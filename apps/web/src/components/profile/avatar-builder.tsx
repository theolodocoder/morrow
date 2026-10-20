'use client'
import { useState } from 'react'
import { Label, Radio, RadioGroup, Tab, TabList, TabPanel, Tabs } from 'react-aria-components'
import { AVATAR_PARTS, type AvatarConfig } from '@morrow/contracts'
import { Button } from '@/components/ui/button'
import { InlineAlert } from '@/components/ui/inline-alert'
import { CheckIcon, ShuffleIcon } from '@/components/ui/icons'
import { api } from '@/lib/client-api'
import {
  AVATAR_BACKGROUNDS,
  AVATAR_HAIR_COLORS,
  AVATAR_LABELS,
  AVATAR_SKIN,
  Avatar,
  AvatarArt,
} from './avatar'

type Face = Extract<AvatarConfig, { style: 'face' }>
type Part = Exclude<keyof Face, 'style'>

const roll = (n: number) => Math.floor(Math.random() * n)
export function randomFace(): Face {
  return {
    style: 'face',
    skin: roll(AVATAR_PARTS.skin),
    hair: roll(AVATAR_PARTS.hair),
    hairColor: roll(AVATAR_PARTS.hairColor),
    eyes: roll(AVATAR_PARTS.eyes),
    mouth: roll(AVATAR_PARTS.mouth),
    accessory: roll(AVATAR_PARTS.accessory),
    background: roll(AVATAR_PARTS.background),
  }
}

const SWATCH_LABELS: Record<'skin' | 'hairColor' | 'background', string[]> = {
  skin: ['Lightest', 'Light', 'Medium light', 'Medium', 'Medium deep', 'Deep'],
  hairColor: ['Black', 'Brown', 'Chestnut', 'Blonde', 'Auburn', 'Grey', 'Blue'],
  background: ['Parchment', 'Sage', 'Peach', 'Mist', 'Lilac', 'Butter', 'Sea glass', 'Stone'],
}
const SWATCH_COLORS = { skin: AVATAR_SKIN, hairColor: AVATAR_HAIR_COLORS, background: AVATAR_BACKGROUNDS }

const optionClass =
  'cursor-default rounded-full outline-none ring-offset-2 ring-offset-[var(--bg-app)] data-[selected]:ring-2 data-[selected]:ring-[var(--action-primary-bg)] data-[focus-visible]:ring-2 data-[focus-visible]:ring-focus'

/** One part of the face, as a row of choices you can see (each a radio, named for screen readers). */
const PART_LABELS: Record<Part, string> = {
  hair: 'Hair',
  hairColor: 'Hair colour',
  skin: 'Skin tone',
  eyes: 'Eyes',
  mouth: 'Mouth',
  accessory: 'Extras',
  background: 'Background',
}

function PartPicker({ part, face, onChange }: { part: Part; face: Face; onChange: (f: Face) => void }) {
  const label = PART_LABELS[part]
  const swatch = part === 'skin' || part === 'hairColor' || part === 'background'
  return (
    <RadioGroup
      value={String(face[part])}
      onChange={(v) => onChange({ ...face, [part]: Number(v) })}
      orientation="horizontal"
      className="flex flex-col gap-2"
    >
      <Label className="sr-only">{label}</Label>
      <div className="flex flex-wrap gap-2.5">
        {Array.from({ length: AVATAR_PARTS[part] }, (_, i) => (
          <Radio
            key={i}
            value={String(i)}
            aria-label={
              swatch
                ? SWATCH_LABELS[part as 'skin'][i]
                : AVATAR_LABELS[part as 'hair' | 'eyes' | 'mouth' | 'accessory'][i]
            }
            className={optionClass}
          >
            {swatch ? (
              <span
                className="block size-7 rounded-full border border-subtle"
                style={{ background: SWATCH_COLORS[part as 'skin'][i] }}
              />
            ) : (
              <span className="block overflow-hidden rounded-full">
                <AvatarArt config={{ ...face, [part]: i }} size={40} />
              </span>
            )}
          </Radio>
        ))}
      </div>
    </RadioGroup>
  )
}

/** Build a face from parts, or choose initials. Controlled: the caller decides when to save. */
export function AvatarBuilder({
  name,
  seed,
  value,
  onChange,
}: {
  name: string
  seed: string
  value: AvatarConfig
  onChange: (v: AvatarConfig) => void
}) {
  // Remember the face while trying initials, so switching back doesn't lose it.
  const [lastFace, setLastFace] = useState<Face>(value.style === 'face' ? value : randomFace())
  const face = value.style === 'face' ? value : lastFace
  const setFace = (f: Face) => {
    setLastFace(f)
    onChange(f)
  }
  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-center gap-5">
        <Avatar name={name} seed={seed} avatar={value} size={96} />
        <div className="flex flex-col gap-2">
          <RadioGroup
            value={value.style}
            onChange={(v) =>
              onChange(v === 'face' ? face : { style: 'initials', background: face.background })
            }
            orientation="horizontal"
            aria-label="Avatar style"
            className="flex gap-1 rounded-sm border border-subtle p-0.5"
          >
            {(['face', 'initials'] as const).map((s) => (
              <Radio
                key={s}
                value={s}
                className="cursor-default rounded-[3px] px-3 py-1 text-[13px] text-secondary outline-none data-[selected]:bg-selected data-[selected]:text-primary data-[focus-visible]:ring-2 data-[focus-visible]:ring-focus"
              >
                {s === 'face' ? 'Face' : 'Initials'}
              </Radio>
            ))}
          </RadioGroup>
          {value.style === 'face' && (
            <Button size="sm" variant="secondary" onPress={() => setFace(randomFace())}>
              <ShuffleIcon size={16} />
              Shuffle
            </Button>
          )}
        </div>
      </div>
      {value.style === 'face' ? (
        // One part at a time: the choices stay out of the way until you ask for them.
        <Tabs className="flex flex-col gap-3">
          <TabList
            aria-label="Avatar parts"
            className="flex gap-1 overflow-x-auto border-b border-subtle [scrollbar-width:none]"
          >
            {(Object.keys(PART_LABELS) as Part[]).map((p) => (
              <Tab
                key={p}
                id={p}
                className="-mb-px cursor-default whitespace-nowrap border-b-2 border-transparent px-2.5 pb-2 text-[13px] text-secondary outline-none data-[selected]:border-action data-[selected]:text-primary data-[focus-visible]:ring-2 data-[focus-visible]:ring-focus"
              >
                {PART_LABELS[p]}
              </Tab>
            ))}
          </TabList>
          {(Object.keys(PART_LABELS) as Part[]).map((p) => (
            <TabPanel
              key={p}
              id={p}
              className="outline-none data-[focus-visible]:ring-2 data-[focus-visible]:ring-focus"
            >
              <PartPicker part={p} face={face} onChange={setFace} />
            </TabPanel>
          ))}
        </Tabs>
      ) : (
        <PartPicker
          part="background"
          face={{ ...face, background: value.background }}
          onChange={(f) => onChange({ style: 'initials', background: f.background })}
        />
      )}
    </div>
  )
}

/** Settings: the builder with its own save, so changing a face doesn't mean resubmitting the whole profile. */
export function AvatarEditor({
  name,
  seed,
  initial,
}: {
  name: string
  seed: string
  initial: AvatarConfig | null
}) {
  const [value, setValue] = useState<AvatarConfig>(initial ?? randomFace())
  const [saved, setSaved] = useState(JSON.stringify(initial))
  const [state, setState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
  const dirty = JSON.stringify(value) !== saved
  return (
    <section aria-labelledby="avatar-heading" className="mb-12 flex flex-col gap-4">
      <h2 id="avatar-heading" className="text-sm font-medium text-primary">
        Your avatar
      </h2>
      <AvatarBuilder name={name} seed={seed} value={value} onChange={setValue} />
      {state === 'error' && <InlineAlert>That didn’t save. Try again.</InlineAlert>}
      <div className="flex items-center gap-3">
        <Button
          variant="primary"
          isDisabled={!dirty || state === 'saving'}
          onPress={async () => {
            setState('saving')
            try {
              await api('/me/profile', { method: 'PUT', body: { avatar: value } })
              setSaved(JSON.stringify(value))
              setState('saved')
            } catch {
              setState('error')
            }
          }}
        >
          {state === 'saving' ? 'Saving…' : 'Save avatar'}
        </Button>
        <span className="inline-flex items-center gap-1 text-[13px] text-secondary" role="status">
          {state === 'saved' && !dirty && (
            <>
              <CheckIcon size={16} /> Saved
            </>
          )}
        </span>
      </div>
    </section>
  )
}

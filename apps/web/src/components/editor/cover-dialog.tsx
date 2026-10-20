'use client'
import { useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'
import { Label, Radio, RadioGroup } from 'react-aria-components'
import { COVER_LAYOUTS, COVER_MOTIFS, type CoverConfig } from '@morrow/contracts'
import { Button } from '@/components/ui/button'
import { Dialog } from '@/components/ui/dialog'
import { InlineAlert } from '@/components/ui/inline-alert'
import { ShuffleIcon } from '@/components/ui/icons'
import { toast } from '@/components/ui/toast'
import { COVER_PALETTES, LAYOUT_NAMES, MOTIF_NAMES, WorkCover } from '@/components/work-cover'
import { api } from '@/lib/client-api'

const PALETTE_NAMES = ['Clay', 'Ink and gold', 'Moss', 'Tide', 'Plum', 'Parchment', 'Butter', 'Mist']
const option =
  'press grid cursor-default place-items-center rounded-md outline-none transition-shadow data-[selected]:ring-2 data-[selected]:ring-[var(--action-primary-bg)] data-[selected]:ring-offset-2 data-[selected]:ring-offset-[var(--bg-raised)] data-[focus-visible]:ring-2 data-[focus-visible]:ring-focus'

/**
 * Choose a cover (P-051): a palette, a motif and where the title sits, with the result shown large as you choose.
 * Covers are drawn, so there's nothing to upload or moderate; image covers can come later as one more option.
 */
export function CoverDialog({
  workId,
  title,
  cover,
  isOpen,
  onOpenChange,
}: {
  workId: string
  title: string
  cover: CoverConfig
  isOpen: boolean
  onOpenChange: (o: boolean) => void
}) {
  const router = useRouter()
  const [draft, setDraft] = useState(cover)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    if (isOpen) {
      setDraft(cover)
      setError(null)
    }
  }, [isOpen, cover])
  const set = (p: Partial<CoverConfig>) => setDraft((d) => ({ ...d, ...p }))
  const shuffle = () =>
    setDraft({
      palette: Math.floor(Math.random() * COVER_PALETTES.length),
      motif: Math.floor(Math.random() * COVER_MOTIFS),
      layout: COVER_LAYOUTS[Math.floor(Math.random() * COVER_LAYOUTS.length)]!,
    })

  async function save(next: CoverConfig | null) {
    setBusy(true)
    setError(null)
    try {
      await api(`/works/${workId}`, { method: 'PATCH', body: { cover: next } })
      onOpenChange(false)
      toast(next ? 'Cover saved' : 'Back to the generated cover')
      router.refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Couldn’t save the cover.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog title="Cover" isOpen={isOpen} onOpenChange={onOpenChange}>
      <div className="flex flex-col gap-5">
        {error && <InlineAlert>{error}</InlineAlert>}
        <div className="grid gap-5 sm:grid-cols-[150px_1fr]">
          <div className="mx-auto w-[130px] sm:w-[150px]">
            {/* re-mounts on change, so each choice lands with a small pop */}
            <div key={JSON.stringify(draft)} className="badge-pop">
              <WorkCover cover={draft} title={title} size="card" />
            </div>
          </div>
          <div className="flex flex-col gap-4">
            <RadioGroup
              value={String(draft.palette)}
              onChange={(v) => set({ palette: Number(v) })}
              className="flex flex-col gap-2"
            >
              <Label className="text-sm font-medium text-primary">Colours</Label>
              <div className="flex flex-wrap gap-2.5">
                {COVER_PALETTES.map((p, i) => (
                  <Radio
                    key={i}
                    value={String(i)}
                    aria-label={PALETTE_NAMES[i]}
                    className={`${option} size-8 rounded-full`}
                  >
                    <span
                      aria-hidden="true"
                      className="block size-8 rounded-full border border-[rgb(0_0_0/.08)]"
                      style={{ background: `linear-gradient(135deg, ${p.ground} 55%, ${p.motif} 55%)` }}
                    />
                  </Radio>
                ))}
              </div>
            </RadioGroup>
            <RadioGroup
              value={String(draft.motif)}
              onChange={(v) => set({ motif: Number(v) })}
              className="flex flex-col gap-2"
            >
              <Label className="text-sm font-medium text-primary">Motif</Label>
              <div className="flex flex-wrap gap-2">
                {MOTIF_NAMES.map((name, i) => (
                  <Radio key={name} value={String(i)} aria-label={name} className={`${option} w-11`}>
                    <WorkCover cover={{ ...draft, motif: i, layout: 'classic' }} title=" " />
                  </Radio>
                ))}
              </div>
            </RadioGroup>
            <RadioGroup
              value={draft.layout}
              onChange={(v) => set({ layout: v as CoverConfig['layout'] })}
              orientation="horizontal"
              className="flex flex-col gap-2"
            >
              <Label className="text-sm font-medium text-primary">Title</Label>
              <div className="flex gap-1 rounded-full bg-hover p-1">
                {COVER_LAYOUTS.map((l) => (
                  <Radio
                    key={l}
                    value={l}
                    className="press flex-1 cursor-default rounded-full px-3 py-1.5 text-center text-[13px] text-secondary outline-none data-[selected]:bg-canvas data-[selected]:text-primary data-[selected]:shadow-sm data-[focus-visible]:ring-2 data-[focus-visible]:ring-focus"
                  >
                    {LAYOUT_NAMES[l]}
                  </Radio>
                ))}
              </div>
            </RadioGroup>
          </div>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex gap-1">
            <Button variant="quiet" size="sm" onPress={shuffle}>
              <ShuffleIcon size={15} />
              Surprise me
            </Button>
            <Button variant="quiet" size="sm" isDisabled={busy} onPress={() => void save(null)}>
              Reset
            </Button>
          </div>
          <div className="flex gap-2">
            <Button variant="quiet" onPress={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button variant="primary" isDisabled={busy} onPress={() => void save(draft)}>
              {busy ? 'Saving…' : 'Save cover'}
            </Button>
          </div>
        </div>
      </div>
    </Dialog>
  )
}

'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { InlineAlert } from '@/components/ui/inline-alert'
import { api } from '@/lib/client-api'

type Limits = {
  privateWorks: number | null
  membersPerWork: number | null
  branchesPerWork: number | null
  exportFormats: string[]
  aiCreditsPerMonth: number | null
}
type Plan = {
  key: string
  name: string
  description: string
  priceMonthly: number | null
  limits: Limits
  features: string[]
  active: boolean
}
const LIMITS: { key: 'privateWorks' | 'membersPerWork' | 'branchesPerWork'; label: string }[] = [
  { key: 'privateWorks', label: 'Private works' },
  { key: 'membersPerWork', label: 'People per work' },
  { key: 'branchesPerWork', label: 'Branches per work' },
]

/** Limits and prices are data (PRD §18). Empty limit = unlimited. Every save is audited. */
export function PlanEditor({ plan, editable }: { plan: Plan; editable: boolean }) {
  const router = useRouter()
  const [p, setP] = useState(plan)
  const [state, setState] = useState<string | null>(null)
  const num = (v: string) => (v === '' ? null : Math.max(0, Math.floor(Number(v))))
  async function save() {
    setState(null)
    try {
      await api(`/admin/plans/${p.key}`, {
        method: 'PUT',
        body: {
          name: p.name,
          description: p.description,
          priceMonthly: p.priceMonthly,
          limits: p.limits,
          features: p.features,
          active: p.active,
        },
      })
      setState('Saved')
      router.refresh()
    } catch (e) {
      setState(e instanceof Error ? e.message : 'That didn’t save.')
    }
  }
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        void save()
      }}
      aria-label={`Plan ${p.name}`}
      className="flex flex-col gap-3 rounded-md border border-subtle bg-canvas p-4"
    >
      <fieldset disabled={!editable} className="flex flex-col gap-3">
        <div className="flex gap-3">
          <label className="flex flex-1 flex-col gap-1 text-sm">
            Name
            <input
              value={p.name}
              onChange={(e) => setP({ ...p, name: e.target.value })}
              className="h-9 rounded-sm border border-control bg-canvas px-2"
            />
          </label>
          <label className="flex w-36 flex-col gap-1 text-sm">
            Price a month ({'¢'})
            <input
              inputMode="numeric"
              value={p.priceMonthly ?? ''}
              onChange={(e) => setP({ ...p, priceMonthly: num(e.target.value) })}
              placeholder="free"
              className="h-9 rounded-sm border border-control bg-canvas px-2"
            />
          </label>
        </div>
        <div className="grid grid-cols-3 gap-3">
          {LIMITS.map((l) => (
            <label key={l.key} className="flex flex-col gap-1 text-sm">
              {l.label}
              <input
                inputMode="numeric"
                value={p.limits[l.key] ?? ''}
                placeholder="unlimited"
                onChange={(e) => setP({ ...p, limits: { ...p.limits, [l.key]: num(e.target.value) } })}
                className="h-9 rounded-sm border border-control bg-canvas px-2"
              />
            </label>
          ))}
        </div>
        <label className="inline-flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={p.active}
            onChange={(e) => setP({ ...p, active: e.target.checked })}
          />
          Shown and assignable
        </label>
      </fieldset>
      {state &&
        (state === 'Saved' ? (
          <p role="status" className="text-[13px] text-success">
            Saved
          </p>
        ) : (
          <InlineAlert>{state}</InlineAlert>
        ))}
      {editable && (
        <div className="flex justify-end">
          <Button type="submit" variant="primary">
            Save {p.name}
          </Button>
        </div>
      )}
    </form>
  )
}

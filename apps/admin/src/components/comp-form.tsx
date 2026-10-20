'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { InlineAlert } from '@/components/ui/inline-alert'
import { api } from '@/lib/client-api'

/** Grant or end a comped plan (admins). Billing can stay closed; this is how partners and testers get a plan. */
export function CompForm({
  userId,
  plans,
  comped,
}: {
  userId: string
  plans: { key: string; name: string }[]
  comped: boolean
}) {
  const router = useRouter()
  const [plan, setPlan] = useState(plans[1]?.key ?? plans[0]!.key)
  const [note, setNote] = useState('')
  const [error, setError] = useState<string | null>(null)
  const act = async (method: 'PUT' | 'DELETE') => {
    setError(null)
    try {
      await api(`/admin/users/${userId}/comp`, {
        method,
        body: method === 'PUT' ? { planKey: plan, note } : { note },
      })
      setNote('')
      router.refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'That didn’t work.')
    }
  }
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        void act('PUT')
      }}
      className="flex flex-col gap-3 rounded-md border border-subtle bg-canvas p-4"
    >
      <p className="text-sm font-medium">Comp a plan</p>
      {error && <InlineAlert>{error}</InlineAlert>}
      <label className="flex flex-col gap-1.5 text-sm">
        Plan
        <select
          value={plan}
          onChange={(e) => setPlan(e.target.value)}
          className="h-9 rounded-sm border border-control bg-canvas px-2"
        >
          {plans.map((p) => (
            <option key={p.key} value={p.key}>
              {p.name}
            </option>
          ))}
        </select>
      </label>
      <label className="flex flex-col gap-1.5 text-sm">
        Why (recorded in the audit)
        <input
          value={note}
          onChange={(e) => setNote(e.target.value)}
          minLength={3}
          required
          className="h-9 rounded-sm border border-control bg-canvas px-2"
        />
      </label>
      <div className="flex justify-end gap-2">
        {comped && (
          <Button variant="quiet" isDisabled={note.trim().length < 3} onPress={() => void act('DELETE')}>
            End comp
          </Button>
        )}
        <Button type="submit" variant="primary" isDisabled={note.trim().length < 3}>
          Grant
        </Button>
      </div>
    </form>
  )
}

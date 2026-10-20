'use client'
import { useCallback, useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { api } from '@/lib/client-api'

type Item = {
  id: string
  kind: string
  message: string
  path: string
  status: string
  from: string
  createdAt: string
}
const KIND: Record<string, string> = { bug: 'Broken', idea: 'Idea', praise: 'Love', other: 'Other' }

export function FeedbackInbox() {
  const [status, setStatus] = useState<'new' | 'triaged' | 'done'>('new')
  const [items, setItems] = useState<Item[] | null>(null)
  const load = useCallback(
    () => api<{ items: Item[] }>(`/admin/feedback?status=${status}`).then((r) => setItems(r.items)),
    [status],
  )
  useEffect(() => {
    setItems(null)
    void load()
  }, [load])
  const move = async (id: string, to: 'triaged' | 'done') => {
    await api(`/admin/feedback/${id}`, { method: 'PATCH', body: { status: to } })
    void load()
  }
  return (
    <div className="flex flex-col gap-4">
      <nav aria-label="Status" className="flex gap-1 border-b border-subtle">
        {(['new', 'triaged', 'done'] as const).map((s) => (
          <button
            key={s}
            type="button"
            aria-pressed={status === s}
            onClick={() => setStatus(s)}
            className={`-mb-px border-b-2 px-3 py-2 text-sm capitalize ${status === s ? 'border-action text-primary' : 'border-transparent text-secondary'}`}
          >
            {s}
          </button>
        ))}
      </nav>
      {!items ? (
        <p className="text-sm text-tertiary">Loading…</p>
      ) : items.length === 0 ? (
        <p className="text-secondary">Nothing here.</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {items.map((i) => (
            <li key={i.id} className="rounded-md border border-subtle bg-canvas p-4">
              <p className="text-[12px] text-secondary">
                {KIND[i.kind] ?? i.kind} · {i.from} · {new Date(i.createdAt).toLocaleString('en')} ·{' '}
                <span className="font-mono">{i.path || '—'}</span>
              </p>
              <p className="mt-1 whitespace-pre-line text-sm text-primary">{i.message}</p>
              <div className="mt-2 flex justify-end gap-2">
                {status === 'new' && (
                  <Button size="sm" variant="secondary" onPress={() => void move(i.id, 'triaged')}>
                    Triaged
                  </Button>
                )}
                {status !== 'done' && (
                  <Button size="sm" variant="quiet" onPress={() => void move(i.id, 'done')}>
                    Done
                  </Button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

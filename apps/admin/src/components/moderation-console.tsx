'use client'
import { useCallback, useEffect, useState } from 'react'
import { REPORT_CATEGORY_LABELS, type QueueReport } from '@morrow/contracts'
import { Button } from '@/components/ui/button'
import { InlineAlert } from '@/components/ui/inline-alert'
import { api } from '@/lib/client-api'

type Tab = 'open' | 'reviewing' | 'closed' | 'appeals' | 'featured'
type Act = 'dismiss' | 'hide_work' | 'remove_comment' | 'restrict_account'
type Appeal = {
  id: string
  message: string
  user: { name: string }
  action: { action: string; reason: string; targetType: string }
  createdAt: string
}
const when = new Intl.DateTimeFormat('en', {
  day: 'numeric',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit',
})

/**
 * The moderation console (FR-031): a queue of reports with the evidence snapshot, actions with a recorded reason, a
 * note back to the reporter, and appeals decided by someone else. Staff only (the API refuses everyone else).
 */
export function ModerationConsole() {
  const [tab, setTab] = useState<Tab>('open')
  return (
    <div className="flex flex-col gap-6">
      <nav aria-label="Queue" className="flex flex-wrap gap-1 border-b border-subtle">
        {(['open', 'reviewing', 'closed', 'appeals', 'featured'] as const).map((t) => (
          <button
            key={t}
            type="button"
            aria-pressed={tab === t}
            onClick={() => setTab(t)}
            className={`-mb-px border-b-2 px-3 py-2 text-sm capitalize outline-none focus-visible:ring-2 focus-visible:ring-focus ${tab === t ? 'border-action text-primary' : 'border-transparent text-secondary hover:text-primary'}`}
          >
            {t === 'featured' ? 'Editors’ picks' : t}
          </button>
        ))}
      </nav>
      {tab === 'appeals' ? <Appeals /> : tab === 'featured' ? <Featured /> : <Reports status={tab} />}
    </div>
  )
}

function Reports({ status }: { status: 'open' | 'reviewing' | 'closed' }) {
  const [items, setItems] = useState<QueueReport[] | null>(null)
  const load = useCallback(
    () =>
      api<{ items: QueueReport[] }>(`/moderation/reports?status=${status}`).then((r) => setItems(r.items)),
    [status],
  )
  useEffect(() => {
    setItems(null)
    void load()
  }, [load])
  if (!items) return <p className="text-sm text-tertiary">Loading…</p>
  if (!items.length)
    return <p className="py-12 text-center font-manuscript italic text-secondary">Nothing here.</p>
  return (
    <ul className="flex flex-col gap-4">
      {items.map((r) => (
        <ReportCard key={r.id} r={r} closed={status === 'closed'} onChange={() => void load()} />
      ))}
    </ul>
  )
}

function ReportCard({ r, closed, onChange }: { r: QueueReport; closed: boolean; onChange: () => void }) {
  const [action, setAction] = useState<'dismiss' | 'hide_work' | 'remove_comment' | 'restrict_account'>(
    'dismiss',
  )
  const [reason, setReason] = useState('')
  const [resolution, setResolution] = useState('')
  const [kind, setKind] = useState<'suspended' | 'muted'>('muted')
  const [days, setDays] = useState('7')
  const [error, setError] = useState<string | null>(null)
  // Only the decisions that make sense for what was reported.
  const actions: { id: Act; label: string }[] = [{ id: 'dismiss', label: 'Dismiss: no action needed' }]
  if (r.targetType === 'work' || r.snapshot.work)
    actions.push({ id: 'hide_work', label: 'Hide the work from public pages' })
  if (r.targetType === 'comment') actions.push({ id: 'remove_comment', label: 'Remove the comment' })
  if (r.subject) actions.push({ id: 'restrict_account', label: `Restrict ${r.subject.name}’s account` })
  async function resolve() {
    setError(null)
    try {
      await api(`/moderation/reports/${r.id}/resolve`, {
        method: 'POST',
        body: {
          action,
          reason,
          resolution,
          ...(action === 'restrict_account'
            ? { restriction: { kind, days: days ? Number(days) : null } }
            : {}),
        },
      })
      onChange()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'That didn’t work.')
    }
  }
  return (
    <li className="rounded-md border border-subtle bg-canvas p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="font-medium text-primary">
          {REPORT_CATEGORY_LABELS[r.category]} · {r.targetType}
        </p>
        <p className="text-[12px] text-secondary">
          Reported by {r.reporter.name} · {when.format(new Date(r.createdAt))}
          {r.reviewer ? ` · with ${r.reviewer}` : ''}
        </p>
      </div>
      {/* The evidence: exactly what was reported, as it was then. */}
      <dl className="mt-3 grid grid-cols-[110px_1fr] gap-x-3 gap-y-1 rounded-sm bg-app p-3 text-[13px]">
        {Object.entries(r.snapshot)
          .filter(([, v]) => v !== null && v !== '')
          .map(([k, v]) => (
            <div key={k} className="contents">
              <dt className="text-tertiary">{k}</dt>
              <dd className="whitespace-pre-line break-words text-primary">{String(v)}</dd>
            </div>
          ))}
      </dl>
      {r.details && (
        <p className="mt-2 text-sm text-primary">
          <span className="text-secondary">Reporter’s note:</span> {r.details}
        </p>
      )}
      {r.subject && (
        <p className="mt-1 text-[12px] text-secondary">
          About {r.subject.name}
          {r.priorActions
            ? ` · ${r.priorActions} earlier action${r.priorActions === 1 ? '' : 's'}`
            : ' · no earlier actions'}
        </p>
      )}
      {closed ? (
        <p className="mt-3 text-sm text-secondary">
          {r.status === 'actioned' ? 'Action taken.' : 'Dismissed.'} {r.resolution}
        </p>
      ) : (
        <form
          onSubmit={(e) => {
            e.preventDefault()
            void resolve()
          }}
          className="mt-4 flex flex-col gap-3 border-t border-subtle pt-4"
        >
          {error && <InlineAlert>{error}</InlineAlert>}
          <fieldset className="flex flex-col gap-1.5">
            <legend className="mb-1 text-sm font-medium text-primary">Decision</legend>
            {actions.map((a) => (
              <label key={a.id} className="inline-flex items-center gap-2 text-sm text-primary">
                <input
                  type="radio"
                  name={`action-${r.id}`}
                  checked={action === a.id}
                  onChange={() => setAction(a.id)}
                  className="accent-[var(--action-primary-bg)]"
                />
                {a.label}
              </label>
            ))}
          </fieldset>
          {action === 'restrict_account' && (
            <div className="flex flex-wrap items-center gap-3 text-sm">
              <label className="inline-flex items-center gap-2">
                Restriction
                <select
                  value={kind}
                  onChange={(e) => setKind(e.target.value as 'muted')}
                  className="h-9 rounded-sm border border-control bg-canvas px-2"
                >
                  <option value="muted">Mute (no posting)</option>
                  <option value="suspended">Suspend (read-only)</option>
                </select>
              </label>
              <label className="inline-flex items-center gap-2">
                for{' '}
                <input
                  type="number"
                  min={1}
                  max={365}
                  value={days}
                  onChange={(e) => setDays(e.target.value)}
                  className="h-9 w-20 rounded-sm border border-control bg-canvas px-2"
                />{' '}
                days
              </label>
              <span className="text-[12px] text-secondary">(empty: until lifted)</span>
            </div>
          )}
          <label className="flex flex-col gap-1.5 text-sm">
            <span className="font-medium text-primary">Reason (recorded in the audit history)</span>
            <input
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              minLength={3}
              required
              className="h-9 rounded-sm border border-control bg-canvas px-2 text-primary"
            />
          </label>
          <label className="flex flex-col gap-1.5 text-sm">
            <span className="font-medium text-primary">Note to the reporter (optional)</span>
            <input
              value={resolution}
              onChange={(e) => setResolution(e.target.value)}
              className="h-9 rounded-sm border border-control bg-canvas px-2 text-primary"
            />
          </label>
          <div className="flex justify-end gap-2">
            {r.status === 'open' && (
              <Button
                variant="quiet"
                onPress={async () => {
                  await api(`/moderation/reports/${r.id}/claim`, { method: 'POST', body: {} })
                  onChange()
                }}
              >
                Take it
              </Button>
            )}
            <Button type="submit" variant="primary" isDisabled={reason.trim().length < 3}>
              Record decision
            </Button>
          </div>
        </form>
      )}
    </li>
  )
}

function Appeals() {
  const [items, setItems] = useState<Appeal[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const load = useCallback(
    () => api<{ items: Appeal[] }>('/moderation/appeals').then((r) => setItems(r.items)),
    [],
  )
  useEffect(() => void load(), [load])
  if (!items) return <p className="text-sm text-tertiary">Loading…</p>
  if (!items.length)
    return <p className="py-12 text-center font-manuscript italic text-secondary">No open appeals.</p>
  return (
    <ul className="flex flex-col gap-4">
      {error && <InlineAlert>{error}</InlineAlert>}
      {items.map((a) => (
        <AppealCard key={a.id} a={a} onDone={() => void load()} onError={setError} />
      ))}
    </ul>
  )
}

function AppealCard({ a, onDone, onError }: { a: Appeal; onDone: () => void; onError: (e: string) => void }) {
  const [note, setNote] = useState('')
  const decide = async (decision: 'upheld' | 'overturned') => {
    try {
      await api(`/moderation/appeals/${a.id}/decide`, { method: 'POST', body: { decision, note } })
      onDone()
    } catch (e) {
      onError(e instanceof Error ? e.message : 'That didn’t work.')
    }
  }
  return (
    <li className="rounded-md border border-subtle bg-canvas p-4">
      <p className="font-medium text-primary">
        {a.user.name} appeals: {a.action.action.replace('_', ' ')} ({a.action.targetType})
      </p>
      <p className="text-[13px] text-secondary">Original reason: {a.action.reason}</p>
      <p className="mt-2 whitespace-pre-line rounded-sm bg-app px-3 py-2 text-sm text-primary">{a.message}</p>
      <label className="mt-3 flex flex-col gap-1.5 text-sm">
        <span className="font-medium text-primary">Decision note (sent to them)</span>
        <input
          value={note}
          onChange={(e) => setNote(e.target.value)}
          className="h-9 rounded-sm border border-control bg-canvas px-2 text-primary"
        />
      </label>
      <p className="mt-1 text-[12px] text-secondary">You can’t decide an appeal against your own decision.</p>
      <div className="mt-3 flex justify-end gap-2">
        <Button variant="secondary" isDisabled={note.trim().length < 3} onPress={() => void decide('upheld')}>
          Keep the decision
        </Button>
        <Button
          variant="primary"
          isDisabled={note.trim().length < 3}
          onPress={() => void decide('overturned')}
        >
          Overturn and restore
        </Button>
      </div>
    </li>
  )
}

function Featured() {
  const [path, setPath] = useState('')
  const [note, setNote] = useState('')
  const [state, setState] = useState<string | null>(null)
  const submit = async (method: 'PUT' | 'DELETE') => {
    setState(null)
    try {
      await api('/moderation/featured', {
        method,
        body: method === 'PUT' ? { publicPath: path, note } : { publicPath: path },
      })
      setState(method === 'PUT' ? 'Featured. It shows in Editors’ picks.' : 'Removed from Editors’ picks.')
    } catch (e) {
      setState(e instanceof Error ? e.message : 'That didn’t work.')
    }
  }
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        void submit('PUT')
      }}
      className="flex max-w-lg flex-col gap-3"
    >
      <p className="text-sm text-secondary">
        Editors’ picks are chosen by people and labelled as such in Discover, apart from anything ranked
        automatically.
      </p>
      <label className="flex flex-col gap-1.5 text-sm">
        <span className="font-medium text-primary">Public link or path</span>
        <input
          value={path}
          onChange={(e) => setPath(e.target.value.replace(/^.*\/works\//, ''))}
          placeholder="the-salt-orchard-1a2b3c4d5e"
          className="h-9 rounded-sm border border-control bg-canvas px-2 text-primary"
        />
      </label>
      <label className="flex flex-col gap-1.5 text-sm">
        <span className="font-medium text-primary">Why it’s worth reading (shown with it)</span>
        <input
          value={note}
          onChange={(e) => setNote(e.target.value)}
          maxLength={280}
          className="h-9 rounded-sm border border-control bg-canvas px-2 text-primary"
        />
      </label>
      {state && (
        <p role="status" className="text-[13px] text-secondary">
          {state}
        </p>
      )}
      <div className="flex justify-end gap-2">
        <Button variant="quiet" isDisabled={!path} onPress={() => void submit('DELETE')}>
          Remove
        </Button>
        <Button type="submit" variant="primary" isDisabled={!path}>
          Feature
        </Button>
      </div>
    </form>
  )
}

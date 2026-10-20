'use client'
import { useEffect, useState } from 'react'
import type { NotificationPreferences } from '@morrow/contracts'
import { Button } from '@/components/ui/button'
import { InlineAlert } from '@/components/ui/inline-alert'
import { BellIcon, MailIcon, MoonIcon } from '@/components/ui/icons'
import { api } from '@/lib/client-api'
import { SkeletonRows } from '@/components/ui/skeleton'

type Cat = keyof NotificationPreferences['categories']
const ROWS: { id: Cat; label: string; hint: string }[] = [
  { id: 'mentions', label: 'Mentions', hint: 'Someone @mentions you.' },
  {
    id: 'comments',
    label: 'Comments and replies',
    hint: 'New comments on your work, replies in your threads.',
  },
  {
    id: 'proposals',
    label: 'Proposal decisions',
    hint: 'Your proposal is accepted, declined or needs changes.',
  },
  { id: 'invitations', label: 'Invitations', hint: 'Someone invites you to a work.' },
  {
    id: 'activity',
    label: 'Work activity',
    hint: 'New proposals to review, people joining, merges, role changes.',
  },
  { id: 'publishing', label: 'Following', hint: 'Writers and works you follow publish something new.' },
]
const toTime = (m: number | null) =>
  m === null ? '' : `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`
const fromTime = (t: string) => (t ? Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5)) : null)

/** Per-category choices for in-app and email, and quiet hours for email (FR-030). */
export function NotificationSettings() {
  const [prefs, setPrefs] = useState<NotificationPreferences | null>(null)
  const [state, setState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
  useEffect(() => {
    void api<NotificationPreferences>('/me/notification-preferences').then((p) => {
      // First visit: suggest the browser's own time zone for quiet hours.
      setPrefs(
        p.timeZone === 'UTC' && p.quietStart === null
          ? { ...p, timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone }
          : p,
      )
    })
  }, [])
  if (!prefs) return <SkeletonRows count={4} avatar={false} lines={1} />

  const set = (c: Cat, channel: 'inApp' | 'email', v: boolean) =>
    setPrefs({ ...prefs, categories: { ...prefs.categories, [c]: { ...prefs.categories[c], [channel]: v } } })
  async function save() {
    setState('saving')
    try {
      setPrefs(
        await api<NotificationPreferences>('/me/notification-preferences', { method: 'PUT', body: prefs }),
      )
      setState('saved')
    } catch {
      setState('error')
    }
  }
  const quiet = prefs.quietStart !== null && prefs.quietEnd !== null
  return (
    <div className="flex flex-col gap-8">
      <table className="w-full border-collapse text-left">
        <caption className="sr-only">What you’re told about, and how</caption>
        <thead>
          <tr className="border-b border-subtle text-[12px] text-secondary">
            <th scope="col" className="py-2 font-medium">
              Notify me about
            </th>
            <th scope="col" className="w-20 py-2 text-center font-medium">
              <span className="inline-flex items-center gap-1">
                <BellIcon size={14} />
                In app
              </span>
            </th>
            <th scope="col" className="w-20 py-2 text-center font-medium">
              <span className="inline-flex items-center gap-1">
                <MailIcon size={14} />
                Email
              </span>
            </th>
          </tr>
        </thead>
        <tbody>
          {ROWS.map((r) => (
            <tr key={r.id} className="border-b border-subtle">
              <th scope="row" className="py-3 font-normal">
                <span className="block text-sm text-primary">{r.label}</span>
                <span className="block text-[12px] text-secondary">{r.hint}</span>
              </th>
              {(['inApp', 'email'] as const).map((ch) => (
                <td key={ch} className="text-center">
                  <input
                    type="checkbox"
                    aria-label={`${r.label}: ${ch === 'inApp' ? 'in app' : 'email'}`}
                    checked={prefs.categories[r.id][ch]}
                    onChange={(e) => set(r.id, ch, e.target.checked)}
                    className="size-4 accent-[var(--action-primary-bg)]"
                  />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>

      <fieldset className="flex flex-col gap-3">
        <legend className="mb-1 inline-flex items-center gap-1.5 text-sm font-medium text-primary">
          <MoonIcon size={16} />
          Quiet hours
        </legend>
        <label className="inline-flex items-center gap-2 text-sm text-primary">
          <input
            type="checkbox"
            checked={quiet}
            onChange={(e) =>
              setPrefs({
                ...prefs,
                quietStart: e.target.checked ? 22 * 60 : null,
                quietEnd: e.target.checked ? 7 * 60 : null,
              })
            }
            className="size-4 accent-[var(--action-primary-bg)]"
          />
          Hold emails overnight
        </label>
        {quiet && (
          <div className="flex flex-wrap items-center gap-3 text-sm">
            <label className="inline-flex items-center gap-2">
              From{' '}
              <input
                type="time"
                value={toTime(prefs.quietStart)}
                onChange={(e) => setPrefs({ ...prefs, quietStart: fromTime(e.target.value) })}
                className="h-9 rounded-sm border border-control bg-canvas px-2 text-primary"
              />
            </label>
            <label className="inline-flex items-center gap-2">
              until{' '}
              <input
                type="time"
                value={toTime(prefs.quietEnd)}
                onChange={(e) => setPrefs({ ...prefs, quietEnd: fromTime(e.target.value) })}
                className="h-9 rounded-sm border border-control bg-canvas px-2 text-primary"
              />
            </label>
            <span className="text-[12px] text-secondary">{prefs.timeZone}</span>
          </div>
        )}
        <p className="text-[12px] text-secondary">
          Emails that arrive during quiet hours are sent when they end. In-app notifications are always quiet:
          they never pop up while you write.
        </p>
      </fieldset>

      {state === 'error' && <InlineAlert>Couldn’t save your preferences.</InlineAlert>}
      <div className="flex items-center justify-end gap-3">
        {state === 'saved' && (
          <span role="status" className="text-[13px] text-success">
            Saved
          </span>
        )}
        <Button variant="primary" isDisabled={state === 'saving'} onPress={() => void save()}>
          {state === 'saving' ? 'Saving…' : 'Save preferences'}
        </Button>
      </div>
    </div>
  )
}

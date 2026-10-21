'use client'
import { useEffect, useState } from 'react'
import { Button as AriaButton, Dialog, DialogTrigger, Popover } from 'react-aria-components'
import type { WritingStats } from '@morrow/contracts'
import { Button } from '@/components/ui/button'
import { toast } from '@/components/ui/toast'
import { api } from '@/lib/client-api'
import { localDay, onLocalWords } from './writing-tracker'

const GOALS = [0, 250, 500, 1000, 1667]

/**
 * Today's writing (P-055), in the editor's bar: a ring that fills toward your daily goal as you type, the streak
 * beside it, and a popover with the week and the goal. It celebrates once when the goal is met.
 */
export function GoalRing() {
  const [stats, setStats] = useState<WritingStats | null>(null)
  const [extra, setExtra] = useState(0)
  useEffect(() => {
    void api<WritingStats>(`/me/writing?day=${localDay()}`).then(setStats, () => {})
    return onLocalWords((d) => setExtra((x) => x + d))
  }, [])
  const today = Math.max(0, (stats?.today ?? 0) + extra)
  const goal = stats?.goal ?? 0
  const share = goal ? Math.min(1, today / goal) : 0
  const met = goal > 0 && today >= goal
  const [celebrated, setCelebrated] = useState(false)
  useEffect(() => {
    if (met && stats && stats.today < goal && !celebrated) {
      setCelebrated(true)
      toast(`Daily goal met: ${goal.toLocaleString('en')} words. Well written.`)
    }
  }, [met, stats, goal, celebrated])
  // the streak counts today as soon as there's a word in it
  const streak = stats ? stats.streak + (stats.today === 0 && today > 0 ? 1 : 0) : 0
  const c = 2 * Math.PI * 8

  async function setGoal(g: number) {
    await api('/me/writing/goal', { method: 'PUT', body: { goal: g } })
    setStats((s) => (s ? { ...s, goal: g } : s))
  }

  if (!stats) return null
  // Today's bar draws the live count, so it is part of the scale too, or it outgrows the chart.
  const week = stats.week.map((d, i) => (i === 6 ? today : d.words))
  const max = Math.max(goal, ...week, 1)
  const best = Math.max(stats.best, streak)
  return (
    <DialogTrigger>
      <AriaButton
        aria-label={`Today: ${today} words${goal ? ` of ${goal}` : ''}${streak ? `, ${streak}-day streak` : ''}`}
        className="press flex h-8 items-center gap-1.5 rounded-full px-2 text-[12px] text-secondary outline-none hover:bg-hover data-[focus-visible]:ring-2 data-[focus-visible]:ring-focus"
      >
        <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true" className="-rotate-90">
          <circle cx="10" cy="10" r="8" fill="none" stroke="var(--bg-hover)" strokeWidth="2.5" />
          {goal > 0 && (
            <circle
              cx="10"
              cy="10"
              r="8"
              fill="none"
              stroke={met ? 'var(--text-success)' : 'var(--action-primary-bg)'}
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeDasharray={`${c * share} ${c}`}
              style={{ transition: 'stroke-dasharray 300ms ease-out' }}
            />
          )}
        </svg>
        <span className="hidden tabular-nums sm:inline">{today.toLocaleString('en')}</span>
        {streak > 1 && (
          <span className="hidden items-center gap-0.5 text-accent sm:inline-flex">
            <SunGlyph />
            {streak}
          </span>
        )}
      </AriaButton>
      <Popover
        placement="bottom end"
        className="popover w-72 rounded-lg border border-subtle bg-raised p-4 shadow-[0_2px_4px_rgb(34_34_31/.06),0_12px_32px_rgb(34_34_31/.14)]"
      >
        <Dialog aria-label="Your writing" className="flex flex-col gap-4 outline-none">
          <div className="flex items-baseline justify-between">
            <p className="font-display text-[26px] leading-none text-primary">
              {today.toLocaleString('en')}
              <span className="ml-1 font-ui text-[13px] text-secondary">
                {goal ? `of ${goal.toLocaleString('en')}` : 'words today'}
              </span>
            </p>
            <p className="inline-flex items-center gap-1 text-[13px] text-accent">
              <SunGlyph />
              {streak}-day streak
            </p>
          </div>
          <div aria-hidden="true" className="flex h-16 items-end gap-1.5">
            {stats.week.map((d, i) => {
              const words = week[i]!
              return (
                <div key={d.day} className="flex flex-1 flex-col items-center gap-1">
                  <div
                    className={`w-full rounded-t-sm ${words ? (goal && words >= goal ? 'bg-[var(--text-success)]' : 'bg-action') : 'bg-hover'}`}
                    style={{ height: `${Math.max(4, (words / max) * 48)}px` }}
                  />
                  <span className="text-[10px] text-tertiary">
                    {new Date(`${d.day}T12:00:00`).toLocaleDateString('en', { weekday: 'narrow' })}
                  </span>
                </div>
              )
            })}
          </div>
          <p className="text-[12px] text-tertiary">
            Best streak: {best} {best === 1 ? 'day' : 'days'}. Any words count.
          </p>
          <div>
            <p className="mb-1.5 text-[12px] font-medium text-primary">Daily goal</p>
            <div className="flex flex-wrap gap-1">
              {GOALS.map((g) => (
                <Button
                  key={g}
                  size="sm"
                  variant={goal === g ? 'primary' : 'secondary'}
                  aria-pressed={goal === g}
                  onPress={() => void setGoal(g)}
                >
                  {g === 0 ? 'None' : g === 1667 ? 'NaNoWriMo' : g}
                </Button>
              ))}
            </div>
          </div>
        </Dialog>
      </Popover>
    </DialogTrigger>
  )
}

/** The streak's mark: the brand's sun. */
const SunGlyph = () => (
  <svg width="12" height="12" viewBox="0 0 20 20" aria-hidden="true">
    <circle cx="10" cy="10" r="4" fill="currentColor" />
    <path
      d="M10 1.5v2.5M10 16v2.5M1.5 10H4M16 10h2.5M4 4l1.8 1.8M14.2 14.2 16 16M4 16l1.8-1.8M14.2 5.8 16 4"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
    />
  </svg>
)

'use client'
import { useMemo, useState } from 'react'
import type { Dashboard } from '@morrow/contracts'
import { compact } from '@/lib/format'

import { METRIC_LABELS, type MetricKey as Key } from './metrics'

const W = 720
const H = 220
const PAD = { top: 16, right: 12, bottom: 28, left: 36 }

const shortDay = (d: string) =>
  new Date(`${d}T00:00:00Z`).toLocaleDateString('en', { month: 'short', day: 'numeric', timeZone: 'UTC' })

/**
 * One metric over the period, as an area chart. Hover or focus a day for its number. The same data is always
 * available as a table (below the chart) for screen readers and anyone who prefers numbers.
 */
export function DashboardChart({ daily }: { daily: Dashboard['daily'] }) {
  const [metric, setMetric] = useState<Key>('reads')
  const [hover, setHover] = useState<number | null>(null)
  const values = daily.map((d) => d[metric])
  const max = Math.max(1, ...values)
  // a round top for the axis: 1, 2, 5, 10, 20, 50 …
  const top = useMemo(() => {
    const step = 10 ** Math.floor(Math.log10(max))
    return [1, 2, 5, 10].map((m) => m * step).find((v) => v >= max) ?? max
  }, [max])
  const x = (i: number) => PAD.left + (i * (W - PAD.left - PAD.right)) / Math.max(1, daily.length - 1)
  const y = (v: number) => PAD.top + (1 - v / top) * (H - PAD.top - PAD.bottom)
  const line = values.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ')
  const area = `${line} L${x(values.length - 1).toFixed(1)},${y(0)} L${x(0).toFixed(1)},${y(0)} Z`
  const labelEvery = Math.ceil(daily.length / 6)
  const total = values.reduce((a, b) => a + b, 0)

  return (
    <section aria-labelledby="chart-heading" className="rounded-lg border border-subtle bg-canvas p-4 sm:p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="chart-heading" className="text-[15px] font-medium text-primary">
          {METRIC_LABELS[metric]}{' '}
          <span className="font-normal text-secondary">· {compact(total)} in total</span>
        </h2>
        <div role="group" aria-label="Metric" className="flex flex-wrap gap-1">
          {(Object.keys(METRIC_LABELS) as Key[]).map((k) => (
            <button
              key={k}
              type="button"
              aria-pressed={metric === k}
              onClick={() => setMetric(k)}
              className="rounded-full border border-subtle px-2.5 py-1 text-[12px] text-secondary outline-none hover:text-primary focus-visible:ring-2 focus-visible:ring-focus aria-pressed:border-action aria-pressed:bg-action aria-pressed:text-action-fg"
            >
              {METRIC_LABELS[k]}
            </button>
          ))}
        </div>
      </div>
      <div className="relative mt-3">
        <svg
          viewBox={`0 0 ${W} ${H}`}
          className="h-auto w-full"
          aria-hidden="true"
          onMouseLeave={() => setHover(null)}
        >
          {/* whole-number ticks only: no "0.5 reads" */}
          {(top >= 2 && top % 2 === 0 ? [0, 0.5, 1] : [0, 1]).map((f) => (
            <g key={f}>
              <line
                x1={PAD.left}
                x2={W - PAD.right}
                y1={y(top * f)}
                y2={y(top * f)}
                stroke="var(--border-subtle)"
                strokeDasharray={f ? '3 4' : undefined}
              />
              <text
                x={PAD.left - 8}
                y={y(top * f) + 4}
                textAnchor="end"
                fontSize="11"
                fill="var(--text-tertiary)"
              >
                {compact(Math.round(top * f))}
              </text>
            </g>
          ))}
          <path d={area} fill="var(--action-primary-bg)" opacity="0.12" />
          <path
            d={line}
            fill="none"
            stroke="var(--action-primary-bg)"
            strokeWidth="2"
            strokeLinejoin="round"
          />
          {daily.map((d, i) => (
            <g key={d.day}>
              {i % labelEvery === 0 && (
                <text x={x(i)} y={H - 8} textAnchor="middle" fontSize="11" fill="var(--text-tertiary)">
                  {shortDay(d.day)}
                </text>
              )}
              <rect
                x={x(i) - (W - PAD.left - PAD.right) / daily.length / 2}
                y={PAD.top}
                width={(W - PAD.left - PAD.right) / daily.length}
                height={H - PAD.top - PAD.bottom}
                fill="transparent"
                onMouseEnter={() => setHover(i)}
              />
            </g>
          ))}
          {hover !== null && (
            <g>
              <line x1={x(hover)} x2={x(hover)} y1={PAD.top} y2={y(0)} stroke="var(--border-control)" />
              <circle cx={x(hover)} cy={y(values[hover]!)} r="4" fill="var(--action-primary-bg)" />
            </g>
          )}
        </svg>
        {hover !== null && (
          <div
            className="pointer-events-none absolute top-0 -translate-x-1/2 rounded-sm border border-subtle bg-raised px-2 py-1 text-[12px] shadow-sm"
            style={{ left: `${(x(hover) / W) * 100}%` }}
          >
            <span className="text-secondary">{shortDay(daily[hover]!.day)}</span>{' '}
            <span className="font-medium text-primary">{values[hover]}</span>
          </div>
        )}
      </div>
      <details className="mt-2 text-[13px]">
        <summary className="cursor-pointer text-secondary hover:text-primary">Show as a table</summary>
        <div className="mt-2 max-h-64 overflow-y-auto" tabIndex={0}>
          <table className="w-full text-left">
            <caption className="sr-only">{METRIC_LABELS[metric]} by day</caption>
            <thead>
              <tr className="text-tertiary">
                <th scope="col" className="py-1 font-normal">
                  Day
                </th>
                {(Object.keys(METRIC_LABELS) as Key[]).map((k) => (
                  <th key={k} scope="col" className="py-1 text-right font-normal">
                    {METRIC_LABELS[k]}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {[...daily].reverse().map((d) => (
                <tr key={d.day} className="border-t border-subtle">
                  <th scope="row" className="py-1 font-normal text-secondary">
                    {shortDay(d.day)}
                  </th>
                  {(Object.keys(METRIC_LABELS) as Key[]).map((k) => (
                    <td key={k} className="py-1 text-right tabular-nums">
                      {d[k]}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </section>
  )
}

/** A tiny trend line for a stat card. Decorative: the number and the change are the content. */
export function Sparkline({ values }: { values: number[] }) {
  const max = Math.max(1, ...values)
  const pts = values
    .map(
      (v, i) =>
        `${((i / Math.max(1, values.length - 1)) * 100).toFixed(1)},${(28 - (v / max) * 26).toFixed(1)}`,
    )
    .join(' ')
  return (
    <svg viewBox="0 0 100 30" preserveAspectRatio="none" className="h-8 w-full" aria-hidden="true">
      <polyline points={pts} fill="none" stroke="var(--action-primary-bg)" strokeWidth="1.5" opacity="0.7" />
    </svg>
  )
}

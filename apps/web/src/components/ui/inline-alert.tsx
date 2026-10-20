import type { ReactNode } from 'react'

export function InlineAlert({
  tone = 'danger',
  children,
}: {
  tone?: 'danger' | 'warning'
  children: ReactNode
}) {
  return (
    <div
      role="alert"
      className={`rounded-sm border px-3 py-2 text-sm ${tone === 'danger' ? 'border-danger text-danger' : 'border-warning bg-tint-warning text-warning'}`}
    >
      {children}
    </div>
  )
}

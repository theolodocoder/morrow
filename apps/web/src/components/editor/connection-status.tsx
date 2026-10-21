'use client'
import type { CollabStatus } from './use-collab'

const COPY: Record<CollabStatus, { label: string; dot: string; detail?: string }> = {
  connecting: { label: 'Connecting…', dot: 'bg-control' },
  saved: { label: 'Saved', dot: 'bg-success' },
  saving: { label: 'Saving…', dot: 'bg-control' },
  'on-device': {
    label: 'Saved on this device',
    dot: 'bg-warning',
    detail: 'Your changes are kept on this device and will sync when you reconnect.',
  },
  offline: {
    label: 'Offline',
    dot: 'bg-warning',
    detail: 'Keep this tab open — your changes will sync when you reconnect.',
  },
  reconnecting: { label: 'Reconnecting…', dot: 'bg-warning' },
  degraded: {
    label: 'Not saved to server yet',
    dot: 'bg-danger',
    detail: 'We’ll keep trying. Your words are safe in this tab.',
  },
  'read-only': { label: 'View only', dot: 'bg-control' },
  denied: { label: 'No access', dot: 'bg-danger', detail: 'You no longer have access to this chapter.' },
  'reload-required': {
    label: 'Reload to keep editing',
    dot: 'bg-warning',
    detail: 'Morrow was updated. Reload — your changes are safe.',
  },
}

/** Colour is never the only signal: the label always states the condition (design system §11, §14). */
export function ConnectionStatus({ status }: { status: CollabStatus }) {
  const c = COPY[status]
  return (
    <div
      role="status"
      aria-live="polite"
      className="flex items-center gap-2 font-mono text-[12px] text-secondary"
      title={c.detail}
    >
      <span aria-hidden="true" className={`size-2 rounded-full ${c.dot}`} />
      <span>{c.label}</span>
    </div>
  )
}

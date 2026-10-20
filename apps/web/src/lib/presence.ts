import { presence } from '@morrow/tokens'

export interface PresenceUser {
  id: string
  name: string
  color: string
}

function hash(s: string) {
  let h = 2166136261
  for (const c of s) h = Math.imul(h ^ c.charCodeAt(0), 16777619)
  return h >>> 0
}

/** Deterministic per user and work (design system §3): the same person keeps their colour within a work. */
export function presenceColor(userId: string, workId: string, theme: 'light' | 'dark' = 'light'): string {
  const palette = presence[theme]
  return palette[hash(`${workId}:${userId}`) % palette.length]!
}

export const initials = (name: string) =>
  name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? '')
    .join('') || '?'

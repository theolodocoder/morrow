import type { AvatarConfig } from '@morrow/contracts'
import { presence } from '@morrow/tokens'

export interface PresenceUser {
  id: string
  name: string
  color: string
  /** their profile face, so others see who's here the way their profile shows them */
  avatarSeed?: string
  avatar?: AvatarConfig | null
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

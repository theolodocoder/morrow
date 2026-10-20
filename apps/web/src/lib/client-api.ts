'use client'
import type { Problem } from '@morrow/contracts'

export class ClientApiError extends Error {
  constructor(
    readonly status: number,
    readonly problem: Partial<Problem>,
  ) {
    super(problem.title ?? `Request failed (${status})`)
  }
}

/** Same-origin call to /api (cookies are first-party; the browser sends Origin for the CSRF check). */
export async function api<T>(
  path: string,
  init: { method?: string; body?: unknown; headers?: Record<string, string> } = {},
): Promise<T> {
  const res = await fetch(path.startsWith('/api/') ? path : `/api/v1${path}`, {
    method: init.method ?? 'GET',
    credentials: 'same-origin',
    headers: { ...(init.body !== undefined ? { 'content-type': 'application/json' } : {}), ...init.headers },
    ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
  })
  if (res.status === 204) return undefined as T
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new ClientApiError(res.status, data as Partial<Problem>)
  return data as T
}

export const newIdempotencyKey = () => crypto.randomUUID()

import 'server-only'
import type { AvatarConfig } from '@morrow/contracts'
import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { visitorHeaders } from './visitor'

const API = process.env.API_INTERNAL_URL ?? 'http://127.0.0.1:4000'

export class ApiError extends Error {
  constructor(readonly status: number) {
    super(`API ${status}`)
  }
}

/**
 * Server-component fetch to the API, forwarding the visitor's session cookie.
 * 401 sends them to sign in; 404 is surfaced so pages can call notFound().
 */
export async function serverApi<T>(path: string): Promise<T> {
  const cookieHeader = (await cookies()).toString()
  const res = await fetch(`${API}/api/v1${path}`, {
    headers: { cookie: cookieHeader, ...(await visitorHeaders()) },
    cache: 'no-store',
  })
  if (res.status === 401) redirect('/sign-in')
  if (!res.ok) throw new ApiError(res.status)
  return (await res.json()) as T
}

/** The signed-in person, as the app shell draws them. */
export interface Me {
  id: string
  name: string
  email: string
  emailVerified: boolean
  username: string | null
  avatarSeed: string
  avatar: AvatarConfig | null
  profilePublic: boolean
}

export async function currentUser(): Promise<Me | null> {
  const cookieHeader = (await cookies()).toString()
  if (!cookieHeader) return null
  const res = await fetch(`${API}/api/v1/me`, {
    headers: { cookie: cookieHeader, ...(await visitorHeaders()) },
    cache: 'no-store',
  })
  return res.ok ? ((await res.json()) as Me) : null
}

import 'server-only'
import { cookies, headers } from 'next/headers'
import { redirect } from 'next/navigation'

const API = process.env.API_INTERNAL_URL ?? 'http://127.0.0.1:4000'

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly type?: string,
  ) {
    super(`API ${status}`)
  }
}

/** Server-side call on the staff member's behalf (cookie and forwarding chain passed on). 401 → sign in. */
export async function serverApi<T>(path: string): Promise<T> {
  const chain = (await headers()).get('x-forwarded-for')
  const res = await fetch(`${API}/api/v1${path}`, {
    headers: { cookie: (await cookies()).toString(), ...(chain ? { 'x-forwarded-for': chain } : {}) },
    cache: 'no-store',
  })
  if (res.status === 401) redirect('/sign-in')
  if (!res.ok)
    throw new ApiError(res.status, ((await res.json().catch(() => ({}))) as { type?: string }).type)
  return (await res.json()) as T
}

export type Staff = { role: 'moderator' | 'admin'; twoFactorEnabled: boolean }

/** Every page: staff only, and two-factor first. */
export async function requireStaff(): Promise<Staff> {
  const s = await serverApi<{ role: Staff['role'] | null; twoFactorEnabled: boolean }>('/me/staff')
  if (!s.role) redirect('/no-access')
  if (!s.twoFactorEnabled) redirect('/setup-two-factor')
  return { role: s.role, twoFactorEnabled: true }
}

import 'server-only'
import { cookies } from 'next/headers'
import { notFound } from 'next/navigation'
import { visitorHeaders } from './visitor'

const API = process.env.API_INTERNAL_URL ?? 'http://127.0.0.1:4000'

/**
 * Anonymous fetch for public pages: no cookies are forwarded, so what a page shows is exactly what any visitor may see.
 * Not cached: unpublishing or making a work private must take effect on the next request.
 */
export async function publicApi<T>(path: string): Promise<T> {
  const res = await fetch(`${API}/api/v1/public${path}`, {
    cache: 'no-store',
    headers: await visitorHeaders(),
  })
  if (res.status === 404) notFound()
  if (!res.ok) throw new Error(`API ${res.status}`)
  return (await res.json()) as T
}

/**
 * The same public endpoints, as the person reading: their session goes along, so the API can add their own state
 * (liked, following) and give signed-in readers the whole chapter (P-044). Visibility rules don't change.
 */
export async function publicApiAsViewer<T>(path: string): Promise<T> {
  const cookie = (await cookies()).toString()
  const res = await fetch(`${API}/api/v1/public${path}`, {
    cache: 'no-store',
    headers: { ...(await visitorHeaders()), ...(cookie ? { cookie } : {}) },
  })
  if (res.status === 404) notFound()
  if (!res.ok) throw new Error(`API ${res.status}`)
  return (await res.json()) as T
}

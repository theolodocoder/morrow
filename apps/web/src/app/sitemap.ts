import type { MetadataRoute } from 'next'
import { publicApi } from '@/lib/public-api'
import { routes } from '@/lib/routes'

const SITE = process.env.SITE_URL ?? 'http://localhost:3000'

/** Public works and writers, for search engines. Unlisted, private, hidden and deleted works are never listed. */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const data = await publicApi<{
    works: { publicPath: string; updatedAt: string }[]
    authors: { username: string }[]
  }>('/sitemap').catch(() => ({ works: [], authors: [] }))
  return [
    { url: `${SITE}/`, changeFrequency: 'hourly', priority: 1 },
    { url: `${SITE}${routes.discover}`, changeFrequency: 'daily', priority: 0.8 },
    ...data.works.map((w) => ({
      url: `${SITE}${routes.publicWork(w.publicPath)}`,
      lastModified: w.updatedAt,
      changeFrequency: 'weekly' as const,
      priority: 0.7,
    })),
    ...data.authors.map((a) => ({
      url: `${SITE}${routes.author(a.username)}`,
      changeFrequency: 'weekly' as const,
      priority: 0.5,
    })),
  ]
}

import type { MetadataRoute } from 'next'

const SITE = process.env.SITE_URL ?? 'http://localhost:3000'

/** Public pages may be indexed; the app, the API and private links may not. */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [{ userAgent: '*', allow: '/', disallow: ['/app/', '/api/', '/invite/', '/reset-password'] }],
    sitemap: `${SITE}/sitemap.xml`,
  }
}

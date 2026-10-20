import type { NextConfig } from 'next'

const apiUrl = process.env.API_INTERNAL_URL ?? 'http://127.0.0.1:4000'

const config: NextConfig = {
  // Workspace packages ship TypeScript source.
  transpilePackages: ['@morrow/editor', '@morrow/contracts', '@morrow/domain', '@morrow/tokens'],
  // The API is served same-origin under /api so session cookies stay first-party (architecture §4).
  async rewrites() {
    return [{ source: '/api/:path*', destination: `${apiUrl}/api/:path*` }]
  },
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
          // Browsers ignore HSTS over plain HTTP, so this is harmless locally and binding in production.
          ...(process.env.NODE_ENV === 'production'
            ? [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains' }]
            : []),
        ],
      },
    ]
  },
}
export default config

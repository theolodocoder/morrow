import type { NextConfig } from 'next'

const apiUrl = process.env.API_INTERNAL_URL ?? 'http://127.0.0.1:4000'

/** The staff admin app (FR-031): a separate origin, never indexed, never framed. */
const config: NextConfig = {
  transpilePackages: ['@morrow/contracts', '@morrow/domain', '@morrow/tokens'],
  async rewrites() {
    return [{ source: '/api/:path*', destination: `${apiUrl}/api/:path*` }]
  },
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'no-referrer' },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Content-Security-Policy', value: "frame-ancestors 'none'" },
          { key: 'X-Robots-Tag', value: 'noindex, nofollow' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
        ],
      },
    ]
  },
}
export default config

import { NextResponse, type NextRequest } from 'next/server'

/**
 * Content Security Policy (Phase 7 security review). Scripts run only with this request's nonce ('strict-dynamic'),
 * so an injected <script> can't execute even if an XSS bug slipped through. Connections go only to our own origin
 * and the collaboration service. Inline style *attributes* stay allowed: the editor and React set them.
 */
export function proxy(request: NextRequest) {
  const nonce = btoa(crypto.randomUUID())
  const collab = process.env.COLLAB_PUBLIC_URL ?? 'ws://localhost:4001'
  const dev = process.env.NODE_ENV === 'development'
  const csp = [
    `default-src 'self'`,
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${dev ? " 'unsafe-eval'" : ''}`,
    `style-src 'self' 'unsafe-inline'`,
    `img-src 'self' data: blob:`,
    `font-src 'self'`,
    `connect-src 'self' ${collab}`,
    `frame-ancestors 'none'`,
    `base-uri 'self'`,
    `form-action 'self'`,
    `object-src 'none'`,
  ].join('; ')
  const headers = new Headers(request.headers)
  headers.set('x-nonce', nonce)
  headers.set('content-security-policy', csp) // Next reads the nonce from here and applies it to its own scripts
  const response = NextResponse.next({ request: { headers } })
  response.headers.set('content-security-policy', csp)
  return response
}

export const config = {
  // Not for static assets or the API (proxied to Fastify, which sets its own headers).
  matcher: [{ source: '/((?!api/|_next/static|_next/image|favicon.ico|icon.svg|apple-icon.png|brand/).*)' }],
}

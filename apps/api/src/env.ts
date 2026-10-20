import { z } from 'zod'

const Env = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  DATABASE_URL: z.string().min(1),
  API_PORT: z.coerce.number().int().default(4000),
  /** the browser-facing origin; the API is served same-origin under /api via the web app or a proxy */
  WEB_ORIGIN: z.url(),
  /** the staff admin app's origin (separate app, 2FA required) */
  ADMIN_ORIGIN: z.url().optional(),
  /** WebSocket URL the browser uses for collab */
  COLLAB_PUBLIC_URL: z.string().min(1),
  /** collab's internal HTTP base URL (private network) */
  COLLAB_INTERNAL_URL: z.url(),
  AUTH_SECRET: z.string().min(32),
  TICKET_SECRET: z.string().min(32),
  INTERNAL_SECRET: z.string().min(32),
  /** Discover's per-instance cache, in ms (0 turns it off) */
  DISCOVER_CACHE_MS: z.coerce.number().int().min(0).default(15_000),
  /** requests per caller per minute, overall (raise only for load tests) */
  API_RATE_LIMIT_PER_MINUTE: z.coerce.number().int().default(300),
  /** sign-in / sign-up attempts per IP per minute */
  AUTH_RATE_LIMIT_PER_MINUTE: z.coerce.number().int().default(30),
  /** invitation previews per visitor per minute (anonymous: keyed by the visitor's IP) */
  PUBLIC_RATE_LIMIT_PER_MINUTE: z.coerce.number().int().default(30),
  /**
   * Which hops may tell us the visitor's IP (X-Forwarded-For): the web server and load balancers, never the open
   * internet, or anyone could pick their own rate-limit bucket. A proxy-addr list: "loopback", CIDRs, addresses.
   */
  TRUSTED_PROXIES: z.string().default('loopback'),
  /** FR-033: billing can run disabled; then plans are only comped by admins */
  BILLING_ENABLED: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),
  /** Email (T-003): with a Resend key, mail is really sent; without one, development logs it and production sends none */
  RESEND_API_KEY: z.string().min(10).optional(),
  /** the From address, on a domain verified with the provider, e.g. "Morrow <hello@morrow.example>" */
  EMAIL_FROM: z.string().min(3).optional(),
  /** HMAC secret for the billing provider's webhooks (required when billing is enabled) */
  BILLING_WEBHOOK_SECRET: z.string().min(32).optional(),
})
export type ApiEnv = z.infer<typeof Env>
export const parseEnv = (source: Record<string, string | undefined> = process.env): ApiEnv =>
  Env.parse(source)

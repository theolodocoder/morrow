import 'server-only'
import { headers } from 'next/headers'

/**
 * The visitor's forwarding chain, passed on when the web server calls the API on their behalf. Without it every
 * server-rendered request looks like it comes from the web server itself, so all visitors would share one rate-limit
 * bucket (found when invitation previews started failing under load). The API trusts this header only from known
 * proxies (TRUSTED_PROXIES) and takes the right-most untrusted address, so a forged entry can't pick a bucket when a
 * load balancer appends the real address (a production deployment requirement).
 */
export async function visitorHeaders(): Promise<Record<string, string>> {
  const chain = (await headers()).get('x-forwarded-for')
  return chain ? { 'x-forwarded-for': chain } : {}
}

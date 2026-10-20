/**
 * Server-only signing (Node crypto). Collab tickets: the API mints a 60s, document-scoped ticket after an
 * authorization check; collab verifies it and then re-checks membership in the database, because a ticket
 * only proves a *recent* decision (architecture §8, spike S3). Internal requests (API → collab) are signed
 * over method, path, timestamp and body so they cannot be altered or replayed outside a short window.
 */
import { createHmac, timingSafeEqual } from 'node:crypto'

export const TICKET_TTL_SECONDS = 60
export type TicketMode = 'edit' | 'read'
export interface TicketClaims {
  userId: string
  documentId: string
  mode: TicketMode
  expiresAt: number
}
export type TicketError = 'malformed' | 'bad-signature' | 'expired' | 'wrong-document'

const b64 = (b: Buffer | string) => Buffer.from(b).toString('base64url')
const mac = (secret: string, data: string) => createHmac('sha256', secret).update(data).digest()

function safeEqual(a: Buffer, b: Buffer) {
  return a.length === b.length && timingSafeEqual(a, b)
}

export function mintTicket(
  secret: string,
  c: Omit<TicketClaims, 'expiresAt'>,
  now = Date.now(),
): { ticket: string; expiresAt: Date } {
  const expiresAt = Math.floor(now / 1000) + TICKET_TTL_SECONDS
  const body = b64(JSON.stringify({ v: 1, u: c.userId, d: c.documentId, m: c.mode, e: expiresAt }))
  return { ticket: `${body}.${b64(mac(secret, body))}`, expiresAt: new Date(expiresAt * 1000) }
}

export function verifyTicket(
  secret: string,
  ticket: string,
  documentId: string,
  now = Date.now(),
): { ok: true; claims: TicketClaims } | { ok: false; error: TicketError } {
  const [body, sig, extra] = ticket.split('.')
  if (!body || !sig || extra !== undefined) return { ok: false, error: 'malformed' }
  if (!safeEqual(Buffer.from(sig, 'base64url'), mac(secret, body)))
    return { ok: false, error: 'bad-signature' }
  let p: { v?: number; u?: unknown; d?: unknown; m?: unknown; e?: unknown }
  try {
    p = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'))
  } catch {
    return { ok: false, error: 'malformed' }
  }
  if (
    p.v !== 1 ||
    typeof p.u !== 'string' ||
    typeof p.d !== 'string' ||
    (p.m !== 'edit' && p.m !== 'read') ||
    typeof p.e !== 'number'
  )
    return { ok: false, error: 'malformed' }
  if (p.e * 1000 <= now) return { ok: false, error: 'expired' }
  if (p.d !== documentId) return { ok: false, error: 'wrong-document' }
  return { ok: true, claims: { userId: p.u, documentId: p.d, mode: p.m, expiresAt: p.e } }
}

export const INTERNAL_SIGNATURE_HEADER = 'x-morrow-signature'
const INTERNAL_WINDOW_MS = 30_000

export function signInternal(
  secret: string,
  method: string,
  path: string,
  body: string,
  now = Date.now(),
): string {
  const t = String(now)
  return `t=${t},s=${b64(mac(secret, `${t}\n${method.toUpperCase()}\n${path}\n${body}`))}`
}

export function verifyInternal(
  secret: string,
  header: string | undefined,
  method: string,
  path: string,
  body: string,
  now = Date.now(),
): boolean {
  const m = /^t=(\d+),s=([\w-]+)$/.exec(header ?? '')
  if (!m) return false
  const t = Number(m[1])
  if (Math.abs(now - t) > INTERNAL_WINDOW_MS) return false
  return safeEqual(
    Buffer.from(m[2]!, 'base64url'),
    mac(secret, `${m[1]}\n${method.toUpperCase()}\n${path}\n${body}`),
  )
}

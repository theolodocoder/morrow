import { describe, expect, it } from 'vitest'
import { mintTicket, signInternal, verifyInternal, verifyTicket, TICKET_TTL_SECONDS } from '../src/signing.ts'

const S = 'test-secret-not-real',
  DOC = '0192d3a4-0000-7000-8000-000000000001'
const claims = { userId: 'u1', documentId: DOC, mode: 'edit' as const }

describe('collab tickets', () => {
  it('round-trips claims', () => {
    const { ticket } = mintTicket(S, claims)
    const r = verifyTicket(S, ticket, DOC)
    expect(r.ok && r.claims).toMatchObject(claims)
  })
  it('expires at exactly the TTL', () => {
    const now = 1_700_000_000_000
    const { ticket } = mintTicket(S, claims, now)
    expect(verifyTicket(S, ticket, DOC, now + (TICKET_TTL_SECONDS - 1) * 1000).ok).toBe(true)
    expect(verifyTicket(S, ticket, DOC, now + TICKET_TTL_SECONDS * 1000)).toEqual({
      ok: false,
      error: 'expired',
    })
  })
  it('rejects tampering, wrong secrets, other documents and garbage', () => {
    const { ticket } = mintTicket(S, { ...claims, mode: 'read' })
    const [body, sig] = ticket.split('.')
    const forged = Buffer.from(
      Buffer.from(body!, 'base64url').toString().replace('"read"', '"edit"'),
    ).toString('base64url')
    expect(verifyTicket(S, `${forged}.${sig}`, DOC)).toEqual({ ok: false, error: 'bad-signature' })
    expect(verifyTicket('other-secret', ticket, DOC)).toEqual({ ok: false, error: 'bad-signature' })
    expect(verifyTicket(S, ticket, '0192d3a4-0000-7000-8000-000000000002')).toEqual({
      ok: false,
      error: 'wrong-document',
    })
    for (const bad of ['', 'x', 'a.b.c', '...']) expect(verifyTicket(S, bad, DOC).ok).toBe(false)
  })
})

describe('internal request signing', () => {
  const now = 1_700_000_000_000
  const h = signInternal(S, 'post', '/internal/access/revoke', '{"workId":"w"}', now)
  it('accepts an untouched request within the window', () => {
    expect(verifyInternal(S, h, 'POST', '/internal/access/revoke', '{"workId":"w"}', now + 1000)).toBe(true)
  })
  it.each([
    ['body changed', 'POST', '/internal/access/revoke', '{"workId":"x"}', now],
    ['path changed', 'POST', '/internal/documents/1/flush', '{"workId":"w"}', now],
    ['method changed', 'GET', '/internal/access/revoke', '{"workId":"w"}', now],
    ['stale', 'POST', '/internal/access/revoke', '{"workId":"w"}', now + 31_000],
  ])('rejects when %s', (_l, m, p, b, t) => expect(verifyInternal(S, h, m, p, b, t)).toBe(false))
  it('rejects a missing or malformed header', () => {
    expect(verifyInternal(S, undefined, 'POST', '/x', '', now)).toBe(false)
    expect(verifyInternal(S, 'nonsense', 'POST', '/x', '', now)).toBe(false)
  })
})

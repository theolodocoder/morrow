import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { setup } from './setup.ts'

let ctx: Awaited<ReturnType<typeof setup>>
beforeAll(async () => {
  ctx = await setup('visitor')
})
afterAll(async () => {
  await ctx.app.close()
  await ctx.db.pool.end()
})

/** Invitation previews are anonymous and limited per visitor (30 a minute by default). */
const preview = (remoteAddress: string, xff?: string) =>
  ctx.app.inject({
    method: 'GET',
    url: `/api/v1/public/invitations/${'x'.repeat(43)}`,
    remoteAddress,
    headers: xff ? { 'x-forwarded-for': xff } : {},
  })

describe('rate limits know who the visitor is (TRUSTED_PROXIES)', () => {
  it('behind the web server, each visitor gets their own bucket', async () => {
    for (let i = 0; i < 30; i++) expect((await preview('127.0.0.1', '198.51.100.1')).statusCode).toBe(404)
    expect((await preview('127.0.0.1', '198.51.100.1')).statusCode).toBe(429)
    // Another visitor, through the same web server, is unaffected.
    expect((await preview('127.0.0.1', '198.51.100.2')).statusCode).toBe(404)
  })

  it('a caller that isn’t a trusted proxy can’t pick a new bucket by forging X-Forwarded-For', async () => {
    for (let i = 0; i < 30; i++) expect((await preview('203.0.113.9', `192.0.2.${i}`)).statusCode).toBe(404)
    expect((await preview('203.0.113.9', '192.0.2.250')).statusCode).toBe(429)
  })

  it('behind a load balancer that appends the real address, a forged first entry doesn’t help', async () => {
    // "forged, real": the web server (trusted) forwards the chain; the right-most untrusted address is the visitor.
    for (let i = 0; i < 30; i++)
      expect((await preview('127.0.0.1', `10.9.9.${i}, 198.51.100.7`)).statusCode).toBe(404)
    expect((await preview('127.0.0.1', '10.9.9.200, 198.51.100.7')).statusCode).toBe(429)
  })
})

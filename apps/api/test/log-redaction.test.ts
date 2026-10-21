import { Writable } from 'node:stream'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { buildApp } from '../src/app.ts'
import type { CollabGateway } from '../src/collab-gateway.ts'
import { devEmailSender } from '../src/email.ts'
import { env, setup } from './setup.ts'

let ctx: Awaited<ReturnType<typeof setup>>
let app: Awaited<ReturnType<typeof buildApp>>
const lines: string[] = []
beforeAll(async () => {
  ctx = await setup('logs')
  const stream = new Writable({
    write(chunk, _enc, done) {
      lines.push(String(chunk))
      done()
    },
  })
  // These requests never reach collab.
  app = await buildApp({
    env,
    db: ctx.db.db,
    collab: {} as CollabGateway,
    email: devEmailSender(() => {}),
    logger: { level: 'info', stream },
  })
})
afterAll(async () => {
  await app.close()
  await ctx.app.close()
  await ctx.db.pool.end()
})

it('request logs carry the route pattern, never a token from the path or query', async () => {
  const token = 'TOKEN' + 'x'.repeat(38)
  await app.inject({ method: 'GET', url: `/api/v1/public/invitations/${token}` })
  await app.inject({ method: 'GET', url: `/api/auth/reset-password/${token}?callbackURL=%2Fx` })
  await app.inject({ method: 'GET', url: `/api/auth/verify-email?token=${token}` })
  await app.inject({ method: 'POST', url: `/no/such/route/${token}` })

  const log = lines.join('')
  expect(log).toContain('"route":"/api/v1/public/invitations/:token"')
  expect(log).toContain('"route":"/api/auth/*"')
  expect(log).toContain('"route":"(no route)"')
  expect(log).not.toContain('TOKEN')
})

import { createDb } from '@morrow/db'
import { parseEnv } from './env.ts'
import { buildApp } from './app.ts'
import { httpCollabGateway } from './collab-gateway.ts'
import { devEmailSender, disabledEmailSender, resendEmailSender } from './email.ts'
import { startNotificationWorker } from './notifications.ts'

const env = parseEnv()
const { db, pool } = createDb(env.DATABASE_URL, { max: 20 })
// With a provider key, mail is sent; otherwise development logs it and production sends none (invites still work by link).
const email =
  env.RESEND_API_KEY && env.EMAIL_FROM
    ? resendEmailSender(env.RESEND_API_KEY, env.EMAIL_FROM)
    : env.NODE_ENV === 'production'
      ? disabledEmailSender
      : devEmailSender()
const app = await buildApp({
  env,
  db,
  email,
  collab: httpCollabGateway(env.COLLAB_INTERNAL_URL, env.INTERNAL_SECRET),
})
await app.listen({ port: env.API_PORT, host: '0.0.0.0' })
// Turns the activity outbox into notifications and emails (FR-030); safe to run on every instance.
const stopWorker = startNotificationWorker(db, email, env.WEB_ORIGIN, app.log)

for (const signal of ['SIGTERM', 'SIGINT'] as const) {
  process.once(signal, async () => {
    stopWorker()
    await app.close()
    await pool.end()
    process.exit(0)
  })
}

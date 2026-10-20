import { createDb } from '@morrow/db'
import { parseEnv } from './env.ts'
import { createLogger } from './logger.ts'
import { startCollab } from './server.ts'

const env = parseEnv()
const log = createLogger('collab')
const { db, pool } = createDb(env.DATABASE_URL, { max: 20 })
const server = await startCollab(env, db, log)

// Graceful shutdown flushes every loaded document before exit; clients reconnect to the next instance.
for (const signal of ['SIGTERM', 'SIGINT'] as const) {
  process.once(signal, async () => {
    log.info({ ev: 'shutdown', signal })
    await server.destroy()
    await pool.end()
    process.exit(0)
  })
}

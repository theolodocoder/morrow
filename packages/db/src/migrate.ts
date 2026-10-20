import { migrate } from 'drizzle-orm/node-postgres/migrator'
import { fileURLToPath } from 'node:url'
import { createDb } from './client.ts'

const url = process.env.DATABASE_URL
if (!url) throw new Error('DATABASE_URL is required')
const { db, pool } = createDb(url, { max: 1 })
await migrate(db, { migrationsFolder: fileURLToPath(new URL('../migrations', import.meta.url)) })
await pool.end()
console.warn('migrations applied')

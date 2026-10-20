/* eslint-disable no-console -- an operator's CLI reports to the terminal */
/**
 * Grant or revoke platform staff roles. Deliberately outside the app: no one can make themselves a moderator.
 *   pnpm --filter @morrow/api staff grant someone@example.com moderator
 *   pnpm --filter @morrow/api staff revoke someone@example.com
 */
import { eq, sql } from 'drizzle-orm'
import { createDb, staff, user } from '@morrow/db'

const [command, email, role = 'moderator'] = process.argv.slice(2)
if (!command || !email || !['grant', 'revoke'].includes(command) || !['moderator', 'admin'].includes(role)) {
  console.error('usage: staff grant <email> [moderator|admin] | staff revoke <email>')
  process.exit(2)
}
const { db, pool } = createDb(process.env.DATABASE_URL!)
const [u] = await db
  .select({ id: user.id })
  .from(user)
  .where(sql`lower(${user.email}) = ${email.toLowerCase()}`)
if (!u) {
  console.error(`no account for ${email}`)
  process.exit(1)
}
if (command === 'grant') {
  await db
    .insert(staff)
    .values({ userId: u.id, role: role as 'moderator' | 'admin', grantedBy: 'cli' })
    .onConflictDoUpdate({ target: staff.userId, set: { role: role as 'moderator' | 'admin' } })
  console.log(`${email} is now ${role}`)
} else {
  await db.delete(staff).where(eq(staff.userId, u.id))
  console.log(`${email} is no longer staff`)
}
await pool.end()

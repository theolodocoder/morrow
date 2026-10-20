/**
 * Platform staff checks (FR-031). Staff are granted by the operator CLI only, and must have two-factor sign-in on:
 * a staff account without it can't use any staff route, so a stolen password alone can't moderate or administer.
 */
import { eq } from 'drizzle-orm'
import { PROBLEM } from '@morrow/contracts'
import { staff, type Database } from '@morrow/db'
import { HttpProblem, notFound } from './problems.ts'

export async function requireStaffUser(
  db: Database,
  userId: string,
  twoFactorEnabled: boolean,
  role?: 'admin',
) {
  const [s] = await db.select().from(staff).where(eq(staff.userId, userId))
  if (!s) throw notFound() // the console isn't advertised
  if (!twoFactorEnabled)
    throw new HttpProblem(
      403,
      PROBLEM.twoFactorRequired,
      'Turn on two-factor sign-in first.',
      'Staff tools need two-factor sign-in. Set it up in the admin app.',
    )
  if (role === 'admin' && s.role !== 'admin') throw new HttpProblem(403, PROBLEM.forbidden, 'Admins only.')
  return s
}

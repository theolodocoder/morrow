import { betterAuth } from 'better-auth'
import { drizzleAdapter } from '@better-auth/drizzle-adapter'
import { account, session, twoFactor as twoFactorTable, user, verification, type Database } from '@morrow/db'
import { twoFactor } from 'better-auth/plugins'
import type { ApiEnv } from './env.ts'
import type { EmailSender } from './email.ts'
import { ensureProfile } from './routes/profiles.ts'

export function createAuth(env: ApiEnv, db: Database, email: EmailSender) {
  // Not awaited: how long a send takes must not reveal whether an account exists.
  const send = (to: string, subject: string, text: string) =>
    void email.send({ to, subject, text }).catch(() => {})
  return betterAuth({
    baseURL: env.WEB_ORIGIN,
    basePath: '/api/auth',
    secret: env.AUTH_SECRET,
    // The admin app (staff console) is a separate origin.
    trustedOrigins: [env.WEB_ORIGIN, ...(env.ADMIN_ORIGIN ? [env.ADMIN_ORIGIN] : [])],
    database: drizzleAdapter(db, {
      provider: 'pg',
      schema: { user, session, account, verification, twoFactor: twoFactorTable },
    }),
    emailAndPassword: {
      enabled: true,
      minPasswordLength: 10,
      autoSignIn: true,
      // Forgot password: a one-hour link; every other session ends when the password changes.
      resetPasswordTokenExpiresIn: 60 * 60,
      revokeSessionsOnPasswordReset: true,
      sendResetPassword: async ({ user: u, url }) =>
        send(
          u.email,
          'Reset your Morrow password',
          `Hi ${u.name},\n\nSomeone (hopefully you) asked to reset the password for your Morrow account. Choose a new one here within the hour:\n\n${url}\n\nIf it wasn’t you, ignore this email: your password stays the same.`,
        ),
    },
    // Verification is sent on sign-up but not required to write (Q-015); invitations rely on it (only verified
    // addresses learn of an invitation in-app).
    emailVerification: {
      sendOnSignUp: true,
      autoSignInAfterVerification: true,
      expiresIn: 24 * 60 * 60,
      sendVerificationEmail: async ({ user: u, url }) =>
        send(
          u.email,
          'Confirm your email for Morrow',
          `Hi ${u.name},\n\nWelcome to Morrow. Confirm this is your email address:\n\n${url}\n\nIf you didn’t create an account, ignore this email.`,
        ),
    },
    advanced: {
      defaultCookieAttributes: { sameSite: 'lax', httpOnly: true, secure: env.NODE_ENV === 'production' },
      // Better Auth skips its origin check when NODE_ENV=test; pin it on so tests prove production behaviour (spike S3).
      disableOriginCheck: false,
    },
    telemetry: { enabled: false },
    // TOTP two-factor (FR-031 admin; optional for writers). Mandatory for staff: the admin API refuses staff without it.
    plugins: [
      twoFactor({ issuer: 'Morrow', totpOptions: { digits: 6, period: 30 }, allowPasswordless: false }),
    ],
    databaseHooks: {
      user: { create: { after: async (u) => ensureProfile(db, u.id, u.name) } },
    },
  })
}
export type Auth = ReturnType<typeof createAuth>

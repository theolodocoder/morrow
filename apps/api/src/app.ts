import { createHmac } from 'node:crypto'
import { avatarOf } from './people.ts'
import Fastify, { type FastifyReply, type FastifyRequest } from 'fastify'
import rateLimit from '@fastify/rate-limit'
import {
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
  hasZodFastifySchemaValidationErrors,
} from 'fastify-type-provider-zod'
import { fromNodeHeaders } from 'better-auth/node'
import { PROBLEM } from '@morrow/contracts'
import type { Database } from '@morrow/db'
import type { ApiEnv } from './env.ts'
import { createAuth } from './auth.ts'
import type { CollabGateway } from './collab-gateway.ts'
import { HttpProblem, unauthenticated } from './problems.ts'
import { workRoutes } from './routes/works.ts'
import { chapterRoutes } from './routes/chapters.ts'
import { collabRoutes } from './routes/collab.ts'
import { snapshotRoutes } from './routes/snapshots.ts'
import { memberRoutes, publicInvitationRoutes } from './routes/members.ts'
import { branchRoutes } from './routes/branches.ts'
import { profileRoutes, publicProfileRoutes } from './routes/profiles.ts'
import { publicReadingRoutes, publishingRoutes } from './routes/publishing.ts'
import { alternateRoutes } from './routes/alternates.ts'
import { proposalRoutes } from './routes/proposals.ts'
import { feedbackRoutes } from './routes/feedback.ts'
import { compareRoutes } from './routes/compare.ts'
import { notificationRoutes } from './routes/notifications.ts'
import { followRoutes } from './routes/follows.ts'
import { discoveryRoutes } from './routes/discovery.ts'
import { moderationRoutes } from './routes/moderation.ts'
import { billingWebhookRoutes, planRoutes, publicPlanRoutes } from './routes/billing.ts'
import { adminRoutes } from './routes/admin.ts'
import { betaRoutes } from './routes/beta.ts'
import { publicSocialRoutes, socialRoutes } from './routes/social.ts'
import { contributionRoutes } from './routes/contributions.ts'
import { accountRoutes } from './routes/account.ts'
import { waitlistRoutes } from './routes/waitlist.ts'
import { writingRoutes } from './routes/writing.ts'
import { pollRoutes, publicPollRoutes } from './routes/polls.ts'
import { classicRoutes } from './routes/classics.ts'
import { badgeRoutes } from './routes/badges.ts'
import { dashboardRoutes } from './routes/dashboard.ts'
import { loadRestriction, profiles } from '@morrow/db'
import { eq } from 'drizzle-orm'
import type { EmailSender } from './email.ts'

export interface SessionUser {
  id: string
  name: string
  email: string
  emailVerified: boolean
  /** active moderation restriction (FR-031/032) */
  restriction: 'suspended' | 'muted' | null
  /** staff must have it (admin app); optional for everyone else */
  twoFactorEnabled: boolean
}

declare module 'fastify' {
  interface FastifyRequest {
    user: SessionUser | null
  }
}

export interface AppDeps {
  env: ApiEnv
  db: Database
  collab: CollabGateway
  email: EmailSender
  logger?: boolean | object
}

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS'])
/** What a suspended account may still do: read (any GET), clear notifications, appeal, and get collab tickets (read-only). */
const SUSPENDED_ALLOWED = new Set([
  'POST /api/v1/me/notifications/read',
  'POST /api/v1/me/appeals',
  'POST /api/v1/collab/tickets',
  'POST /api/v1/documents/:documentId/feedback/seen',
  'POST /api/v1/public/reading/:publicPath/view',
  'POST /api/v1/public/authors/:username/view',
])
/** What a muted account may not do: start conversations or pull people in. */
const MUTED_BLOCKED = new Set([
  'POST /api/v1/documents/:documentId/comments',
  'POST /api/v1/comments/:commentId/replies',
  'PATCH /api/v1/comments/:commentId',
  'POST /api/v1/works/:workId/proposals',
  'POST /api/v1/works/:workId/invitations',
  'POST /api/v1/reading/:publicPath/comments',
  'POST /api/v1/contribution-requests',
])

export async function buildApp({ env, db, collab, email, logger }: AppDeps) {
  const app = Fastify({
    // Only the web server / load balancer may report the visitor's IP; see TRUSTED_PROXIES.
    trustProxy: env.TRUSTED_PROXIES.split(',')
      .map((x) => x.trim())
      .filter(Boolean),
    bodyLimit: 256 * 1024,
    logger: logger ?? {
      level: env.NODE_ENV === 'production' ? 'info' : 'warn',
      // Never log credentials or content (engineering standards §3.7).
      redact: ['req.headers.cookie', 'req.headers.authorization', 'res.headers["set-cookie"]'],
    },
  }).withTypeProvider<ZodTypeProvider>()

  app.setValidatorCompiler(validatorCompiler)
  app.setSerializerCompiler(serializerCompiler)

  const auth = createAuth(env, db, email)

  // CSRF: SameSite=Lax cookies plus a strict Origin check on every state-changing request.
  app.addHook('onRequest', async (req) => {
    if (SAFE_METHODS.has(req.method)) return
    // The billing provider's webhook carries no browser Origin; its HMAC signature authenticates it instead.
    if (req.url === '/api/v1/billing/webhook') return
    if (
      req.headers.origin !== env.WEB_ORIGIN &&
      !(env.ADMIN_ORIGIN && req.headers.origin === env.ADMIN_ORIGIN)
    )
      throw new HttpProblem(403, PROBLEM.badOrigin, 'Request origin not allowed.')
  })

  app.decorateRequest('user', null)
  app.addHook('preHandler', async (req) => {
    if (req.url.startsWith('/api/auth/')) return
    const s = await auth.api.getSession({ headers: fromNodeHeaders(req.headers) })
    req.user = s
      ? {
          id: s.user.id,
          name: s.user.name,
          email: s.user.email,
          emailVerified: s.user.emailVerified,
          restriction: await loadRestriction(db, s.user.id),
          twoFactorEnabled: (s.user as { twoFactorEnabled?: boolean | null }).twoFactorEnabled === true,
        }
      : null
    // Restrictions are enforced here, for every route, not by hiding buttons (PRD §9.3).
    const r = req.user?.restriction
    if (!r || SAFE_METHODS.has(req.method)) return
    const route = `${req.method} ${req.routeOptions.url ?? ''}`
    if (r === 'suspended' && !SUSPENDED_ALLOWED.has(route))
      throw new HttpProblem(
        403,
        PROBLEM.forbidden,
        'Your account is restricted.',
        'You can read, but not make changes, while a moderator’s restriction is in place. You can appeal it from your account.',
      )
    if (r === 'muted' && MUTED_BLOCKED.has(route))
      throw new HttpProblem(
        403,
        PROBLEM.forbidden,
        'Your account is muted.',
        'You can’t post comments, proposals or invitations while a moderator’s restriction is in place.',
      )
  })

  // Registered after the session hook so signed-in requests are limited per user, not per IP: people behind one
  // office or school network must not share a budget. Anonymous requests (sign-in, invitation previews) use the IP.
  await app.register(rateLimit, {
    max: env.API_RATE_LIMIT_PER_MINUTE,
    timeWindow: '1 minute',
    hook: 'preHandler',
    keyGenerator: (req) => (req.user ? `user:${req.user.id}` : `ip:${req.ip}`),
  })

  app.setErrorHandler((err, req, reply) => {
    if (err instanceof HttpProblem) return problem(reply, err.status, err.type, err.title, err.detail)
    if (hasZodFastifySchemaValidationErrors(err))
      return problem(
        reply,
        400,
        PROBLEM.validation,
        'Some fields are invalid.',
        err.validation.map((v) => `${v.instancePath || '/'} ${v.message}`).join('; '),
      )
    if ((err as { statusCode?: number }).statusCode === 429)
      return problem(reply, 429, PROBLEM.rateLimited, 'Too many requests. Try again shortly.')
    req.log.error({ err }, 'unhandled error')
    return problem(reply, 500, PROBLEM.internal, 'Something went wrong on our side.')
  })
  app.setNotFoundHandler((_req, reply) => problem(reply, 404, PROBLEM.notFound, 'Not found.'))

  // Better Auth, bridged from Fastify (spike S3): copy Set-Cookie explicitly and keep the session token out of bodies.
  app.route({
    method: ['GET', 'POST'],
    url: '/api/auth/*',
    config: { rateLimit: { max: env.AUTH_RATE_LIMIT_PER_MINUTE, timeWindow: '1 minute' } },
    async handler(req, reply) {
      const url = new URL(req.url, env.WEB_ORIGIN)
      const res = await auth.handler(
        new Request(url, {
          method: req.method,
          headers: fromNodeHeaders(req.headers),
          ...(req.method !== 'GET' && req.body !== undefined ? { body: JSON.stringify(req.body) } : {}),
        }),
      )
      reply.status(res.status)
      res.headers.forEach((value, key) => {
        if (key !== 'set-cookie' && key !== 'content-length') reply.header(key, value)
      })
      const cookies = res.headers.getSetCookie()
      if (cookies.length) reply.header('set-cookie', cookies)
      const text = await res.text()
      if (!res.headers.get('content-type')?.includes('application/json') || !text) return reply.send(text)
      const body = JSON.parse(text) as Record<string, unknown>
      delete body.token // the HttpOnly cookie carries the session; the body must not
      return reply.send(body)
    },
  })

  const requireUser = async (req: FastifyRequest) => {
    if (!req.user) throw unauthenticated()
  }

  await app.register(
    async (v1) => {
      v1.addHook('preHandler', requireUser)
      v1.get('/me', async (req) => {
        const [p] = await db
          .select({
            username: profiles.username,
            onboardedAt: profiles.onboardedAt,
            avatarSeed: profiles.avatarSeed,
            avatar: profiles.avatar,
            isPublic: profiles.isPublic,
          })
          .from(profiles)
          .where(eq(profiles.userId, req.user!.id))
        // what the app shell needs to draw you: name, handle, avatar
        return {
          ...req.user!,
          username: p?.username ?? null,
          onboarded: !!p?.onboardedAt,
          avatarSeed: p?.avatarSeed ?? req.user!.id.slice(-8),
          avatar: avatarOf(p?.avatar),
          profilePublic: p?.isPublic ?? false,
        }
      })
      await v1.register(workRoutes, { db, collab })
      await v1.register(chapterRoutes, { db, collab })
      await v1.register(collabRoutes, { db, env })
      await v1.register(snapshotRoutes, { db, collab })
      await v1.register(memberRoutes, { db, env, collab, email })
      await v1.register(branchRoutes, { db, collab })
      await v1.register(profileRoutes, { db })
      await v1.register(publishingRoutes, { db, collab })
      await v1.register(alternateRoutes, { db, collab })
      await v1.register(proposalRoutes, { db, collab })
      await v1.register(feedbackRoutes, { db, collab })
      await v1.register(compareRoutes, { db, collab })
      await v1.register(notificationRoutes, { db })
      await v1.register(followRoutes, { db })
      await v1.register(moderationRoutes, { db })
      await v1.register(planRoutes, { db, env })
      await v1.register(adminRoutes, { db })
      await v1.register(betaRoutes, { db })
      await v1.register(socialRoutes, { db })
      await v1.register(badgeRoutes, { db })
      await v1.register(dashboardRoutes, { db })
      await v1.register(contributionRoutes, { db })
      await v1.register(accountRoutes, { db, auth })
      await v1.register(waitlistRoutes, { db })
      await v1.register(writingRoutes, { db })
      await v1.register(pollRoutes, { db })
      await v1.register(classicRoutes, { db, collab })
    },
    { prefix: '/api/v1' },
  )
  await app.register(publicInvitationRoutes, { db, env, prefix: '/api/v1/public' })
  await app.register(publicProfileRoutes, { db, prefix: '/api/v1/public' })
  await app.register(publicReadingRoutes, { db, prefix: '/api/v1/public' })
  await app.register(publicPollRoutes, { db, prefix: '/api/v1/public' })
  await app.register(discoveryRoutes, { db, cacheMs: env.DISCOVER_CACHE_MS, prefix: '/api/v1/public' })
  await app.register(publicPlanRoutes, { db, prefix: '/api/v1/public' })
  // Signed-out views are counted with a daily keyed hash; the key is derived so it's never the session secret itself.
  await app.register(publicSocialRoutes, {
    db,
    viewSecret: createHmac('sha256', env.AUTH_SECRET).update('morrow:view-counting').digest('hex'),
    prefix: '/api/v1/public',
  })
  await app.register(billingWebhookRoutes, { db, env, prefix: '/api/v1' })

  app.get('/healthz', async () => ({ ok: true }))
  return app
}

function problem(reply: FastifyReply, status: number, type: string, title: string, detail?: string) {
  return reply
    .status(status)
    .type('application/problem+json')
    .send({ type, title, status, ...(detail ? { detail } : {}) })
}
export type App = Awaited<ReturnType<typeof buildApp>>

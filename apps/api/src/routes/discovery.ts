/**
 * Discovery and search (PRD FR-020/021). Only works anyone may find appear: public, published, not deleted, not hidden
 * by moderation. Unlisted works stay link-only and never surface here. Editorial picks and algorithmic ranking are
 * separate lists, labelled as such in the UI.
 */
import { promptFor } from '../prompts.ts'
import { bylineOf, classicOf, openAccessOf } from './publishing.ts'
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod'
import { z } from 'zod'
import { sql, type SQL } from 'drizzle-orm'
import { avatarOf } from '../people.ts'
import {
  coverOf,
  Discovery,
  SearchQuery,
  SearchResults,
  WeeklyPrompt,
  WORK_CATEGORIES,
  type DiscoveryWork,
} from '@morrow/contracts'
import {
  bookmarks,
  featuredWorks,
  follows,
  profiles,
  publications,
  user,
  workMembers,
  works,
  type Database,
} from '@morrow/db'

const DiscoverQuery = z.object({
  category: z.enum(WORK_CATEGORIES).optional(),
  tag: z.string().trim().toLowerCase().max(40).optional(),
})

/** What "findable" means, everywhere in this module. */
const findable = sql`w.visibility = 'public' and w.published_at is not null and w.deleted_at is null and w.hidden_at is null`

/** Per-instance micro-cache for Discover (keyed by filters). Hidden works leave it within this TTL. */
const discoverCache = new Map<string, { at: number; value: z.infer<typeof Discovery> }>()

/** Escape LIKE wildcards in user input so `%` and `_` are literal. */
const likeEscape = (s: string) => s.replace(/[\\%_]/g, (c) => `\\${c}`)

export interface Row {
  id: string
  cover: unknown
  open_roles: string[]
  source: unknown
  title: string
  description: string
  form: DiscoveryWork['category']
  tags: string[]
  slug: string
  public_id: string
  published_at: Date
  author_name: string
  author_username: string | null
  author_public: boolean | null
  collaborators: number
  word_count: number
  note?: string
}

/** The shared projection for every list: one round trip, counts included. */
export function listQuery(
  where: SQL,
  order: SQL,
  limit: number,
  offset = 0,
  extraSelect: SQL = sql``,
  extraJoin: SQL = sql``,
) {
  return sql`
    select w.id, w.cover, w.open_roles, w.source, w.title, w.description, w.form, w.tags, w.slug, w.public_id, w.published_at,
      u.name as author_name, p.username as author_username, p.is_public as author_public,
      (select count(*)::int from ${workMembers} m where m.work_id = w.id) as collaborators,
      (select coalesce(sum(pb.word_count), 0)::int from ${publications} pb where pb.work_id = w.id and pb.superseded_at is null) as word_count
      ${extraSelect}
    from ${works} w
    join ${user} u on u.id = w.owner_id
    left join ${profiles} p on p.user_id = w.owner_id
    ${extraJoin}
    where ${findable} and ${where}
    order by ${order}
    limit ${limit} offset ${offset}`
}

export const toWork = (r: Row): DiscoveryWork => ({
  title: r.title,
  cover: coverOf(r.id, r.cover),
  ...(r.open_roles?.length ? { openRoles: r.open_roles } : {}),
  description: r.description,
  category: r.form,
  tags: r.tags,
  publicPath: `${r.slug}-${r.public_id}`,
  publishedAt: new Date(r.published_at).toISOString(),
  // classics and open-access articles are credited to whoever really wrote them
  author: classicOf(r.source)
    ? { displayName: classicOf(r.source)!.author, username: null }
    : openAccessOf(r.source)
      ? { displayName: bylineOf(openAccessOf(r.source)!.authors), username: null }
      : { displayName: r.author_name, username: r.author_public ? r.author_username : null },
  ...(classicOf(r.source) ? { classic: classicOf(r.source)! } : {}),
  ...(openAccessOf(r.source)
    ? {
        openAccess: {
          journal: openAccessOf(r.source)!.journal,
          year: openAccessOf(r.source)!.year,
          license: openAccessOf(r.source)!.license,
        },
      }
    : {}),
  collaborators: Math.max(1, r.collaborators),
  wordCount: r.word_count,
  ...(r.note !== undefined ? { note: r.note } : {}),
})

function filters(q: { category?: string | undefined; tag?: string | undefined }) {
  const parts: SQL[] = [sql`true`]
  if (q.category) parts.push(sql`w.form = ${q.category}`)
  if (q.tag) parts.push(sql`${q.tag} = any(w.tags)`)
  return sql.join(parts, sql` and `)
}

/** Algorithmic: follows (weighted double) and bookmarks in the last 30 days. Shown to readers as exactly that. */
const popularity = sql`(
  2 * (select count(*) from ${follows} f where f.target_type = 'work' and f.target_id = w.id::text and f.created_at > now() - interval '30 days')
  + (select count(*) from ${bookmarks} b where b.work_id = w.id and b.created_at > now() - interval '30 days')
)`

export const discoveryRoutes: FastifyPluginAsyncZod<{ db: Database; cacheMs: number }> = async (
  app,
  { db, cacheMs },
) => {
  const rows = async (q: SQL) => (await db.execute(q)).rows as unknown as Row[]

  app.get(
    '/discover',
    { schema: { querystring: DiscoverQuery, response: { 200: Discovery } } },
    async (req, reply) => {
      // The same for everyone with the same filters: a CDN may serve it for 30s, and this instance for 15s, so a
      // burst of readers costs the database one query set (Phase 7 load test).
      reply.header('cache-control', 'public, max-age=0, s-maxage=30, stale-while-revalidate=120')
      const key = `${req.query.category ?? ''}|${req.query.tag ?? ''}`
      const hit = discoverCache.get(key)
      if (cacheMs > 0 && hit && Date.now() - hit.at < cacheMs) return hit.value
      const value = await computeDiscover(req.query)
      if (discoverCache.size > 500) discoverCache.clear()
      discoverCache.set(key, { at: Date.now(), value })
      return value
    },
  )

  async function computeDiscover(query: {
    category?: string | undefined
    tag?: string | undefined
  }): Promise<z.infer<typeof Discovery>> {
    {
      const f = filters(query)
      const [featured, recent, popular, collaborative, seeking, topics, calls, classics, research] =
        await Promise.all([
          rows(
            listQuery(
              f,
              sql`fw.featured_at desc`,
              6,
              0,
              sql`, fw.note`,
              sql`join ${featuredWorks} fw on fw.work_id = w.id`,
            ),
          ),
          rows(listQuery(sql`${f} and w.source is null`, sql`w.published_at desc`, 12)),
          rows(
            listQuery(
              sql`${f} and w.source is null and ${popularity} > 0`,
              sql`${popularity} desc, w.published_at desc`,
              8,
            ),
          ),
          rows(
            listQuery(
              sql`${f} and (select count(*) from ${workMembers} m where m.work_id = w.id) > 1`,
              sql`w.published_at desc`,
              8,
            ),
          ),
          rows(listQuery(sql`${f} and w.participation <> 'none'`, sql`w.published_at desc`, 8)),
          db.execute(
            sql`select t as tag, count(*)::int as works from ${works} w, unnest(w.tags) t where ${findable} group by t order by works desc, t limit 20`,
          ),
          rows(listQuery(sql`${f} and cardinality(w.open_roles) > 0`, sql`w.published_at desc`, 8)),
          rows(listQuery(sql`${f} and w.source->>'kind' = 'public_domain'`, sql`w.title`, 24)),
          rows(listQuery(sql`${f} and w.source->>'kind' = 'open_access'`, sql`w.published_at desc`, 24)),
        ])
      return {
        featured: featured.map(toWork),
        recent: recent.map(toWork),
        popular: popular.map(toWork),
        collaborative: collaborative.map(toWork),
        seekingContributors: seeking.map(toWork),
        openCalls: calls.map(toWork),
        classics: classics.map(toWork),
        research: research.map(toWork),
        topics: topics.rows as { tag: string; works: number }[],
      }
    }
  }

  /** This week's prompt and the pieces written for it (P-059). */
  app.get('/prompt', { schema: { response: { 200: WeeklyPrompt } } }, async () => {
    const p = promptFor()
    const where = sql`${p.tag} = any(w.tags)`
    const [recent, count] = await Promise.all([
      rows(listQuery(where, sql`w.published_at desc`, 6)),
      db.execute(sql`select count(*)::int as n from ${works} w where ${findable} and ${where}`),
    ])
    return { ...p, entries: (count.rows[0] as { n: number }).n, recent: recent.map(toWork) }
  })

  /** Everything search engines may list: findable works and public writers (sitemap.xml). */
  app.get(
    '/sitemap',
    {
      schema: {
        response: {
          200: z.object({
            works: z.array(z.object({ publicPath: z.string(), updatedAt: z.string() })),
            authors: z.array(z.object({ username: z.string() })),
          }),
        },
      },
    },
    async () => {
      const ws = await db.execute(
        sql`select w.slug || '-' || w.public_id as path, greatest(w.updated_at, w.published_at) as at from ${works} w where ${findable} order by w.published_at desc limit 20000`,
      )
      const as = await db.execute(
        sql`select p.username from ${profiles} p where p.is_public and exists (select 1 from ${works} w where w.owner_id = p.user_id and ${findable}) limit 20000`,
      )
      return {
        works: (ws.rows as { path: string; at: Date }[]).map((r) => ({
          publicPath: r.path,
          updatedAt: new Date(r.at).toISOString(),
        })),
        authors: (as.rows as { username: string }[]).map((r) => ({ username: r.username })),
      }
    },
  )

  app.get(
    '/search',
    {
      schema: { querystring: SearchQuery, response: { 200: SearchResults } },
      config: { rateLimit: { max: 60, timeWindow: '1 minute' } },
    },
    async (req) => {
      const { q, sort, page } = req.query
      const per = 20
      // websearch_to_tsquery accepts anything a person might type ("quotes", -minus, or) and never raises a syntax error.
      const query = sql`websearch_to_tsquery('simple', ${q})`
      const textMatch = q ? sql`w.search_vector @@ ${query}` : sql`true`
      const order =
        sort === 'recent' || !q
          ? sort === 'popular'
            ? sql`${popularity} desc, w.published_at desc`
            : sql`w.published_at desc`
          : sort === 'popular'
            ? sql`${popularity} desc, ts_rank(w.search_vector, ${query}) desc`
            : sql`ts_rank(w.search_vector, ${query}) desc, w.published_at desc`
      const found = await rows(
        listQuery(sql`${filters(req.query)} and ${textMatch}`, order, per + 1, (page - 1) * per),
      )
      // Authors: public profiles by name or username (first page only; wildcards in the query are literal).
      const authors =
        q && page === 1
          ? ((
              await db.execute(sql`
          select p.username, u.name as "displayName", p.avatar_seed as "avatarSeed", p.avatar, case when p.show_bio then p.bio else null end as bio
          from ${profiles} p join ${user} u on u.id = p.user_id
          where p.is_public and (p.username ilike ${likeEscape(q) + '%'} or u.name ilike ${'%' + likeEscape(q) + '%'})
          order by (p.username ilike ${likeEscape(q) + '%'}) desc, u.name limit 6`)
            ).rows.map((r) => ({ ...r, avatar: avatarOf(r.avatar) })) as SearchResults['authors'])
          : []
      return { works: found.slice(0, per).map(toWork), authors, page, hasMore: found.length > per }
    },
  )
}

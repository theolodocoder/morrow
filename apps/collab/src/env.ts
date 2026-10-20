import { z } from 'zod'

const Env = z.object({
  DATABASE_URL: z.string().min(1),
  COLLAB_PORT: z.coerce.number().int().default(4001),
  /** shared with the API: verifies collab tickets */
  TICKET_SECRET: z.string().min(32),
  /** shared with the API: signs internal requests */
  INTERNAL_SECRET: z.string().min(32),
  /** browser origins allowed to open WebSockets */
  ALLOWED_ORIGINS: z.string().transform((s) =>
    s
      .split(',')
      .map((o) => o.trim())
      .filter(Boolean),
  ),
  STORE_DEBOUNCE_MS: z.coerce.number().int().default(2000),
  STORE_MAX_DEBOUNCE_MS: z.coerce.number().int().default(10000),
  /** hard cap on concurrent connections per document (architecture §20) */
  ROOM_MAX_CONNECTIONS: z.coerce.number().int().default(200),
  /** how often a live connection's access is re-checked, on its next message */
  ACCESS_RECHECK_MS: z.coerce.number().int().default(30_000),
})
export type CollabEnv = z.infer<typeof Env>
export const parseEnv = (source: Record<string, string | undefined> = process.env): CollabEnv =>
  Env.parse(source)

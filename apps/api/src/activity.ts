import { activityEvents, type Transaction } from '@morrow/db'

/** Audit + outbox (architecture §20): written in the same transaction as the change it describes. */
export function recordActivity(
  tx: Transaction,
  e: {
    workId: string | null
    actorId: string
    type: string
    subjectType: string
    subjectId: string
    data?: Record<string, unknown>
  },
) {
  return tx.insert(activityEvents).values({ ...e, data: e.data ?? {} })
}

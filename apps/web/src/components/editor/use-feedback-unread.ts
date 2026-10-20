'use client'
import { useCallback, useEffect, useState } from 'react'
import type { FeedbackUnread } from '@morrow/contracts'
import { api } from '@/lib/client-api'
import type { Collab } from './use-collab'

/**
 * How much new feedback concerns me on this chapter. Refreshes live when collab says feedback changed; while the
 * panel is open everything counts as seen.
 */
export function useFeedbackUnread(documentId: string, collab: Collab | null, panelOpen: boolean) {
  const [unread, setUnread] = useState<FeedbackUnread>({ comments: 0, reactions: 0 })
  const refresh = useCallback(async () => {
    if (panelOpen) {
      await api(`/documents/${documentId}/feedback/seen`, { method: 'POST' }).catch(() => {})
      setUnread({ comments: 0, reactions: 0 })
    } else
      setUnread(
        await api<FeedbackUnread>(`/documents/${documentId}/feedback/unread`).catch(() => ({
          comments: 0,
          reactions: 0,
        })),
      )
  }, [documentId, panelOpen])
  const onFeedback = collab?.onFeedback // stable; the collab object isn't (it carries the save status)
  useEffect(() => {
    void refresh()
    // Collab announces every change to comments or reactions on this chapter.
    return onFeedback?.(() => void refresh())
  }, [onFeedback, refresh])
  return unread.comments + unread.reactions
}

'use client'
import { useEffect } from 'react'
import type { Editor } from '@tiptap/react'
import { isChangeOrigin } from '@morrow/editor'

/**
 * Counts the words this writer adds (P-055) and reports them every 20 seconds and when the page is hidden. Changes
 * that arrive from other writers move the baseline but never count, so a shared chapter credits each person for
 * their own words. Listeners (the goal ring) hear every local change straight away.
 */
const listeners = new Set<(delta: number) => void>()
let pending = 0

export const onLocalWords = (fn: (delta: number) => void) => {
  listeners.add(fn)
  return () => void listeners.delete(fn)
}
export const localDay = () => {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
const countWords = (editor: Editor) => {
  const text = editor.state.doc.textBetween(0, editor.state.doc.content.size, ' ', ' ')
  return text.match(/[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu)?.length ?? 0
}

function flush() {
  if (!pending) return
  const words = Math.max(-20000, Math.min(20000, pending))
  pending = 0
  void fetch('/api/v1/me/writing', {
    method: 'POST',
    credentials: 'same-origin',
    keepalive: true,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ day: localDay(), words }),
  }).catch(() => {
    pending += words // try again with the next report
  })
}

export function useWritingTracker(editor: Editor | null, enabled = true) {
  useEffect(() => {
    if (!editor || !enabled) return
    let last = countWords(editor)
    const onTx = ({
      transaction,
    }: {
      transaction: Parameters<typeof isChangeOrigin>[0] & { docChanged: boolean }
    }) => {
      if (!transaction.docChanged) return
      const now = countWords(editor)
      const delta = now - last
      last = now
      if (isChangeOrigin(transaction) || !delta) return
      pending += delta
      listeners.forEach((l) => l(delta))
    }
    editor.on('transaction', onTx)
    const timer = window.setInterval(flush, 20_000)
    const hide = () => document.visibilityState === 'hidden' && flush()
    document.addEventListener('visibilitychange', hide)
    window.addEventListener('pagehide', flush)
    return () => {
      editor.off('transaction', onTx)
      window.clearInterval(timer)
      document.removeEventListener('visibilitychange', hide)
      window.removeEventListener('pagehide', flush)
      flush()
    }
  }, [editor, enabled])
}

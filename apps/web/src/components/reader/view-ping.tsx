'use client'
import { useEffect } from 'react'
import { api } from '@/lib/client-api'

/**
 * Counts a read once the page has actually been open a moment (link prefetches and bots that don't run scripts never
 * count). The server keeps one per reader per work per day.
 */
export function ViewPing({ publicPath, author }: { publicPath?: string; author?: string }) {
  useEffect(() => {
    const t = setTimeout(() => {
      const path = author ? `/public/authors/${author}/view` : `/public/reading/${publicPath}/view`
      api(path, { method: 'POST' }).catch(() => {})
    }, 3000)
    return () => clearTimeout(t)
  }, [publicPath, author])
  return null
}

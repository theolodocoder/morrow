/** Small display helpers shared by public pages. */

const rtf = new Intl.RelativeTimeFormat('en', { numeric: 'auto', style: 'short' })

/** "3 hr. ago", "yesterday", or a date for anything older than a month. */
export function timeAgo(iso: string, now = Date.now()) {
  const s = (new Date(iso).getTime() - now) / 1000
  const abs = Math.abs(s)
  if (abs < 60) return 'just now'
  if (abs < 3600) return rtf.format(Math.round(s / 60), 'minute')
  if (abs < 86400) return rtf.format(Math.round(s / 3600), 'hour')
  if (abs < 86400 * 30) return rtf.format(Math.round(s / 86400), 'day')
  return new Date(iso).toLocaleDateString('en', { month: 'short', day: 'numeric', year: 'numeric' })
}

/** 950, 1.2k, 34k, 1.1m */
export function compact(n: number) {
  return new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 })
    .format(n)
    .toLowerCase()
}

export const readingMinutes = (words: number) => Math.max(1, Math.round(words / 230))

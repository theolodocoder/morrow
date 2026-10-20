import type { PublicWork } from '@morrow/contracts'
import { OG_SIZE, textCard, workCard } from '@/lib/og/share-card'
import { publicApi } from '@/lib/public-api'
import { CATEGORY_OPTIONS, labelOf } from '@/lib/work-options'

export const size = OG_SIZE
export const contentType = 'image/png'
export const alt = 'A work on Morrow'

export default async function Image({ params }: { params: Promise<{ workSlug: string }> }) {
  const w = await publicApi<PublicWork>(`/works/${encodeURIComponent((await params).workSlug)}`).catch(
    () => null,
  )
  if (!w) return textCard({ kicker: 'Morrow', title: 'Words, worlds and ideas, still becoming.' })
  const others = w.contributors.length
  return workCard({
    title: w.title,
    kind: labelOf(CATEGORY_OPTIONS, w.category),
    byline: `by ${w.author.displayName}${others ? ` and ${others} other${others > 1 ? 's' : ''}` : ''}`,
    cover: w.cover,
  })
}

import type { PublicAuthor } from '@morrow/contracts'
import { OG_SIZE, textCard } from '@/lib/og/share-card'
import { publicApi } from '@/lib/public-api'

export const size = OG_SIZE
export const contentType = 'image/png'
export const alt = 'A writer on Morrow'

export default async function Image({ params }: { params: Promise<{ username: string }> }) {
  const a = await publicApi<PublicAuthor>(`/authors/${encodeURIComponent((await params).username)}`).catch(
    () => null,
  )
  if (!a) return textCard({ kicker: 'Morrow', title: 'Words, worlds and ideas, still becoming.' })
  return textCard({
    kicker: 'A writer on Morrow',
    title: a.displayName,
    line: `${a.works.length} ${a.works.length === 1 ? 'work' : 'works'} · @${a.username}`,
  })
}

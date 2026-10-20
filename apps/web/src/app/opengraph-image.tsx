import { OG_SIZE, textCard } from '@/lib/og/share-card'

export const size = OG_SIZE
export const contentType = 'image/png'
export const alt = 'Morrow: stories, articles, poems and papers, written in the open'

export default async function Image() {
  return textCard({
    kicker: 'Morrow',
    title: 'Good ideas deserve a tomorrow.',
    line: 'Stories, poems, essays and research, written in the open, alone or together.',
  })
}

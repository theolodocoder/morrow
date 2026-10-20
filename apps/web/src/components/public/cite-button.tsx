'use client'
import type { OpenAccessInfo } from '@morrow/contracts'
import { Button } from '@/components/ui/button'
import { LinkIcon } from '@/components/ui/icons'
import { toast } from '@/components/ui/toast'

/** Author A, Author B. (Year). Title. Journal. https://doi.org/… */
export function citationOf(title: string, info: OpenAccessInfo) {
  const authors =
    info.authors.length > 6 ? `${info.authors.slice(0, 6).join(', ')}, et al.` : info.authors.join(', ')
  return `${authors}. (${info.year}). ${title}. ${info.journal}. ${info.url}`.replace(/\.\./g, '.')
}

/** Cite an open-access article (P-064): copies a ready-made citation, with its DOI link. */
export function CiteButton({ title, info }: { title: string; info: OpenAccessInfo }) {
  async function copy() {
    try {
      await navigator.clipboard.writeText(citationOf(title, info))
      toast('Citation copied')
    } catch {
      toast('Couldn’t copy. Select the source line below instead.')
    }
  }
  return (
    <Button size="lg" variant="secondary" className="h-11" onPress={() => void copy()}>
      <LinkIcon size={17} />
      Cite
    </Button>
  )
}

import type { Work } from '@morrow/contracts'
import { Icon } from '@/components/ui/icons'

/**
 * One glyph per kind of writing, drawn on the icon set's 20px monoline grid: Discover's category tiles and the Write
 * sheet use them, so a kind looks the same wherever you meet it. Decorative: the label beside it carries the name.
 */
const PATHS: Record<Work['category'], string> = {
  // an open book
  novel:
    'M10 5.5C8.2 4.3 6 4 3.5 4.3v10.5c2.5-.3 4.7 0 6.5 1.2 1.8-1.2 4-1.5 6.5-1.2V4.3C14 4 11.8 4.3 10 5.5Zm0 0V16',
  // a spark
  fiction:
    'M10 3l1.6 4.4L16 9l-4.4 1.6L10 15l-1.6-4.4L4 9l4.4-1.6L10 3Zm5 9.5.6 1.4 1.4.6-1.4.6-.6 1.4-.6-1.4-1.4-.6 1.4-.6.6-1.4Z',
  // a page with its corner folded
  short_story: 'M5 3h7l3 3v11H5V3Zm7 0v3h3M7.5 10h5M7.5 13h3.5',
  // books on a shelf
  novella: 'M3.5 16h13M5 16V6h3v10M8 16V4h3v12m1.6 0 1.8-9 2.8.6-1.8 8.9',
  // stacked leaves
  collection: 'M10 3l7 3.5-7 3.5-7-3.5L10 3Zm-7 7 7 3.5 7-3.5m-14 3.5L10 17l7-3.5',
  // a quill
  poetry: 'M16 3.5c-5.5.5-9 4.2-10 10l-1.5 3m1.9-4c3 0 6-1.6 7.5-4.6M9.2 9.3h3.6',
  // quotation marks
  essay: 'M5 11c0-3 1.5-4.6 3.5-5.2M5 11h3v3.5H5V11Zm6 0c0-3 1.5-4.6 3.5-5.2M11 11h3v3.5h-3V11Z',
  // a folded newspaper
  article: 'M3.5 4.5h10v11h-10v-11Zm10 3h3V14a1.5 1.5 0 0 1-3 0M6 7.5h5M6 10h5m-5 2.5h3',
  // a flask
  research_paper: 'M8 3h4m-3.5 0v5l-4 7.5a1 1 0 0 0 .9 1.5h9.2a1 1 0 0 0 .9-1.5l-4-7.5V3m-5 9h7',
  // a mortarboard
  educational: 'M10 4l8 3.5-8 3.5-8-3.5L10 4Zm-4.5 5v4c1.5 1.3 3 2 4.5 2s3-.7 4.5-2V9M18 7.5v4',
  // a lined sheet
  general_document: 'M5 3h10v14H5V3Zm2.5 4h5m-5 3h5m-5 3h3',
  // an asterisk
  other: 'M10 4v12M4.8 7l10.4 6m0-6L4.8 13',
}

export function KindGlyph({ kind, size = 20 }: { kind: Work['category']; size?: number }) {
  return (
    <Icon size={size}>
      <path d={PATHS[kind]} />
    </Icon>
  )
}

/** Comics (coming soon): a page of panels with a speech bubble. */
export function ComicGlyph({ size = 20 }: { size?: number }) {
  return (
    <Icon size={size}>
      <path d="M3.5 3.5h13v13h-13v-13Zm0 6h6.5v7M10 3.5v6" />
      <path d="M12.2 11.5h3.3v2.6h-1.9l-1 1.1v-1.1h-.4v-2.6Z" />
    </Icon>
  )
}

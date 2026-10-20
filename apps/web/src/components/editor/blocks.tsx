/**
 * Every block a writer can add, in one catalogue: the "/" menu, the + handle and "Turn into" all read from it.
 * Each block says which forms of writing it's for, so a poem's menu leads with verse and a paper's with tables and
 * citations, while everything stays one search away (nothing is hidden, only ordered).
 */
import type { Editor, Range } from '@tiptap/react'
import type { WORK_CATEGORIES } from '@morrow/contracts'
import { CodeIcon, Icon, QuoteIcon } from '@/components/ui/icons'

type Form = (typeof WORK_CATEGORIES)[number]
const FICTION: Form[] = ['novel', 'novella', 'short_story', 'fiction', 'collection']
const PROSE: Form[] = ['article', 'essay', 'educational', 'general_document']
const PAPER: Form[] = ['research_paper']

export interface BlockItem {
  id: string
  label: string
  description: string
  icon: React.ReactNode
  /** extra words people might type to find it */
  keywords: string[]
  /** forms this block is especially for (ranked first in their menu) */
  forms: Form[]
  group: 'Text' | 'Structure' | 'Notes and references'
  /** can a text block be turned into this? */
  turnInto?: boolean
  isActive?: (e: Editor) => boolean
  run: (e: Editor, range?: Range) => void
}

const g = (d: React.ReactNode) => <Icon size={18}>{d}</Icon>
/** A note marker sits against its word: "tides /cite" gives "tides[1]", not "tides [1]". */
const hugWord = (e: Editor, r?: Range) =>
  r && r.from > 1 && e.state.doc.textBetween(r.from - 1, r.from) === ' ' ? { ...r, from: r.from - 1 } : r

/** Start a chain, removing the "/query" first when called from the menu. */
const at = (e: Editor, range?: Range) => (range ? e.chain().focus().deleteRange(range) : e.chain().focus())

export const BLOCKS: BlockItem[] = [
  {
    id: 'text',
    label: 'Text',
    description: 'Plain paragraphs.',
    icon: g(<path d="M5 5h10M10 5v10" />),
    keywords: ['paragraph', 'plain', 'body'],
    forms: [],
    group: 'Text',
    turnInto: true,
    isActive: (e) => e.isActive('paragraph'),
    run: (e, r) => at(e, r).setParagraph().run(),
  },
  {
    id: 'h2',
    label: 'Heading',
    description: 'A section title.',
    icon: g(<path d="M4 5v10M11 5v10M4 10h7M14 9l2-1v7" />),
    keywords: ['title', 'section', 'h2', 'heading 1'],
    forms: [...PROSE, ...PAPER],
    group: 'Text',
    turnInto: true,
    isActive: (e) => e.isActive('heading', { level: 2 }),
    run: (e, r) => at(e, r).setHeading({ level: 2 }).run(),
  },
  {
    id: 'h3',
    label: 'Subheading',
    description: 'A smaller title inside a section.',
    icon: g(
      <path d="M4 5v10M11 5v10M4 10h7M14 8.5c.5-.7 2.5-.9 2.5.5 0 1-1.25 1.25-1.25 1.25s1.5.1 1.5 1.5c0 1.6-2.25 1.6-2.75.75" />,
    ),
    keywords: ['subsection', 'h3', 'heading 2'],
    forms: [...PROSE, ...PAPER],
    group: 'Text',
    turnInto: true,
    isActive: (e) => e.isActive('heading', { level: 3 }),
    run: (e, r) => at(e, r).setHeading({ level: 3 }).run(),
  },
  {
    id: 'h4',
    label: 'Minor heading',
    description: 'A third level, for papers and long guides.',
    icon: g(<path d="M4 5v10M11 5v10M4 10h7M16.5 15V8l-3 4.5h4" />),
    keywords: ['subsubsection', 'h4', 'heading 3'],
    forms: PAPER,
    group: 'Text',
    turnInto: true,
    isActive: (e) => e.isActive('heading', { level: 4 }),
    run: (e, r) => at(e, r).setHeading({ level: 4 }).run(),
  },
  {
    id: 'verse',
    label: 'Verse',
    description: 'Lines kept exactly as you break them. Enter for a new line, twice to finish.',
    icon: g(<path d="M4 5.5h9M6 9h8M4 12.5h7M7 16h7" />),
    keywords: ['poem', 'poetry', 'stanza', 'lyrics', 'lines'],
    forms: ['poetry', 'collection'],
    group: 'Text',
    turnInto: true,
    isActive: (e) => e.isActive('verse'),
    run: (e, r) => at(e, r).setVerse().run(),
  },
  {
    id: 'quote',
    label: 'Quote',
    description: 'A passage set apart, or an epigraph.',
    icon: <QuoteIcon size={18} />,
    keywords: ['blockquote', 'epigraph', 'citation'],
    forms: [...FICTION, ...PROSE],
    group: 'Text',
    turnInto: true,
    isActive: (e) => e.isActive('blockquote'),
    run: (e, r) => at(e, r).toggleBlockquote().run(),
  },
  {
    id: 'bullets',
    label: 'Bulleted list',
    description: 'Points in no particular order.',
    icon: g(<path d="M8 6h8M8 10h8M8 14h8M4.5 6h.01M4.5 10h.01M4.5 14h.01" />),
    keywords: ['list', 'ul', 'points'],
    forms: [...PROSE, ...PAPER],
    group: 'Structure',
    turnInto: true,
    isActive: (e) => e.isActive('bulletList'),
    run: (e, r) => at(e, r).toggleBulletList().run(),
  },
  {
    id: 'numbers',
    label: 'Numbered list',
    description: 'Steps or ranked points.',
    icon: g(<path d="M9 6h7M9 10h7M9 14h7M4 5l1-.5V8M4 12c.5-.6 2-.6 2 .3 0 .9-2 1.2-2 2.2h2" />),
    keywords: ['ordered', 'ol', 'steps'],
    forms: [...PROSE, ...PAPER],
    group: 'Structure',
    turnInto: true,
    isActive: (e) => e.isActive('orderedList'),
    run: (e, r) => at(e, r).toggleOrderedList().run(),
  },
  {
    id: 'checklist',
    label: 'Checklist',
    description: 'Things to do, ticked off as you go.',
    icon: g(<path d="M3.5 6.5 5 8l2.5-3M10 6.5h6.5M3.5 13h3v3h-3zM10 14.5h6.5" />),
    keywords: ['todo', 'task', 'checkbox'],
    forms: ['general_document', 'educational'],
    group: 'Structure',
    turnInto: true,
    isActive: (e) => e.isActive('taskList'),
    run: (e, r) => at(e, r).toggleTaskList().run(),
  },
  {
    id: 'scene',
    label: 'Scene break',
    description: 'A pause between scenes (⁂). Or type *** on an empty line.',
    icon: g(<path d="M10 6.5v.01M6.5 13v.01M13.5 13v.01" />),
    keywords: ['break', 'asterism', 'section', 'chapter', 'dinkus'],
    forms: FICTION,
    group: 'Structure',
    run: (e, r) => at(e, r).insertSceneBreak().run(),
  },
  {
    id: 'divider',
    label: 'Divider',
    description: 'A plain line across the page. Or type --- on an empty line.',
    icon: g(<path d="M3 10h14" />),
    keywords: ['hr', 'rule', 'line', 'separator'],
    forms: PROSE,
    group: 'Structure',
    run: (e, r) => at(e, r).setHorizontalRule().run(),
  },
  {
    id: 'callout',
    label: 'Callout',
    description: 'A boxed note for readers.',
    icon: g(
      <path d="M4 4.5h12a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1v-9a1 1 0 0 1 1-1ZM6.5 8.5v3M6.5 7v.01M9.5 8h5M9.5 11h4" />,
    ),
    keywords: ['note', 'aside', 'box', 'info'],
    forms: [...PROSE],
    group: 'Structure',
    turnInto: true,
    isActive: (e) => e.isActive('callout', { tone: 'note' }),
    run: (e, r) => at(e, r).toggleCallout('note').run(),
  },
  {
    id: 'tip',
    label: 'Tip',
    description: 'A helpful aside, marked as a tip.',
    icon: g(<path d="M10 3.5a4.5 4.5 0 0 0-2.5 8.25V14h5v-2.25A4.5 4.5 0 0 0 10 3.5ZM8 16.5h4" />),
    keywords: ['hint', 'callout', 'advice'],
    forms: ['educational', 'article'],
    group: 'Structure',
    turnInto: true,
    isActive: (e) => e.isActive('callout', { tone: 'tip' }),
    run: (e, r) => at(e, r).toggleCallout('tip').run(),
  },
  {
    id: 'warning',
    label: 'Warning',
    description: 'Something readers must not miss.',
    icon: g(<path d="M10 3.5 17 16H3L10 3.5ZM10 8.5V12M10 14v.01" />),
    keywords: ['caution', 'alert', 'callout'],
    forms: ['educational'],
    group: 'Structure',
    turnInto: true,
    isActive: (e) => e.isActive('callout', { tone: 'warning' }),
    run: (e, r) => at(e, r).toggleCallout('warning').run(),
  },
  {
    id: 'abstract',
    label: 'Abstract',
    description: 'The summary at the top of a paper.',
    icon: g(<path d="M4 4h12M4 16h12M6 8h8M6 12h6" />),
    keywords: ['summary', 'paper', 'callout'],
    forms: PAPER,
    group: 'Structure',
    turnInto: true,
    isActive: (e) => e.isActive('callout', { tone: 'abstract' }),
    run: (e, r) => at(e, r).toggleCallout('abstract').run(),
  },
  {
    id: 'table',
    label: 'Table',
    description: 'Rows and columns, with a header row.',
    icon: g(<path d="M3.5 4.5h13v11h-13zM3.5 8.5h13M3.5 12h13M8.5 4.5v11" />),
    keywords: ['grid', 'data', 'columns', 'rows'],
    forms: [...PAPER, 'article', 'educational'],
    group: 'Structure',
    run: (e, r) =>
      at(e, r)
        .insertTable({ rows: 3, cols: 3, withHeaderRow: true })
        // a table at the very end would leave nowhere to keep writing: add a line after it
        .command(({ tr, state }) => {
          const last = tr.doc.lastChild
          if (last?.type.name === 'table')
            tr.insert(tr.doc.content.size, state.schema.nodes.paragraph!.create())
          return true
        })
        .run(),
  },
  {
    id: 'code',
    label: 'Code',
    description: 'Text exactly as typed, in a fixed-width font.',
    icon: <CodeIcon size={18} />,
    keywords: ['code block', 'snippet', 'monospace', 'preformatted'],
    forms: ['educational', 'research_paper'],
    group: 'Structure',
    turnInto: true,
    isActive: (e) => e.isActive('codeBlock'),
    run: (e, r) => at(e, r).toggleCodeBlock().run(),
  },
  {
    id: 'footnote',
    label: 'Footnote',
    description: 'A numbered note; readers find it at the end of the chapter.',
    icon: g(<path d="M4 15h7M4 11.5h9M13.5 4.5l1.5-1V9" />),
    keywords: ['note', 'endnote', 'aside'],
    forms: [...FICTION, ...PROSE],
    group: 'Notes and references',
    run: (e, r) => {
      at(e, hugWord(e, r)).insertNote('footnote').run()
      // select the new marker so its note opens for writing
      e.commands.setNodeSelection(e.state.selection.from - 1)
    },
  },
  {
    id: 'citation',
    label: 'Citation',
    description: 'A numbered reference, listed under References.',
    icon: g(<path d="M7 4.5H5v11h2M13 4.5h2v11h-2M8.5 10h3" />),
    keywords: ['reference', 'source', 'cite', 'bibliography'],
    forms: [...PAPER, 'essay', 'article'],
    group: 'Notes and references',
    run: (e, r) => {
      at(e, hugWord(e, r)).insertNote('citation').run()
      // select the new marker so its note opens for writing
      e.commands.setNodeSelection(e.state.selection.from - 1)
    },
  },
]

/**
 * The menu for a form. With no query: the form's own blocks first, then the rest in catalogue order. With a query:
 * best match first (label starts with it, then label contains it, then a keyword, then the description).
 */
export type MenuItem = BlockItem & { section: string }

export function blocksFor(form: string | undefined, query: string): MenuItem[] {
  const q = query.trim().toLowerCase()
  if (!q) {
    const mine = BLOCKS.filter((b) => !!form && b.forms.includes(form as Form))
    return [
      ...mine.map((b) => ({ ...b, section: 'Suggested' })),
      ...BLOCKS.filter((b) => !mine.includes(b)).map((b) => ({ ...b, section: b.group })),
    ]
  }
  const score = (b: BlockItem) => {
    const label = b.label.toLowerCase()
    if (label.startsWith(q)) return 0
    if (label.includes(q)) return 1
    if (b.keywords.some((k) => k.startsWith(q))) return 2
    if (b.keywords.some((k) => k.includes(q))) return 3
    if (b.description.toLowerCase().includes(q)) return 4
    return 9
  }
  return BLOCKS.map((b) => ({ b, s: score(b) }))
    .filter((x) => x.s < 9)
    .sort((x, y) => x.s - y.s)
    .map((x) => ({ ...x.b, section: '' }))
}

/** What the placeholder suggests on an empty line, by form. */
export const PLACEHOLDER: Partial<Record<Form, string>> = {
  poetry: 'Write a line… (Shift+Enter for a new line, / for verse and more)',
  research_paper: 'Write, or type / for headings, tables and citations…',
  article: 'Write, or type / for headings, lists and callouts…',
  essay: 'Write, or type / for headings, quotes and footnotes…',
  educational: 'Write, or type / for steps, tips and tables…',
}
export const DEFAULT_PLACEHOLDER = 'Write, or type / for blocks…'

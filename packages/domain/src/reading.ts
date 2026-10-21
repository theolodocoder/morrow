/**
 * Reading-page helpers shared by the web reader (chapter opener, contents, up-next card). Pure, so they are tested
 * here rather than in apps/web, which has no unit-test runner.
 */

/** PRD FR-004 categories. `novella` and `collection` are kept from earlier works. Lives here (not contracts) so the
 * reading helpers can type against it without domain depending on contracts. */
export const WORK_CATEGORIES = [
  'fiction',
  'novel',
  'novella',
  'short_story',
  'collection',
  'poetry',
  'article',
  'essay',
  'research_paper',
  'educational',
  'general_document',
  'other',
] as const
export type WorkCategory = (typeof WORK_CATEGORIES)[number]

const WORDS = [
  'one',
  'two',
  'three',
  'four',
  'five',
  'six',
  'seven',
  'eight',
  'nine',
  'ten',
  'eleven',
  'twelve',
  'thirteen',
  'fourteen',
  'fifteen',
  'sixteen',
  'seventeen',
  'eighteen',
  'nineteen',
  'twenty',
]

const PART: readonly WorkCategory[] = ['article', 'essay', 'educational', 'general_document']

/**
 * The opener's label for the piece at `index` (0-based) of `total`: "Chapter three" for stories, "Part 2" for
 * essays and guides, "Section 2" for papers. A single-piece work has no label: "Chapter one" of one reads oddly.
 */
export function sectionLabel(form: WorkCategory, index: number, total: number): string | null {
  if (total === 1) return null
  const n = index + 1
  if (form === 'research_paper') return `Section ${n}`
  if (PART.includes(form)) return `Part ${n}`
  return `Chapter ${WORDS[index] ?? n}`
}

/** Reading time at 230 words a minute, rounded up so a short chapter still reads "1 min". */
export function minutesFor(words: number): number {
  return Math.ceil(Math.max(0, words) / 230)
}

/** The opener's credit line, author first: "Ama Owusu, with Tolu Ade"; past three people the rest are counted. */
export function creditLine(names: readonly string[]): string {
  const [author, ...rest] = names
  if (!author) return ''
  if (rest.length === 0) return author
  const shown = rest.slice(0, 2)
  const more = rest.length - shown.length
  const tail = more > 0 ? [...shown, `${more} ${more === 1 ? 'other' : 'others'}`] : shown
  return `${author}, with ${tail.slice(0, -1).join(', ')}${tail.length > 1 ? ' and ' : ''}${tail.at(-1)}`
}

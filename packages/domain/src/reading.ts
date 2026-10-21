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

/** Minutes left given scroll progress (0..1); null when there is nothing to say, so the running head stays quiet. */
export function minutesLeft(words: number, progress: number): number | null {
  const left = minutesFor(Math.max(0, words) * (1 - Math.min(1, Math.max(0, progress))))
  return left > 0 ? left : null
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

/** Where a reader got to in one chapter (spec call 6): the furthest paragraph reached and how far through, 0..100. */
export type Position = { chapterSlug: string; blockId: string | null; percent: number }

/** One saved position, or null for anything else: device storage is old, hand-edited or from an earlier format. */
function clean(x: unknown): Position | null {
  if (!x || typeof x !== 'object') return null
  const { chapterSlug, blockId, percent } = x as Record<string, unknown>
  if (typeof chapterSlug !== 'string' || typeof percent !== 'number' || !Number.isFinite(percent)) return null
  return {
    chapterSlug,
    blockId: typeof blockId === 'string' ? blockId : null,
    percent: Math.round(Math.min(100, Math.max(0, percent))),
  }
}

/**
 * The device's and the account's positions as one list in reading order: the furthest point wins per chapter (the
 * account's on a tie). Chapters no longer published (removed, or renamed so the slug changed) are dropped.
 */
export function mergePositions(local: Position[], server: Position[], liveSlugs: string[]): Position[] {
  const best = new Map<string, Position>()
  for (const list of [server, local])
    for (const p of (Array.isArray(list) ? list : []).map(clean))
      if (p && p.percent > (best.get(p.chapterSlug)?.percent ?? -1)) best.set(p.chapterSlug, p)
  return liveSlugs.flatMap((s) => best.get(s) ?? [])
}

/**
 * The device's positions the account is behind on, to send on signing in: live chapters only (a stale one would be
 * resent forever, since the server never stores it), furthest first, at most `limit` so the save stays within the
 * API's cap. Whatever doesn't fit is still behind next visit and goes then.
 */
export function aheadOf(
  local: Position[],
  server: Position[],
  liveSlugs: string[],
  limit: number,
): Position[] {
  const theirs = new Map(mergePositions(server, [], liveSlugs).map((p) => [p.chapterSlug, p.percent]))
  return mergePositions(local, [], liveSlugs)
    .filter((p) => p.percent > (theirs.get(p.chapterSlug) ?? -1))
    .sort((a, b) => b.percent - a.percent)
    .slice(0, limit)
}

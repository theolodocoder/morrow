import { plainText, type PMNode } from './content.ts'

/**
 * The first line of prose in a document, for "Up next" teasers: the first block that has any text,
 * cut at a word boundary within `max` characters. `null` when the document has no text.
 */
export function openingLine(doc: unknown, max = 200): string | null {
  const blocks = (doc as PMNode | null)?.content ?? []
  for (const block of blocks) {
    const text = plainText({ type: 'doc', content: [block] }).replace(/\s+/g, ' ')
    if (!text) continue
    if (text.length <= max) return text
    // one char past max, so a space exactly at the limit keeps the last whole word
    const space = text.lastIndexOf(' ', max)
    // ponytail: a single unbroken run longer than max is cut mid-word (no space to back up to)
    return `${text.slice(0, space > 0 ? space : max).trimEnd()}…`
  }
  return null
}

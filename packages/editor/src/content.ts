// Pure helpers over ProseMirror JSON. Safe to use anywhere (browser, server, tests).

export interface PMNode {
  type: string
  attrs?: Record<string, unknown>
  content?: PMNode[]
  text?: string
  marks?: { type: string; attrs?: Record<string, unknown> }[]
}

/**
 * Remove block ids before inserting content programmatically (imports, templates, server edits).
 * UniqueID only de-duplicates ids on real paste/drop events, so any other insert must strip them (spike S2).
 */
export function stripBlockIds(node: PMNode): PMNode {
  const { attrs, content, ...rest } = node
  const nextAttrs =
    attrs && 'id' in attrs ? Object.fromEntries(Object.entries(attrs).filter(([k]) => k !== 'id')) : attrs
  return {
    ...rest,
    ...(nextAttrs ? { attrs: nextAttrs } : {}),
    ...(content ? { content: content.map(stripBlockIds) } : {}),
  }
}

export function findDuplicateBlockIds(doc: PMNode): string[] {
  const seen = new Set<string>(),
    dupes = new Set<string>()
  for (const block of doc.content ?? []) {
    const id = block.attrs?.id
    if (typeof id !== 'string') continue
    if (seen.has(id)) dupes.add(id)
    seen.add(id)
  }
  return [...dupes]
}

const BLOCK_SEPARATED = new Set([
  'paragraph',
  'heading',
  'listItem',
  'taskItem',
  'blockquote',
  'horizontalRule',
  'sceneBreak',
  'verse',
  'tableCell',
  'tableHeader',
])

export function plainText(doc: PMNode): string {
  const out: string[] = []
  const walk = (n: PMNode) => {
    if (n.type === 'text') out.push(n.text ?? '')
    else if (n.type === 'hardBreak') out.push('\n')
    n.content?.forEach(walk)
    if (BLOCK_SEPARATED.has(n.type)) out.push('\n')
  }
  walk(doc)
  return out
    .join('')
    .replace(/\n{2,}/g, '\n')
    .trim()
}

/** Word count for prose: whitespace-separated tokens, ignoring punctuation-only tokens such as "—". */
export function wordCount(text: string): number {
  return text.split(/\s+/).filter((t) => /[\p{L}\p{N}]/u.test(t)).length
}

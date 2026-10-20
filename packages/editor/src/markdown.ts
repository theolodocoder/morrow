/**
 * ProseMirror JSON → Markdown, for export and data portability (Q-008). Pure; works from projections, so it never
 * touches live collaborative state. Unknown nodes degrade to their text rather than disappearing.
 */
import type { PMNode } from './content.ts'

const escape = (s: string) => s.replace(/([\\`*_[\]#>])/g, '\\$1').replace(/^(\d+)\. /, '$1\\. ')

/** Footnotes and citations met so far in this document, numbered in reading order. */
interface Notes {
  footnotes: string[]
  citations: string[]
}
let notes: Notes = { footnotes: [], citations: [] }

function inline(nodes: PMNode[] = []): string {
  return nodes
    .map((n) => {
      if (n.type === 'hardBreak') return '  \n'
      if (n.type === 'note') {
        const text = String(n.attrs?.text ?? '')
        if (n.attrs?.kind === 'citation') {
          notes.citations.push(text)
          return `[${notes.citations.length}]`
        }
        notes.footnotes.push(text)
        return `[^${notes.footnotes.length}]`
      }
      if (n.type !== 'text') return inline(n.content)
      let t = escape(n.text ?? '')
      for (const m of n.marks ?? []) {
        if (m.type === 'code') t = '`' + (n.text ?? '').replace(/`/g, '\\`') + '`'
        else if (m.type === 'bold') t = `**${t}**`
        else if (m.type === 'italic') t = `*${t}*`
        else if (m.type === 'strike') t = `~~${t}~~`
        else if (m.type === 'underline')
          t = `<u>${t}</u>` // Markdown has no underline; inline HTML is the common convention
        else if (m.type === 'link' && typeof m.attrs?.href === 'string') t = `[${t}](${m.attrs.href})`
        else if (m.type === 'highlight') t = `==${t}==`
        else if (m.type === 'superscript') t = `<sup>${t}</sup>`
        else if (m.type === 'subscript') t = `<sub>${t}</sub>`
      }
      return t
    })
    .join('')
}

function block(n: PMNode, prefix = ''): string {
  switch (n.type) {
    case 'paragraph':
      return prefix + inline(n.content)
    case 'heading':
      return `${'#'.repeat(Math.min(6, Number(n.attrs?.level ?? 2)))} ${inline(n.content)}`
    case 'codeBlock':
      return '```\n' + (n.content ?? []).map((t) => t.text ?? '').join('') + '\n```'
    case 'horizontalRule':
    case 'sceneBreak':
      return '* * *'
    case 'verse':
      // keep every line break and leading space: Markdown needs both made explicit
      return (n.content ?? [])
        .map((t) => escape(t.text ?? ''))
        .join('')
        .split('\n')
        .map((l) => l.replace(/^ +/, (sp) => '&nbsp;'.repeat(sp.length)))
        .join('  \n')
    case 'callout': {
      const label = { tip: 'Tip', warning: 'Warning', abstract: 'Abstract' }[String(n.attrs?.tone)] ?? 'Note'
      const inner = (n.content ?? []).map((c) => block(c)).join('\n\n')
      return `**${label}:** ${inner}`
        .split('\n')
        .map((l) => `> ${l}`.trimEnd())
        .join('\n')
    }
    case 'taskList':
      return (n.content ?? [])
        .map((item) => {
          const inner = (item.content ?? []).map((c) => block(c)).join('\n\n')
          return `- [${item.attrs?.checked ? 'x' : ' '}] ${inner.split('\n').join('\n      ')}`
        })
        .join('\n')
    case 'table': {
      const rows = (n.content ?? []).map((row) =>
        (row.content ?? []).map((cell) =>
          (cell.content ?? [])
            .map((c) => block(c))
            .join(' ')
            .replace(/\|/g, '\\|')
            .replace(/\n/g, ' '),
        ),
      )
      if (!rows.length) return ''
      const width = Math.max(...rows.map((r) => r.length))
      const line = (r: string[]) => `| ${Array.from({ length: width }, (_, i) => r[i] ?? '').join(' | ')} |`
      return [line(rows[0]!), `| ${Array(width).fill('---').join(' | ')} |`, ...rows.slice(1).map(line)].join(
        '\n',
      )
    }
    case 'blockquote':
      return (n.content ?? [])
        .map((c) => block(c))
        .join('\n\n')
        .split('\n')
        .map((l) => `> ${l}`.trimEnd())
        .join('\n')
    case 'bulletList':
    case 'orderedList':
      return (n.content ?? [])
        .map((item, i) => {
          const marker = n.type === 'bulletList' ? '- ' : `${i + 1}. `
          const inner = (item.content ?? []).map((c) => block(c)).join('\n\n')
          return marker + inner.split('\n').join(`\n${' '.repeat(marker.length)}`)
        })
        .join('\n')
    default:
      return inline(n.content)
  }
}

export function documentToMarkdown(doc: PMNode): string {
  notes = { footnotes: [], citations: [] }
  const body = (doc.content ?? [])
    .map((b) => block(b))
    .filter((s) => s.length > 0)
    .join('\n\n')
  const { footnotes, citations } = notes
  const tail = [
    ...(footnotes.length ? [footnotes.map((t, i) => `[^${i + 1}]: ${escape(t)}`).join('\n')] : []),
    ...(citations.length
      ? ['**References**', citations.map((t, i) => `${i + 1}. ${escape(t)}`).join('\n')]
      : []),
  ]
  return [body, ...tail].filter(Boolean).join('\n\n')
}

/** A whole branch: title, then each chapter as a level-2 section (chapter-internal headings shift down one level). */
export function workToMarkdown(title: string, chapters: { title: string; content: PMNode }[]): string {
  const shift = (doc: PMNode): PMNode => ({
    ...doc,
    content: (doc.content ?? []).map((b) =>
      b.type === 'heading' ? { ...b, attrs: { ...b.attrs, level: Number(b.attrs?.level ?? 2) + 1 } } : b,
    ),
  })
  return (
    [
      `# ${escape(title)}`,
      ...chapters.map((c) => `## ${escape(c.title)}\n\n${documentToMarkdown(shift(c.content))}`.trimEnd()),
    ].join('\n\n') + '\n'
  )
}

/**
 * Public-domain books from Project Gutenberg's HTML editions, turned into Morrow chapters (P-063).
 *
 * - Only the text between the "*** START OF …" and "*** END OF …" markers is kept. That strips the Project Gutenberg
 *   header, licence and footer; redistributing without their licence means removing the trademark too, so any
 *   paragraph that still names it is dropped.
 * - Chapters begin at each <h2> (or <h3> when a book uses those for chapters). Paragraphs keep italics and bold; block
 *   quotes stay quotes; poems (div.poem / div.stanza) become verse with their lines; <hr> becomes a scene break.
 * - Front matter (title pages, contents) is skipped, and nothing else from the HTML survives: the result is checked
 *   against the manuscript schema when it's stored.
 */
import { parse, type HTMLElement, type Node as HNode } from 'node-html-parser'

type Mark = { type: 'italic' | 'bold' }
type Text = { type: 'text'; text: string; marks?: Mark[] }
type Block =
  | { type: 'paragraph'; attrs: { id: string }; content?: Text[] }
  | { type: 'blockquote'; attrs: { id: string }; content: Block[] }
  | { type: 'verse'; attrs: { id: string }; content?: Text[] }
  | { type: 'sceneBreak'; attrs: { id: string } }
export interface Chapter {
  title: string
  doc: { type: 'doc'; content: Block[] }
}

const TRADEMARK = /project\s+gutenberg|gutenberg-tm|gutenberg™/i
const SKIP_HEADING =
  /^(contents|table of contents|illustrations|list of illustrations|transcriber.?s note)\b/i
const clean = (s: string) =>
  s
    .replace(/\s+/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .trim()

function decode(s: string) {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, '’')
    .replace(/&mdash;/g, '—')
    .replace(/&ndash;/g, '–')
    .replace(/&nbsp;/g, ' ')
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
}

/** Inline content with italic/bold marks; footnote anchors, page numbers and images dropped. */
function inline(node: HNode, marks: Mark[] = [], out: Text[] = []): Text[] {
  for (const c of node.childNodes) {
    if (c.nodeType === 3) {
      const text = decode(c.rawText).replace(/\s+/g, ' ')
      if (text) out.push(marks.length ? { type: 'text', text, marks } : { type: 'text', text })
      continue
    }
    if (c.nodeType !== 1) continue
    const el = c as HTMLElement
    const tag = el.tagName?.toLowerCase()
    const cls = el.getAttribute('class') ?? ''
    if (tag === 'img' || /pagenum|fnanchor|footnote/i.test(cls)) continue
    if (tag === 'a' && /^#(fn|note|footnote)/i.test(el.getAttribute('href') ?? '')) continue
    if (tag === 'br') {
      out.push({ type: 'text', text: ' ' })
      continue
    }
    const add: Mark | null =
      tag === 'i' || tag === 'em' || tag === 'cite'
        ? { type: 'italic' }
        : tag === 'b' || tag === 'strong'
          ? { type: 'bold' }
          : null
    inline(el, add && !marks.some((m) => m.type === add.type) ? [...marks, add] : marks, out)
  }
  return out
}

/** Merge adjacent runs with the same marks and trim the ends. */
function tidy(runs: Text[]): Text[] {
  const out: Text[] = []
  for (const r of runs) {
    const last = out.at(-1)
    if (last && JSON.stringify(last.marks ?? []) === JSON.stringify(r.marks ?? [])) last.text += r.text
    else out.push({ ...r })
  }
  if (out[0]) out[0].text = out[0].text.replace(/^\s+/, '')
  const end = out.at(-1)
  if (end) end.text = end.text.replace(/\s+$/, '')
  return out.filter((r) => r.text.length > 0)
}

const textOf = (el: HNode) => clean(decode(el.rawText ?? (el as HTMLElement).text ?? ''))

/** A heading's own text: page numbers, images and captions run into it are dropped. */
function headingText(el: HTMLElement) {
  let t = clean(
    tidy(inline(el))
      .map((r) => r.text)
      .join(''),
  )
  t = t.replace(/\{[^}]*\}/g, '').trim() // "{ix}" page markers
  const chapter = t.search(/\bCHAPTER\b/i)
  if (chapter > 0) t = t.slice(chapter) // an illustration's caption that ran into the heading
  return t
}

/** Table-of-contents lines: paragraphs that are (almost) all internal links. */
function isContentsLine(el: HTMLElement) {
  const all = textOf(el).length
  if (!all) return false
  const linked = el
    .querySelectorAll('a')
    .filter((a) => (a.getAttribute('href') ?? '').includes('#'))
    .reduce((n, a) => n + textOf(a).length, 0)
  return linked / all > 0.7
}

export function parseGutenbergHtml(html: string, idPrefix: string, bookTitle = ''): Chapter[] {
  const start = html.search(/\*\*\*\s*START OF (THE|THIS) PROJECT GUTENBERG[^*]*\*\*\*/i)
  const end = html.search(/\*\*\*\s*END OF (THE|THIS) PROJECT GUTENBERG/i)
  const body = html.slice(start >= 0 ? html.indexOf('***', start + 3) + 3 : 0, end >= 0 ? end : undefined)
  const root = parse(body, { blockTextElements: { script: false, style: false, pre: true } })

  // Which heading level marks chapters: h2 if the book has several, else h3.
  const h2 = root.querySelectorAll('h2').length
  const level = h2 >= 2 ? 'h2' : root.querySelectorAll('h3').length >= 2 ? 'h3' : 'h2'

  const chapters: { title: string; blocks: Block[] }[] = []
  let current: { title: string; blocks: Block[] } | null = null
  let n = 0
  const id = () => `${idPrefix}:${n++}`

  const paragraph = (el: HNode): Block | null => {
    const content = tidy(inline(el))
    const plain = content.map((c) => c.text).join('')
    if (!plain.trim() || TRADEMARK.test(plain)) return null
    return { type: 'paragraph', attrs: { id: id() }, content }
  }
  const verse = (el: HTMLElement): Block | null => {
    const lines = el.querySelectorAll('span, div.line, p').length
      ? el
          .querySelectorAll(
            'span.i0, span.i1, span.i2, span.i3, span.i4, span.i6, span.i8, span.i10, div.line, p, span',
          )
          .filter((s) => !s.querySelector('span'))
          .map((s) => textOf(s))
      : textOf(el).split(/\n/)
    const text = lines.filter(Boolean).join('\n')
    if (!text || TRADEMARK.test(text)) return null
    return { type: 'verse', attrs: { id: id() }, content: [{ type: 'text', text }] }
  }

  const walk = (node: HNode) => {
    for (const c of node.childNodes) {
      if (c.nodeType !== 1) continue
      const el = c as HTMLElement
      const tag = el.tagName?.toLowerCase()
      const cls = el.getAttribute('class') ?? ''
      if (tag === level) {
        let title = headingText(el)
        if (!title || SKIP_HEADING.test(title) || TRADEMARK.test(title)) {
          current = null // front matter: skip until the next real chapter
          continue
        }
        // a byline or a date ("by Lewis Carroll", "1729") opens the text, not a chapter: name it for the book
        if (/^by\s/i.test(title) || /^\d{3,4}\.?$/.test(title)) title = bookTitle || 'Opening'
        current = { title: title.length > 120 ? `${title.slice(0, 117)}…` : title, blocks: [] }
        chapters.push(current)
        continue
      }
      if (!current) {
        // headings and text before the first chapter are the title page and contents
        if (tag === 'div' || tag === 'section') walk(el)
        continue
      }
      if (tag === 'p') {
        if (isContentsLine(el)) continue
        // a plain-text contents list ("CHAPTER 1. Loomings.") before the first real chapter
        if (
          current.title === (bookTitle || 'Opening') &&
          /^(chapter|book|part)\s+[\dIVXLC]+\b/i.test(textOf(el)) &&
          textOf(el).length < 90
        )
          continue
        const b = paragraph(el)
        if (b) current.blocks.push(b)
      } else if (/\b(poem|stanza|poetry|verse)\b/.test(cls)) {
        const b = verse(el)
        if (b) current.blocks.push(b)
      } else if (tag === 'blockquote') {
        const inner = el
          .querySelectorAll('p')
          .map(paragraph)
          .filter((b): b is Block => !!b)
        const own = inner.length ? inner : [paragraph(el)].filter((b): b is Block => !!b)
        if (own.length) current.blocks.push({ type: 'blockquote', attrs: { id: id() }, content: own })
      } else if (tag === 'hr') {
        if (current.blocks.length && current.blocks.at(-1)!.type !== 'sceneBreak')
          current.blocks.push({ type: 'sceneBreak', attrs: { id: id() } })
      } else if (tag === 'h3' || tag === 'h4' || tag === 'h5') {
        // subheadings inside a chapter (e.g. "I.", dates) read as their own short paragraph
        const b = paragraph(el)
        if (b) current.blocks.push(b)
      } else if (tag === 'div' || tag === 'section' || tag === 'article') walk(el)
    }
  }
  walk(root)

  return (
    chapters
      .map((c) => {
        // no trailing scene break
        while (c.blocks.at(-1)?.type === 'sceneBreak') c.blocks.pop()
        return c
      })
      .filter((c) => c.blocks.some((b) => b.type !== 'sceneBreak'))
      // an opening that's only an edition note ("THE MILLENNIUM FULCRUM EDITION") isn't a chapter
      .filter(
        (c, _, all) =>
          all.length === 1 ||
          c.blocks.reduce((n, b) => n + JSON.stringify(b).split(/\s+/).length, 0) > 40 ||
          c.title !== (bookTitle || 'Opening'),
      )
      .map((c) => ({ title: c.title, doc: { type: 'doc' as const, content: c.blocks } }))
  )
}

/**
 * Open-access research articles from PubMed Central (JATS XML), turned into Morrow chapters (P-064).
 *
 * - Only CC BY and CC0 articles are accepted (`licenseOf`): the article's own <license> is the authority. NC, ND, SA
 *   and anything unrecognised are refused, so everything here may be redistributed with attribution.
 * - The abstract leads, as an "abstract" callout. Each top-level <sec> becomes a chapter (a short article stays one
 *   chapter); nested sections become headings. Paragraphs keep italics and bold; lists stay lists; simple tables stay
 *   tables; figures become their caption (images are not copied); inline references become citation notes, so the
 *   reader numbers them and lists them under References.
 * - Nothing else survives: the result is checked against the manuscript schema when it's stored.
 */
import { parse, type HTMLElement, type Node as HNode } from 'node-html-parser'
import type { Chapter } from './gutenberg.ts'

type Mark = { type: 'italic' | 'bold' | 'superscript' | 'subscript' }
type Inline =
  { type: 'text'; text: string; marks?: Mark[] } | { type: 'note'; attrs: { kind: 'citation'; text: string } }
type Block = { type: string; attrs?: Record<string, unknown>; content?: (Block | Inline)[] }

export interface Article {
  title: string
  authors: string[]
  journal: string
  year: number
  doi: string | null
  pmcid: string
  license: 'CC BY 4.0' | 'CC BY 3.0' | 'CC BY 2.0' | 'CC BY' | 'CC0'
  licenseUrl: string
  abstract: string
  chapters: Chapter[]
}

/** CC BY (any version) or CC0, from the article's own licence; null for anything else. */
export function licenseOf(xml: string): { name: Article['license']; url: string } | null {
  const block = xml.match(/<license[\s>][\s\S]*?<\/license>/)?.[0] ?? ''
  const url =
    block.match(
      /(?:xlink:href|ali:license_ref[^>]*>)\s*=?\s*"?\s*(https?:\/\/creativecommons\.org\/[^"<\s]+)/i,
    )?.[1] ??
    block.match(/https?:\/\/creativecommons\.org\/[^"<\s)]+/i)?.[0] ??
    ''
  if (/\/publicdomain\/zero\//i.test(url)) return { name: 'CC0', url }
  const by = url.match(/\/licenses\/by\/(\d\.\d)/i)
  if (by) return { name: `CC BY ${by[1]}` as Article['license'], url }
  if (/\/licenses\/by\/?$/i.test(url)) return { name: 'CC BY', url }
  return null // by-nc, by-nd, by-sa, or no recognisable licence
}

/** node-html-parser doesn't know XML's self-closing tags: open and close them explicitly first. */
const expandSelfClosing = (xml: string) =>
  xml.replace(/<([A-Za-z][\w:.-]*)((?:\s[^<>]*?)?)\/>/g, '<$1$2></$1>')

const clean = (s: string) => s.replace(/\s+/g, ' ').trim()
const decode = (s: string) =>
  s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, '’')
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&amp;/g, '&')
const tagOf = (n: HNode) => ((n as HTMLElement).rawTagName ?? '').toLowerCase()
const kids = (el: HTMLElement) => el.childNodes.filter((c) => c.nodeType === 1) as HTMLElement[]
const child = (el: HTMLElement | null | undefined, tag: string) =>
  el ? kids(el).find((c) => tagOf(c) === tag) : undefined
const textOf = (el: HNode | null | undefined) => (el ? clean(decode(el.rawText ?? '')) : '')

/**
 * A reference, as one readable line. mixed-citation carries its own punctuation; element-citation has none, so its
 * parts are joined with spaces (names as "Surname G"). Database ids are dropped; a DOI becomes a link.
 */
function referenceText(ref: HTMLElement) {
  const cite = ref.querySelector('mixed-citation') ?? ref.querySelector('element-citation') ?? ref
  const parts: string[] = []
  const walk = (node: HNode) => {
    for (const c of node.childNodes) {
      if (c.nodeType === 3) {
        parts.push(decode(c.rawText))
        continue
      }
      if (c.nodeType !== 1) continue
      const el = c as HTMLElement
      const tag = tagOf(el)
      if (tag === 'pub-id' || tag === 'object-id') {
        if (el.getAttribute('pub-id-type') === 'doi') parts.push(` https://doi.org/${textOf(el)} `)
        continue
      }
      if (tag === 'label') continue
      if (tag === 'name' || tag === 'string-name') {
        const surname = textOf(child(el, 'surname'))
        const given = textOf(child(el, 'given-names'))
        parts.push(` ${surname}${given ? ` ${given}` : ''} `)
        continue
      }
      parts.push(' ')
      walk(el)
      parts.push(' ')
    }
  }
  walk(cite)
  return clean(parts.join(''))
    .replace(/\s+([,.;:)\]])/g, '$1')
    .replace(/([([])\s+/g, '$1')
}

export function parseJats(xmlRaw: string): Article | null {
  const license = licenseOf(xmlRaw)
  if (!license) return null
  const root = parse(expandSelfClosing(xmlRaw), { lowerCaseTagName: false, comment: false })
  const article = root.querySelector('article')
  if (!article) return null
  const meta = article.querySelector('article-meta')
  const title = textOf(meta?.querySelector('title-group')?.querySelector('article-title'))
  const authors = (meta?.querySelector('contrib-group')?.querySelectorAll('contrib') ?? [])
    .filter((c) => (c.getAttribute('contrib-type') ?? 'author') === 'author')
    .map((c) => {
      const name = c.querySelector('name')
      if (!name) return textOf(c.querySelector('collab'))
      return clean(`${textOf(child(name, 'given-names'))} ${textOf(child(name, 'surname'))}`)
    })
    .filter(Boolean)
  const journal = textOf(article.querySelector('journal-meta')?.querySelector('journal-title'))
  const year = Number(textOf(meta?.querySelector('pub-date')?.querySelector('year'))) || 0
  const ids = meta?.querySelectorAll('article-id') ?? []
  const idOf = (type: string) => textOf(ids.find((i) => i.getAttribute('pub-id-type') === type))
  const pmcid = idOf('pmcid') || idOf('pmc')
  const doi = idOf('doi') || null

  // references by id, for citation notes
  const refs = new Map<string, string>()
  for (const r of article.querySelectorAll('ref')) {
    const id = r.getAttribute('id')
    if (id) refs.set(id, referenceText(r))
  }

  let n = 0
  const id = () => `${pmcid}:${n++}`

  /** inline content: marks, citations; labels and formulas dropped */
  function inline(node: HTMLElement, marks: Mark[] = [], out: Inline[] = []): Inline[] {
    for (const c of node.childNodes) {
      if (c.nodeType === 3) {
        let text = decode(c.rawText).replace(/\s+/g, ' ')
        if (!text) continue
        // brackets and commas around citation numbers: the notes carry their own numbers
        const prev = out.at(-1)
        if (prev?.type === 'note') text = text.replace(/^\s*[\]),;–-]+/, '')
        if (text) out.push(marks.length ? { type: 'text', text, marks } : { type: 'text', text })
        continue
      }
      if (c.nodeType !== 1) continue
      const el = c as HTMLElement
      const tag = tagOf(el)
      if (tag === 'xref' && el.getAttribute('ref-type') === 'bibr') {
        const prev = out.at(-1)
        if (prev?.type === 'text') prev.text = prev.text.replace(/[[(]\s*$/, '').replace(/[,;]\s*$/, '')
        for (const rid of (el.getAttribute('rid') ?? '').split(/\s+/).filter(Boolean)) {
          const ref = refs.get(rid)
          if (ref) out.push({ type: 'note', attrs: { kind: 'citation', text: ref.slice(0, 1000) } })
        }
        continue
      }
      if (tag === 'xref' || tag === 'label' || tag === 'inline-graphic' || tag === 'fn') continue
      if (tag === 'inline-formula' || tag === 'disp-formula') {
        out.push({ type: 'text', text: '[equation]' })
        continue
      }
      const add: Mark | null =
        tag === 'italic'
          ? { type: 'italic' }
          : tag === 'bold'
            ? { type: 'bold' }
            : tag === 'sup'
              ? { type: 'superscript' }
              : tag === 'sub'
                ? { type: 'subscript' }
                : null
      inline(el, add && !marks.some((m) => m.type === add.type) ? [...marks, add] : marks, out)
    }
    return out
  }
  function tidy(runs: Inline[]): Inline[] {
    const out: Inline[] = []
    for (const r of runs) {
      const last = out.at(-1)
      if (
        r.type === 'text' &&
        last?.type === 'text' &&
        JSON.stringify(last.marks ?? []) === JSON.stringify(r.marks ?? [])
      )
        last.text += r.text
      else out.push(r.type === 'text' ? { ...r } : r)
    }
    const first = out[0]
    if (first?.type === 'text') first.text = first.text.replace(/^\s+/, '')
    const end = out.at(-1)
    if (end?.type === 'text') end.text = end.text.replace(/\s+$/, '')
    return out.filter((r) => r.type === 'note' || r.text.length > 0)
  }
  const paragraph = (el: HTMLElement, lead?: string): Block | null => {
    const content = tidy([
      ...(lead ? [{ type: 'text' as const, text: `${lead} `, marks: [{ type: 'bold' as const }] }] : []),
      ...inline(el),
    ])
    return content.some((c) => c.type === 'note' || c.text.trim())
      ? { type: 'paragraph', attrs: { id: id() }, content }
      : null
  }

  function list(el: HTMLElement): Block | null {
    const ordered = /order|alpha|roman/.test(el.getAttribute('list-type') ?? '')
    const items = kids(el)
      .filter((c) => tagOf(c) === 'list-item')
      .map((li) => {
        const paras = kids(li)
          .filter((c) => tagOf(c) === 'p')
          .map((p) => paragraph(p))
          .filter((b): b is Block => !!b)
        const body = paras.length ? paras : [paragraph(li)].filter((b): b is Block => !!b)
        return body.length ? ({ type: 'listItem', content: body } as Block) : null
      })
      .filter((b): b is Block => b !== null)
    return items.length ? { type: ordered ? 'orderedList' : 'bulletList', content: items } : null
  }

  /** Simple tables only (no merged cells): anything else is summarised by its caption. */
  function table(wrap: HTMLElement): Block[] {
    const caption = wrap.querySelector('caption')
    const label = textOf(child(wrap, 'label'))
    const lead = paragraph(caption ?? wrap, label || 'Table.')
    const t = wrap.querySelector('table')
    const rows = t?.querySelectorAll('tr') ?? []
    const span = (c: HTMLElement, a: string) => Number(c.getAttribute(a) ?? 1) > 1
    const merged = rows.some((r) =>
      r.querySelectorAll('td, th').some((c) => span(c, 'rowspan') || span(c, 'colspan')),
    )
    const width = rows[0]?.querySelectorAll('td, th').length ?? 0
    const out: Block[] = lead ? [lead] : []
    if (
      !t ||
      merged ||
      !rows.length ||
      rows.length > 60 ||
      rows.some((r) => r.querySelectorAll('td, th').length !== width)
    )
      return out
    out.push({
      type: 'table',
      content: rows.map((r, i) => ({
        type: 'tableRow',
        content: r.querySelectorAll('td, th').map((cell) => ({
          type: i === 0 || tagOf(cell) === 'th' ? 'tableHeader' : 'tableCell',
          attrs: { colspan: 1, rowspan: 1, colwidth: null },
          content: [paragraph(cell) ?? { type: 'paragraph', attrs: { id: id() } }],
        })),
      })),
    })
    return out
  }

  function blocks(el: HTMLElement, depth: number): Block[] {
    const out: Block[] = []
    for (const c of kids(el)) {
      const tag = tagOf(c)
      if (tag === 'title' || tag === 'label') continue
      if (tag === 'p') {
        // a paragraph can carry lists, figures and tables inline in JATS: take those out after its text
        const nested = kids(c).filter((k) => ['list', 'fig', 'table-wrap', 'disp-quote'].includes(tagOf(k)))
        for (const k of nested) k.remove()
        const b = paragraph(c)
        if (b) out.push(b)
        for (const k of nested)
          out.push(...blocks(parse(`<x>${k.toString()}</x>`).querySelector('x')!, depth))
      } else if (tag === 'sec') {
        if (/supplementary/.test(c.getAttribute('sec-type') ?? '')) continue // files we don't carry
        const t = textOf(child(c, 'title'))
        if (t)
          out.push({
            type: 'heading',
            attrs: { id: id(), level: Math.min(4, depth + 2) },
            content: [{ type: 'text', text: t }],
          })
        out.push(...blocks(c, depth + 1))
      } else if (tag === 'list') {
        const b = list(c)
        if (b) out.push(b)
      } else if (tag === 'fig') {
        const label = textOf(child(c, 'label')) || 'Figure.'
        const cap = c.querySelector('caption')
        const b = cap ? paragraph(cap, label) : null
        if (b) out.push({ type: 'blockquote', attrs: { id: id() }, content: [b] })
      } else if (tag === 'table-wrap') out.push(...table(c))
      else if (tag === 'disp-quote') {
        const inner = kids(c)
          .filter((k) => tagOf(k) === 'p')
          .map((p) => paragraph(p))
          .filter((b): b is Block => !!b)
        if (inner.length) out.push({ type: 'blockquote', attrs: { id: id() }, content: inner })
      } else if (tag === 'boxed-text' || tag === 'statement') out.push(...blocks(c, depth))
      else if (tag === 'disp-formula')
        out.push({ type: 'paragraph', attrs: { id: id() }, content: [{ type: 'text', text: '[equation]' }] })
    }
    return out
  }

  const abstractEl = meta?.querySelector('abstract')
  const abstractParas = abstractEl ? blocks(abstractEl, 1).filter((b) => b.type === 'paragraph') : []
  const abstract = abstractParas.length
    ? { type: 'callout', attrs: { id: id(), tone: 'abstract' }, content: abstractParas }
    : null

  const body = article.querySelector('body')
  const tops = body
    ? kids(body).filter((c) => tagOf(c) === 'sec' && !/supplementary/.test(c.getAttribute('sec-type') ?? ''))
    : []
  const words = textOf(body).split(/\s+/).length
  const chapters: Chapter[] = []
  if (body && (tops.length < 3 || words < 3000)) {
    // a short article reads best as one page
    chapters.push({
      title,
      doc: { type: 'doc', content: [...(abstract ? [abstract] : []), ...blocks(body, 0)] as never },
    })
  } else {
    // leading paragraphs before the first section join the first chapter
    const lead = body
      ? blocks(
          parse(
            `<x>${kids(body)
              .filter((c) => tagOf(c) !== 'sec')
              .map((c) => c.toString())
              .join('')}</x>`,
          ).querySelector('x')!,
          0,
        )
      : []
    tops.forEach((sec, i) => {
      const t = textOf(child(sec, 'title')) || `Section ${i + 1}`
      const content = [
        ...(i === 0 && abstract ? [abstract] : []),
        ...(i === 0 ? lead : []),
        ...blocks(sec, 0),
      ]
      if (content.length)
        chapters.push({
          title: t.length > 120 ? `${t.slice(0, 117)}…` : t,
          doc: { type: 'doc', content: content as never },
        })
    })
  }
  // figures and tables kept apart from the text (JATS <floats-group>) gather at the end, captions and simple tables
  const floats = article.querySelector('floats-group')
  if (floats && chapters.length) {
    const b = blocks(floats, 1)
    if (b.length)
      chapters.at(-1)!.doc.content.push(
        {
          type: 'heading',
          attrs: { id: id(), level: 2 },
          content: [{ type: 'text', text: 'Figures and tables' }],
        } as never,
        ...(b as never[]),
      )
  }
  // acknowledgements are part of the record
  const ack = article.querySelector('back')?.querySelector('ack')
  if (ack && chapters.length) {
    const b = blocks(ack, 1)
    if (b.length) {
      const last = chapters.at(-1)!
      last.doc.content.push(
        {
          type: 'heading',
          attrs: { id: id(), level: 2 },
          content: [{ type: 'text', text: 'Acknowledgements' }],
        } as never,
        ...(b as never[]),
      )
    }
  }

  return {
    title,
    authors,
    journal,
    year,
    doi,
    pmcid,
    license: license.name,
    licenseUrl: license.url,
    abstract: abstractParas
      .map((p) => (p.content ?? []).map((c) => ('text' in c ? c.text : '')).join(''))
      .join(' ')
      .slice(0, 600),
    chapters: chapters.filter((c) => c.doc.content.length),
  }
}

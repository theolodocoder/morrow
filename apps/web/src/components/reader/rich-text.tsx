import type { ReactNode } from 'react'
import { isSafeLinkUrl } from '@morrow/editor'

/**
 * Renders a stored manuscript document (Tiptap JSON) as React elements for readers.
 * Only nodes and marks in the manuscript schema are rendered; anything else is dropped, never passed through as HTML,
 * so published content cannot inject markup or script (PRD §9.3).
 */
interface Mark {
  type: string
  attrs?: Record<string, unknown>
}
interface Node {
  type: string
  text?: string
  marks?: Mark[]
  attrs?: Record<string, unknown>
  content?: Node[]
}

const isNode = (v: unknown): v is Node =>
  typeof v === 'object' && v !== null && typeof (v as Node).type === 'string'

function withMarks(text: string, marks: Mark[] = [], key: string): ReactNode {
  return marks.reduce<ReactNode>((child, m, i) => {
    const k = `${key}m${i}`
    switch (m.type) {
      case 'bold':
        return <strong key={k}>{child}</strong>
      case 'italic':
        return <em key={k}>{child}</em>
      case 'underline':
        return <u key={k}>{child}</u>
      case 'strike':
        return <s key={k}>{child}</s>
      case 'code':
        return <code key={k}>{child}</code>
      case 'highlight':
        return <mark key={k}>{child}</mark>
      case 'superscript':
        return <sup key={k}>{child}</sup>
      case 'subscript':
        return <sub key={k}>{child}</sub>
      case 'link': {
        const href = typeof m.attrs?.href === 'string' ? m.attrs.href : ''
        return isSafeLinkUrl(href) ? (
          <a key={k} href={href} rel="noopener noreferrer nofollow ugc">
            {child}
          </a>
        ) : (
          child
        )
      }
      default:
        return child
    }
  }, text)
}

/** Footnotes and citations, numbered in reading order as they're rendered. */
interface Notes {
  footnotes: string[]
  citations: string[]
}

const CALLOUT_LABEL: Record<string, string> = {
  note: 'Note',
  tip: 'Tip',
  warning: 'Warning',
  abstract: 'Abstract',
}

function children(node: Node, key: string, notes: Notes) {
  return (node.content ?? []).filter(isNode).map((c, i) => render(c, `${key}.${i}`, notes))
}

function cellsOf(row: Node, key: string, notes: Notes) {
  return (row.content ?? []).filter(isNode).map((cell, i) =>
    cell.type === 'tableHeader' ? (
      <th key={`${key}.${i}`} scope="col">
        {children(cell, `${key}.${i}`, notes)}
      </th>
    ) : (
      <td key={`${key}.${i}`}>{children(cell, `${key}.${i}`, notes)}</td>
    ),
  )
}

function render(node: Node, key: string, notes: Notes): ReactNode {
  switch (node.type) {
    case 'text':
      return typeof node.text === 'string' ? withMarks(node.text, node.marks, key) : null
    case 'note': {
      const text = typeof node.attrs?.text === 'string' ? node.attrs.text : ''
      if (node.attrs?.kind === 'citation') {
        notes.citations.push(text)
        const n = notes.citations.length
        return (
          <a
            key={key}
            href={`#ref-${n}`}
            id={`cite-${n}`}
            className="citation-ref"
            aria-label={`Reference ${n}`}
          >
            [{n}]
          </a>
        )
      }
      notes.footnotes.push(text)
      const n = notes.footnotes.length
      return (
        <sup key={key} className="footnote-ref">
          <a href={`#fn-${n}`} id={`fnref-${n}`} aria-label={`Footnote ${n}`}>
            {n}
          </a>
        </sup>
      )
    }
    case 'paragraph':
      // the block id lets readers comment on this paragraph (P-054)
      return (
        <p key={key} data-block={typeof node.attrs?.id === 'string' ? node.attrs.id : undefined}>
          {children(node, key, notes)}
        </p>
      )
    case 'heading':
      return node.attrs?.level === 4 ? (
        <h4 key={key}>{children(node, key, notes)}</h4>
      ) : node.attrs?.level === 3 ? (
        <h3 key={key}>{children(node, key, notes)}</h3>
      ) : (
        <h2 key={key}>{children(node, key, notes)}</h2>
      )
    case 'sceneBreak':
      return <div key={key} role="separator" className="scene-break" aria-label="Scene break" />
    case 'verse':
      return (
        <div key={key} className="verse">
          {children(node, key, notes)}
        </div>
      )
    case 'callout': {
      const tone = typeof node.attrs?.tone === 'string' ? node.attrs.tone : 'note'
      return (
        <aside key={key} className="callout" data-tone={tone} aria-label={CALLOUT_LABEL[tone] ?? 'Note'}>
          {tone === 'abstract' && <p className="callout-label">Abstract</p>}
          {children(node, key, notes)}
        </aside>
      )
    }
    case 'table': {
      const rows = (node.content ?? []).filter(isNode)
      const headed = rows[0]?.content?.every((c) => c.type === 'tableHeader')
      return (
        <div key={key} className="table-scroll">
          <table>
            {headed && (
              <thead>
                <tr>{cellsOf(rows[0]!, `${key}.h`, notes)}</tr>
              </thead>
            )}
            <tbody>
              {rows.slice(headed ? 1 : 0).map((r, i) => (
                <tr key={`${key}.${i}`}>{cellsOf(r, `${key}.${i}`, notes)}</tr>
              ))}
            </tbody>
          </table>
        </div>
      )
    }
    case 'taskList':
      return (
        <ul key={key} className="task-list">
          {children(node, key, notes)}
        </ul>
      )
    case 'taskItem':
      return (
        <li key={key} data-checked={node.attrs?.checked ? 'true' : 'false'}>
          <span aria-hidden="true" className="task-box" />
          <span className="sr-only">{node.attrs?.checked ? 'Done: ' : 'To do: '}</span>
          {children(node, key, notes)}
        </li>
      )
    case 'blockquote':
      return <blockquote key={key}>{children(node, key, notes)}</blockquote>
    case 'bulletList':
      return <ul key={key}>{children(node, key, notes)}</ul>
    case 'orderedList':
      return (
        <ol key={key} start={typeof node.attrs?.start === 'number' ? node.attrs.start : undefined}>
          {children(node, key, notes)}
        </ol>
      )
    case 'listItem':
      return <li key={key}>{children(node, key, notes)}</li>
    case 'codeBlock':
      return (
        <pre key={key}>
          <code>
            {(node.content ?? [])
              .map((c) => (isNode(c) && typeof c.text === 'string' ? c.text : ''))
              .join('')}
          </code>
        </pre>
      )
    case 'horizontalRule':
      return <hr key={key} />
    case 'hardBreak':
      return <br key={key} />
    default:
      return null
  }
}

/**
 * `form` is the work's category: it sets the typography (indented fiction paragraphs, spaced article paragraphs,
 * numbered paper sections, stanza spacing for poetry). See `.reading-body[data-form]` in globals.css. `dropCap` opens
 * the first paragraph with a drop cap (never on poetry), drawn by CSS so the first word still reads as one word.
 */
export function RichText({
  doc,
  className,
  form,
  dropCap,
}: {
  doc: unknown
  className?: string
  form?: string
  dropCap?: boolean
}) {
  const notes: Notes = { footnotes: [], citations: [] }
  const body = isNode(doc) ? children(doc, 'n', notes) : null
  return (
    <div className={className} data-form={form} data-dropcap={dropCap || undefined}>
      {body}
      {notes.footnotes.length > 0 && (
        <section aria-label="Footnotes" className="footnotes">
          <ol>
            {notes.footnotes.map((t, i) => (
              <li key={i} id={`fn-${i + 1}`}>
                {t}{' '}
                <a href={`#fnref-${i + 1}`} aria-label={`Back to footnote ${i + 1}`}>
                  ↩
                </a>
              </li>
            ))}
          </ol>
        </section>
      )}
      {notes.citations.length > 0 && (
        <section aria-labelledby="references-heading" className="references">
          <h2 id="references-heading">References</h2>
          <ol>
            {notes.citations.map((t, i) => (
              <li key={i} id={`ref-${i + 1}`}>
                {t}
              </li>
            ))}
          </ol>
        </section>
      )}
    </div>
  )
}

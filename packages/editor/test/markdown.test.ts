import { describe, expect, it } from 'vitest'
import { documentToMarkdown, workToMarkdown } from '../src/index.ts'

const t = (text: string, marks?: { type: string; attrs?: Record<string, unknown> }[]) => ({
  type: 'text',
  text,
  ...(marks ? { marks } : {}),
})

describe('markdown export', () => {
  it('converts the launch node and mark set', () => {
    const md = documentToMarkdown({
      type: 'doc',
      content: [
        { type: 'heading', attrs: { level: 2 }, content: [t('The shore')] },
        {
          type: 'paragraph',
          content: [
            t('She was '),
            t('very', [{ type: 'italic' }]),
            t(' '),
            t('tired', [{ type: 'bold' }]),
            t('. See '),
            t('this', [{ type: 'link', attrs: { href: 'https://example.com' } }]),
            t('.'),
          ],
        },
        { type: 'horizontalRule' },
        { type: 'blockquote', content: [{ type: 'paragraph', content: [t('A quote.')] }] },
        {
          type: 'bulletList',
          content: [
            { type: 'listItem', content: [{ type: 'paragraph', content: [t('One')] }] },
            { type: 'listItem', content: [{ type: 'paragraph', content: [t('Two')] }] },
          ],
        },
        {
          type: 'orderedList',
          content: [{ type: 'listItem', content: [{ type: 'paragraph', content: [t('First')] }] }],
        },
        { type: 'paragraph', content: [t('Line'), { type: 'hardBreak' }, t('break')] },
      ],
    })
    expect(md).toBe(
      [
        '## The shore',
        'She was *very* **tired**. See [this](https://example.com).',
        '* * *',
        '> A quote.',
        '- One\n- Two',
        '1. First',
        'Line  \nbreak',
      ].join('\n\n'),
    )
  })
  it('converts the v2 marks and code blocks (PRD FR-007)', () => {
    expect(
      documentToMarkdown({
        type: 'doc',
        content: [
          {
            type: 'paragraph',
            content: [
              t('gone', [{ type: 'strike' }]),
              t(' '),
              t('under', [{ type: 'underline' }]),
              t(' '),
              t('a*b', [{ type: 'code' }]),
            ],
          },
          { type: 'codeBlock', content: [t('const x = 1\nconst y = 2')] },
        ],
      }),
    ).toBe('~~gone~~ <u>under</u> `a*b`\n\n```\nconst x = 1\nconst y = 2\n```')
  })
  it('escapes Markdown syntax in prose so text stays text', () => {
    expect(
      documentToMarkdown({
        type: 'doc',
        content: [{ type: 'paragraph', content: [t('# not a heading, *not* bold, 1. not a list')] }],
      }),
    ).toBe('\\# not a heading, \\*not\\* bold, 1. not a list')
  })
  it('drops empty paragraphs and builds a whole work with chapter sections', () => {
    const md = workToMarkdown('The Salt Orchard', [
      {
        title: 'Low Tide',
        content: {
          type: 'doc',
          content: [
            { type: 'paragraph' },
            { type: 'heading', attrs: { level: 2 }, content: [t('Morning')] },
            { type: 'paragraph', content: [t('Salt.')] },
          ],
        },
      },
    ])
    expect(md).toBe('# The Salt Orchard\n\n## Low Tide\n\n### Morning\n\nSalt.\n')
  })
})

describe('Markdown for the forms of writing', () => {
  it('exports scene breaks, verse, callouts, tables, checklists, footnotes and references', async () => {
    const { documentToMarkdown } = await import('../src/markdown.ts')
    const md = documentToMarkdown({
      type: 'doc',
      content: [
        { type: 'sceneBreak' },
        { type: 'verse', content: [{ type: 'text', text: 'one\n  two' }] },
        {
          type: 'callout',
          attrs: { tone: 'tip' },
          content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Breathe.' }] }],
        },
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: 'Claim' },
            { type: 'note', attrs: { kind: 'citation', text: 'Source A' } },
            { type: 'note', attrs: { kind: 'footnote', text: 'Aside' } },
          ],
        },
        {
          type: 'taskList',
          content: [
            {
              type: 'taskItem',
              attrs: { checked: true },
              content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Done' }] }],
            },
          ],
        },
        {
          type: 'table',
          content: [
            {
              type: 'tableRow',
              content: [
                {
                  type: 'tableHeader',
                  content: [{ type: 'paragraph', content: [{ type: 'text', text: 'A' }] }],
                },
              ],
            },
            {
              type: 'tableRow',
              content: [
                {
                  type: 'tableCell',
                  content: [{ type: 'paragraph', content: [{ type: 'text', text: '1' }] }],
                },
              ],
            },
          ],
        },
      ],
    })
    expect(md).toBe(
      [
        '* * *',
        'one  \n&nbsp;&nbsp;two',
        '> **Tip:** Breathe.',
        'Claim[1][^1]',
        '- [x] Done',
        '| A |\n| --- |\n| 1 |',
        '[^1]: Aside',
        '**References**',
        '1. Source A',
      ].join('\n\n'),
    )
  })
})

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { stateFromJSON } from '@morrow/editor/server'
import { SAMPLE_JATS } from '../src/classics/articles.ts'
import { licenseOf, parseJats } from '../src/classics/jats.ts'
import { ensureLibrary, storeArticle } from '../src/classics/store.ts'
import { setup, signUp } from './setup.ts'

let ctx: Awaited<ReturnType<typeof setup>>
beforeAll(async () => {
  ctx = await setup('articles')
})
afterAll(async () => {
  await ctx.app.close()
  await ctx.db.pool.end()
})
const pub = (path: string) => ctx.app.inject({ method: 'GET', url: `/api/v1/public${path}` })
const withLicense = (href: string) =>
  SAMPLE_JATS.replace('https://creativecommons.org/licenses/by/4.0/', href)

describe('open-access articles (P-064)', () => {
  it('only CC BY and CC0 are accepted', () => {
    expect(licenseOf(SAMPLE_JATS)?.name).toBe('CC BY 4.0')
    expect(licenseOf(withLicense('https://creativecommons.org/publicdomain/zero/1.0/'))?.name).toBe('CC0')
    for (const refused of ['by-nc/4.0/', 'by-nd/4.0/', 'by-sa/4.0/', 'by-nc-nd/3.0/'])
      expect(parseJats(withLicense(`https://creativecommons.org/licenses/${refused}`))).toBeNull()
    expect(parseJats(SAMPLE_JATS.replace(/<permissions>[\s\S]*<\/permissions>/, ''))).toBeNull()
  })

  it('JATS → chapters: abstract callout, sections, lists, tables, captions, citations; supplements dropped', () => {
    const a = parseJats(SAMPLE_JATS)!
    expect(a).toMatchObject({
      title: 'How lighthouse keepers slept',
      authors: ['Abena Mensah', 'Erik Lindqvist'],
      journal: 'Journal of Quiet Studies',
      year: 2021,
      doi: '10.0000/quiet.0001',
      pmcid: 'PMC0000001',
    })
    // a short article reads as one page
    expect(a.chapters).toHaveLength(1)
    const blocks = a.chapters[0]!.doc.content as { type: string; attrs?: Record<string, unknown> }[]
    expect(blocks[0]).toMatchObject({ type: 'callout', attrs: { tone: 'abstract' } })
    const types = blocks.map((b) => b.type)
    expect(types).toEqual(
      expect.arrayContaining(['heading', 'paragraph', 'bulletList', 'table', 'blockquote']),
    )
    const json = JSON.stringify(a.chapters)
    expect(json).toContain('"kind":"citation"')
    expect(json).toContain('Hale J')
    expect(json).toContain('https://doi.org/10.0000/watch')
    expect(json).not.toContain('123') // database ids dropped from references
    expect(json).toContain('"text":"Light had to be tended every four hours "') // "[1]" brackets removed
    expect(json).not.toContain('"text":"]')
    expect(json).not.toContain('Data file S1')
    expect(json).toContain('Acknowledgements')
    expect(() => stateFromJSON(a.chapters[0]!.doc as never)).not.toThrow() // valid manuscript content
  })

  it('stored and shown with attribution; on the research shelf; out of the feed; never retold', async () => {
    await ensureLibrary(ctx.db.db)
    const w = await storeArticle(ctx.db.db, parseJats(SAMPLE_JATS)!, ['sleep'])
    const path = `${w.slug}-${w.publicId}`
    const page = (await pub(`/works/${path}`)).json() as {
      openAccess: { authors: string[]; license: string; url: string; changes: string } | null
      classic: unknown
      license: string
      category: string
    }
    expect(page.classic).toBeNull()
    expect(page).toMatchObject({ license: 'cc_by', category: 'research_paper' })
    expect(page.openAccess).toMatchObject({
      authors: ['Abena Mensah', 'Erik Lindqvist'],
      license: 'CC BY 4.0',
      url: 'https://doi.org/10.0000/quiet.0001',
    })
    expect(page.openAccess!.changes).toMatch(/figures omitted/)

    const discover = (await pub('/discover')).json() as {
      research: { title: string; author: { displayName: string }; openAccess?: { journal: string } }[]
      classics: { title: string }[]
    }
    expect(discover.research.map((r) => [r.title, r.author.displayName])).toContainEqual([
      'How lighthouse keepers slept',
      'Abena Mensah and Erik Lindqvist',
    ])
    expect(discover.research[0]!.openAccess?.journal).toBe('Journal of Quiet Studies')
    expect(discover.classics.map((c) => c.title)).not.toContain('How lighthouse keepers slept')
    const feed = (await pub('/feed?limit=30')).json() as { items: { title: string }[] }
    expect(feed.items.map((i) => i.title)).not.toContain('How lighthouse keepers slept')

    const ama = await signUp(ctx.app, 'Ama Reader')
    expect((await ama.call('POST', '/api/v1/works/retell', { publicPath: path })).statusCode).toBe(409)
  })
})

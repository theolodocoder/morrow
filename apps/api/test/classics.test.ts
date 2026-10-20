import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { parseGutenbergHtml } from '../src/classics/gutenberg.ts'
import { ensureLibrary, storeClassic } from '../src/classics/store.ts'
import { setup, signUp } from './setup.ts'

let ctx: Awaited<ReturnType<typeof setup>>
beforeAll(async () => {
  ctx = await setup('classics')
})
afterAll(async () => {
  await ctx.app.close()
  await ctx.db.pool.end()
})
const pub = (path: string) => ctx.app.inject({ method: 'GET', url: `/api/v1/public${path}` })

const FIXTURE = `<html><body>
<p>The Project Gutenberg eBook of A Small Book. This ebook is for the use of anyone anywhere.</p>
<div>*** START OF THE PROJECT GUTENBERG EBOOK A SMALL BOOK ***</div>
<h1>A Small Book</h1>
<h2>CONTENTS</h2><p><a href="#c1">Chapter I</a></p>
<div class="chapter"><h2>CHAPTER I. The Shore</h2>
<p>It was a <i>quiet</i> morning &mdash; the tide <b>out</b>.<a class="fnanchor" href="#fn1">[1]</a></p>
<hr/>
<blockquote><p>Said the gull: go home.</p></blockquote>
<div class="poem"><div class="stanza"><span class="i0">The sea is wide,<br/></span><span class="i2">the sea is deep.</span></div></div>
</div>
<div class="chapter"><h2>CHAPTER II. The Town</h2><p>They walked inland.</p>
<p>This paragraph mentions Project Gutenberg and must go.</p></div>
<div>*** END OF THE PROJECT GUTENBERG EBOOK A SMALL BOOK ***</div>
<p>Project Gutenberg licence text that must never appear.</p>
</body></html>`

describe('classics (P-063)', () => {
  it('Gutenberg HTML → chapters: front matter, licence and trademark gone; marks, quotes, verse, breaks kept', () => {
    const ch = parseGutenbergHtml(FIXTURE, 'fx')
    expect(ch.map((c) => c.title)).toEqual(['CHAPTER I. The Shore', 'CHAPTER II. The Town'])
    const json = JSON.stringify(ch)
    expect(json).not.toMatch(/gutenberg/i)
    expect(json).not.toContain('[1]')
    const first = ch[0]!.doc.content
    expect(first.map((b) => b.type)).toEqual(['paragraph', 'sceneBreak', 'blockquote', 'verse'])
    expect(JSON.stringify(first[0])).toContain('"marks":[{"type":"italic"}]')
    expect(JSON.stringify(first[3])).toContain('The sea is wide,\\nthe sea is deep.')
    expect(ch[1]!.doc.content).toHaveLength(1)
  })

  it('stored as a published work: credited to its author, on the shelf, out of the feed; anyone can retell it', async () => {
    await ensureLibrary(ctx.db.db)
    const w = await storeClassic(
      ctx.db.db,
      {
        gutenbergId: 999001,
        title: 'A Small Book',
        author: 'Anne Author',
        year: 1850,
        category: 'novel',
        tags: ['classic'],
        description: 'Small.',
      },
      parseGutenbergHtml(FIXTURE, 'fx'),
    )
    const path = `${w.slug}-${w.publicId}`
    const page = (await pub(`/works/${path}`)).json() as {
      classic: { author: string; year: number } | null
      chapters: { slug: string }[]
      license: string
    }
    expect(page).toMatchObject({ classic: { author: 'Anne Author', year: 1850 }, license: 'cc0' })
    const chapter = (await pub(`/works/${path}/chapters/${page.chapters[0]!.slug}`)).json() as {
      content: unknown
    }
    expect(JSON.stringify(chapter.content)).toContain('quiet')
    const discover = (await pub('/discover')).json() as {
      classics: { title: string; author: { displayName: string } }[]
      recent: { title: string }[]
    }
    expect(discover.classics.map((c) => [c.title, c.author.displayName])).toContainEqual([
      'A Small Book',
      'Anne Author',
    ])
    expect(discover.recent.map((c) => c.title)).not.toContain('A Small Book')
    const feed = (await pub('/feed?limit=30')).json() as { items: { title: string }[] }
    expect(feed.items.map((i) => i.title)).not.toContain('A Small Book')

    const ama = await signUp(ctx.app, 'Ama Retells')
    const r = await ama.call('POST', '/api/v1/works/retell', { publicPath: path })
    expect(r.statusCode).toBe(201)
    const mine = (await ama.call('GET', `/api/v1/works/${(r.json() as { id: string }).id}`)).json() as {
      title: string
      visibility: string
      myRole: string
    }
    expect(mine).toMatchObject({ title: 'A Small Book: a retelling', visibility: 'private', myRole: 'owner' })

    // someone's own writing can never be copied this way
    const bo = await signUp(ctx.app, 'Bo Writer')
    const own = (await bo.call('POST', '/api/v1/works', { title: 'Mine' })).json() as { id: string }
    const published = (
      await bo.call('POST', `/api/v1/works/${own.id}/publish`, { visibility: 'public' })
    ).json() as {
      publicPath: string
    }
    expect(
      (await ama.call('POST', '/api/v1/works/retell', { publicPath: published.publicPath })).statusCode,
    ).toBe(409)
  })
})

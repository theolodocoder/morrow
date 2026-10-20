import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import {
  accountRestrictions,
  documentProjections,
  moderationActions,
  profiles,
  staff,
  user,
  workMembers,
  works,
} from '@morrow/db'
import { processOutbox } from '../src/notifications.ts'
import { setup, signUp } from './setup.ts'

let ctx: Awaited<ReturnType<typeof setup>>
beforeAll(async () => {
  ctx = await setup('social')
})
afterAll(async () => {
  await ctx.app.close()
  await ctx.db.pool.end()
})

type User = Awaited<ReturnType<typeof signUp>>
type Item = {
  title: string
  excerpt: string
  publicPath: string
  likes: number
  views: number
  comments: number
  completed: boolean
  author: { displayName: string; username: string | null; avatar: unknown }
  collaborators: { displayName: string }[]
  collaboratorCount: number
  viewer: { liked: boolean; followingAuthor: boolean; isAuthor: boolean; bookmarked: boolean } | null
}
type FeedRes = { items: Item[]; nextCursor: string | null }
type Comments = {
  items: {
    id: string
    body: string
    removed: boolean
    byAuthor: boolean
    canDelete: boolean
    quote: string | null
    replies: { body: string; quote: string | null }[]
  }[]
  total: number
  canComment: boolean
}

const pub = (path: string, headers: Record<string, string> = {}) =>
  ctx.app.inject({ method: 'GET', url: `/api/v1/public${path}`, headers })
const feedOf = async (u: User | null, q = '') =>
  (u ? await u.call('GET', `/api/v1/public/feed${q}`) : await pub(`/feed${q}`)).json() as FeedRes

async function person(name: string) {
  const u = await signUp(ctx.app, name)
  await u.call('PUT', '/api/v1/me/profile', { onboarded: true })
  const username = ((await u.call('GET', '/api/v1/me/profile')).json() as { username: string }).username
  return Object.assign(u, { username })
}

/** A public work with real paragraphs in its first chapter. */
async function piece(
  owner: User,
  title: string,
  paragraphs: string[],
  category = 'short_story',
  ids = false,
) {
  const w = (await owner.call('POST', '/api/v1/works', { title, category })).json() as { id: string }
  const chapters = (
    (await owner.call('GET', `/api/v1/works/${w.id}/chapters`)).json() as {
      items: { documentId: string }[]
    }
  ).items
  const v = {
    documentId: chapters[0]!.documentId,
    workId: w.id,
    contentJson: {
      type: 'doc',
      content: paragraphs.map((text, i) => ({
        type: 'paragraph',
        ...(ids ? { attrs: { id: `b${i}` } } : {}),
        content: [{ type: 'text', text }],
      })),
    },
    plainText: paragraphs.join('\n'),
    wordCount: paragraphs.join(' ').split(/\s+/).length,
    sourceRevision: Date.now(),
  }
  await ctx.db.db
    .insert(documentProjections)
    .values(v)
    .onConflictDoUpdate({ target: documentProjections.documentId, set: v })
  const p = (await owner.call('POST', `/api/v1/works/${w.id}/publish`, { visibility: 'public' })).json() as {
    publicPath: string
  }
  return { id: w.id, publicPath: p.publicPath }
}

describe('the public feed (FR-020)', () => {
  it('a scrolling stream of findable pieces, newest first, with excerpts, people and filters', async () => {
    const ama = await person('Ama Feed')
    const tolu = await person('Tolu Feed')
    const a = await piece(ama, 'Feed Story One', ['The river kept its secrets.', 'Second line.'])
    const b = await piece(ama, 'Feed Poem Two', ['Salt on the tongue.'], 'poetry')
    await ctx.db.db
      .insert(workMembers)
      .values({ workId: b.id, userId: tolu.id, role: 'editor', grantedBy: ama.id })
    const hidden = await piece(ama, 'Feed Hidden', ['Nope.'])
    await ctx.db.db.update(works).set({ hiddenAt: new Date() }).where(eq(works.id, hidden.id))

    const all = await feedOf(null, '?limit=30')
    const titles = all.items.map((i) => i.title)
    expect(titles.indexOf('Feed Poem Two')).toBeLessThan(titles.indexOf('Feed Story One'))
    expect(titles).not.toContain('Feed Hidden')
    const one = all.items.find((i) => i.title === 'Feed Story One')!
    // The opening only: at most half of a short chapter.
    expect(one.excerpt).toBe('The river kept its secrets.')
    expect(one.author).toMatchObject({ displayName: 'Ama Feed', username: ama.username })
    expect(one.author.avatar).toMatchObject({ style: 'face' }) // everyone starts with a face
    expect(one.viewer).toBeNull() // signed out
    const poem = all.items.find((i) => i.title === 'Feed Poem Two')!
    expect(poem.collaborators.map((c) => c.displayName)).toEqual(['Tolu Feed'])
    expect(poem.collaboratorCount).toBe(1)

    const poetry = await feedOf(null, '?category=poetry&limit=30')
    expect(poetry.items.every((i) => i.title !== 'Feed Story One')).toBe(true)
    expect(poetry.items.map((i) => i.title)).toContain('Feed Poem Two')

    // Pages don't overlap and end.
    const first = await feedOf(null, '?limit=1')
    const second = await feedOf(null, `?limit=1&cursor=${first.nextCursor}`)
    expect(first.items[0]!.publicPath).not.toBe(second.items[0]!.publicPath)
    expect(a.publicPath).toBeTruthy()
  })

  it('following shows only followed authors; signed-in readers get their own state; blocked authors vanish', async () => {
    const writer = await person('Followed Writer')
    const other = await person('Other Writer')
    const reader = await person('Reader')
    const mine = await piece(writer, 'Followed Piece', ['Hello.'])
    await piece(other, 'Unfollowed Piece', ['Hi.'])
    await reader.call('PUT', '/api/v1/me/follows', { type: 'author', username: writer.username })
    await reader.call('PUT', `/api/v1/reading/${mine.publicPath}/like`)

    const following = await feedOf(reader, '?sort=following&limit=30')
    expect(following.items.map((i) => i.title)).toEqual(['Followed Piece'])
    expect(following.items[0]!.viewer).toMatchObject({ liked: true, followingAuthor: true, isAuthor: false })
    expect((await feedOf(null, '?sort=following')).items).toEqual([])

    await reader.call('PUT', '/api/v1/me/blocks', { username: other.username })
    expect((await feedOf(reader, '?limit=30')).items.map((i) => i.title)).not.toContain('Unfollowed Piece')
  })
})

describe('likes and views', () => {
  it('a like counts once, can be undone, and tells the writer once', async () => {
    const ama = await person('Ama Like')
    const fan = await person('Fan')
    const w = await piece(ama, 'Likeable', ['Words.'])
    const like = () => fan.call('PUT', `/api/v1/reading/${w.publicPath}/like`)
    expect((await like()).json()).toEqual({ liked: true, likes: 1 })
    expect((await like()).json()).toEqual({ liked: true, likes: 1 }) // idempotent
    expect((await fan.call('DELETE', `/api/v1/reading/${w.publicPath}/like`)).json()).toEqual({
      liked: false,
      likes: 0,
    })
    await like()
    await processOutbox(ctx.db.db)
    const inbox = (await ama.call('GET', '/api/v1/me/notifications')).json() as { items: { title: string }[] }
    expect(inbox.items.filter((n) => n.title === 'Fan liked “Likeable”')).toHaveLength(1)
    // Signed out can't like.
    expect(
      (
        await ctx.app.inject({
          method: 'PUT',
          url: `/api/v1/reading/${w.publicPath}/like`,
          headers: { origin: 'http://localhost:3000' },
        })
      ).statusCode,
    ).toBe(401)
  })

  it('views: one per reader per day; the author and crawlers don’t count', async () => {
    const ama = await person('Ama View')
    const w = await piece(ama, 'Viewed', ['Words.'])
    const view = (ua: string, ip = '203.0.113.7') =>
      ctx.app.inject({
        method: 'POST',
        url: `/api/v1/public/reading/${w.publicPath}/view`,
        headers: { 'user-agent': ua, 'x-forwarded-for': ip, origin: 'http://localhost:3000' },
      })
    await view('Mozilla/5.0 Reader')
    await view('Mozilla/5.0 Reader') // same reader, same day
    await view('Mozilla/5.0 Reader', '203.0.113.8') // someone else
    await view('Googlebot/2.1')
    await ama.call('POST', `/api/v1/public/reading/${w.publicPath}/view`)
    const page = (await pub(`/works/${w.publicPath}`)).json() as { views: number }
    expect(page.views).toBe(2)
  })
})

describe('reading is open to everyone (P-049)', () => {
  it('signed out and signed in both get the whole chapter; the feed shows only an opening', async () => {
    const ama = await person('Ama Wall')
    const paras = ['One.', 'Two.', 'Three.', 'Four.', 'Five.', 'SIX-SECRET.', 'Seven.', 'Eight.']
    const w = await piece(ama, 'Walled', paras)
    const page = (await pub(`/works/${w.publicPath}`)).json() as { chapters: { slug: string }[] }
    const url = `/works/${w.publicPath}/chapters/${page.chapters[0]!.slug}`
    const anon = await pub(url)
    expect((anon.json() as { content: { content: unknown[] } }).content.content).toHaveLength(8)
    expect(anon.body).toContain('SIX-SECRET')
    const reader = await person('Signed Reader')
    const full = await reader.call('GET', `/api/v1/public${url}`)
    expect(full.body).toContain('SIX-SECRET')
    // The feed's card is still just the opening.
    const card = (await feedOf(null, '?limit=30')).items.find((i) => i.title === 'Walled')!
    expect(card.excerpt).toBe('One. Two. Three.')
  })
})

describe('reader comments', () => {
  it('post, reply in one thread, delete; the writer is told and may tidy their own space', async () => {
    const ama = await person('Ama Comments')
    const bo = await person('Bo')
    const cy = await person('Cy')
    const w = await piece(ama, 'Discussed', ['Words.'])
    const post = (u: User, body: string, parentId?: string) =>
      u.call('POST', `/api/v1/reading/${w.publicPath}/comments`, { body, ...(parentId ? { parentId } : {}) })
    const first = (await post(bo, 'Loved the ending.')).json() as { id: string }
    const reply = (await post(cy, 'Me too!', first.id)).json() as { id: string }
    // Replying to a reply joins the same thread.
    await post(ama, 'Thank you both.', reply.id)
    await processOutbox(ctx.db.db)
    const amaInbox = (await ama.call('GET', '/api/v1/me/notifications')).json() as {
      items: { title: string }[]
    }
    expect(amaInbox.items.map((n) => n.title)).toContain('Bo commented on “Discussed”')
    const boInbox = (await bo.call('GET', '/api/v1/me/notifications')).json() as {
      items: { title: string }[]
    }
    expect(boInbox.items.map((n) => n.title)).toContain('Cy replied to your comment on “Discussed”')

    let list = (await pub(`/reading/${w.publicPath}/comments`)).json() as Comments
    expect(list.total).toBe(3)
    expect(list.canComment).toBe(false) // signed out
    expect(list.items).toHaveLength(1)
    expect(list.items[0]!.replies.map((r) => r.body)).toEqual(['Me too!', 'Thank you both.'])

    // Cy can't delete Bo's comment; Ama (the writer) can.
    expect((await cy.call('DELETE', `/api/v1/reader-comments/${first.id}`)).statusCode).toBe(403)
    expect((await ama.call('DELETE', `/api/v1/reader-comments/${first.id}`)).statusCode).toBe(204)
    list = (await bo.call('GET', `/api/v1/public/reading/${w.publicPath}/comments`)).json() as Comments
    expect(list.total).toBe(2)
    // Kept as a placeholder because people replied.
    expect(list.items[0]).toMatchObject({ removed: true, body: '' })
    expect(list.items[0]!.replies).toHaveLength(2)
    expect(list.canComment).toBe(true)
  })

  it('blocked and muted people can’t comment; spam is refused; reports reach moderation', async () => {
    const ama = await person('Ama Safety')
    const pest = await person('Pest')
    const muted = await person('Muted')
    const w = await piece(ama, 'Guarded', ['Words.'])
    const post = (u: User, body: string) =>
      u.call('POST', `/api/v1/reading/${w.publicPath}/comments`, { body })

    await ama.call('PUT', '/api/v1/me/blocks', { username: pest.username })
    expect((await post(pest, 'Hello there friend')).statusCode).toBe(403)

    const [act] = await ctx.db.db
      .insert(moderationActions)
      .values({
        moderatorId: ama.id,
        action: 'restrict_account',
        targetType: 'user',
        targetId: muted.id,
        reason: 'test',
      })
      .returning()
    await ctx.db.db
      .insert(accountRestrictions)
      .values({ userId: muted.id, kind: 'muted', reason: 'test', actionId: act!.id })
    expect((await post(muted, 'Can I still talk?')).statusCode).toBe(403)

    const reader = await person('Spam Reader')
    expect((await post(reader, 'Same words again and again')).statusCode).toBe(201)
    expect((await post(reader, 'Same words again and again')).statusCode).toBe(429)

    const c = (await pub(`/reading/${w.publicPath}/comments`)).json() as Comments
    const rep = await ama.call('POST', '/api/v1/reports', {
      target: { type: 'reader_comment', commentId: c.items[0]!.id },
      category: 'spam',
    })
    expect(rep.statusCode).toBe(201)
    const mod = await person('Mod')
    await ctx.db.db.insert(staff).values({ userId: mod.id, role: 'moderator' })
    await ctx.db.db.update(user).set({ twoFactorEnabled: true }).where(eq(user.id, mod.id))
    const { id } = rep.json() as { id: string }
    const res = await mod.call('POST', `/api/v1/moderation/reports/${id}/resolve`, {
      action: 'remove_comment',
      reason: 'Spam',
    })
    expect(res.statusCode).toBe(204)
    const after = (await pub(`/reading/${w.publicPath}/comments`)).json() as Comments
    expect(after.items).toHaveLength(0)
    expect(after.total).toBe(0)
  })
})

describe('badges (FR-025) and avatars (FR-002)', () => {
  it('publishing and finishing earn badges once; the profile shows them unless hidden', async () => {
    const ama = await person('Ama Badges')
    const w = await piece(ama, 'Badge Work', ['Words.'])
    await ama.call('PATCH', `/api/v1/works/${w.id}`, { completed: true })
    await processOutbox(ctx.db.db)
    await processOutbox(ctx.db.db) // a second run awards nothing new
    const mine = (await ama.call('GET', '/api/v1/me/badges')).json() as {
      items: { code: string; awardedAt: string | null }[]
    }
    const earned = mine.items.filter((b) => b.awardedAt).map((b) => b.code)
    expect(earned).toEqual(['first_chapter', 'the_finisher'])
    expect(mine.items.length).toBeGreaterThan(earned.length) // the rest are visible goals
    const inbox = (await ama.call('GET', '/api/v1/me/notifications')).json() as { items: { title: string }[] }
    expect(inbox.items.filter((n) => n.title.startsWith('You earned a badge'))).toHaveLength(2)

    const author = (await pub(`/authors/${ama.username}`)).json() as { badges: { code: string }[] | null }
    expect(author.badges?.map((b) => b.code)).toEqual(['first_chapter', 'the_finisher'])
    // The latest badge is worn on the avatar wherever the writer appears, with the count.
    const worn = (await pub(`/works/${w.publicPath}`)).json() as {
      author: { badge: { count: number } | null }
    }
    expect(worn.author.badge).toMatchObject({ count: 2 })
    await ama.call('PUT', '/api/v1/me/profile', { showBadges: false })
    const hidden = (await pub(`/works/${w.publicPath}`)).json() as { author: { badge: unknown } }
    expect(hidden.author.badge).toBeNull()
    expect(((await pub(`/authors/${ama.username}`)).json() as { badges: unknown }).badges).toBeNull()

    const page = (await pub(`/works/${w.publicPath}`)).json() as { completed: boolean }
    expect(page.completed).toBe(true)
  })

  it('people can build their avatar; invalid parts are refused; initials are a choice', async () => {
    const ama = await person('Ama Avatar')
    const face = {
      style: 'face',
      skin: 2,
      hair: 4,
      hairColor: 1,
      eyes: 0,
      mouth: 3,
      accessory: 1,
      background: 5,
    }
    expect((await ama.call('PUT', '/api/v1/me/profile', { avatar: face })).json()).toMatchObject({
      avatar: face,
    })
    expect((await ama.call('PUT', '/api/v1/me/profile', { avatar: { ...face, hair: 99 } })).statusCode).toBe(
      400,
    )
    expect(((await pub(`/authors/${ama.username}`)).json() as { avatar: unknown }).avatar).toEqual(face)
    await ama.call('PUT', '/api/v1/me/profile', { avatar: { style: 'initials', background: 2 } })
    const [p] = await ctx.db.db.select().from(profiles).where(eq(profiles.userId, ama.id))
    expect(p!.avatar).toEqual({ style: 'initials', background: 2 })
  })
})

describe('paragraph comments (P-054)', () => {
  it('a comment beside one paragraph: counted per block, threaded there, kept out of the work’s main list', async () => {
    const ama = await person('Ama Margins')
    const bo = await person('Bo Margins')
    const w = await piece(ama, 'Margins', ['One.', 'Two.', 'Three.'], 'short_story', true)
    const page = (await pub(`/works/${w.publicPath}`)).json() as { chapters: { slug: string }[] }
    const slug = page.chapters[0]!.slug
    const posted = await bo.call('POST', `/api/v1/reading/${w.publicPath}/comments`, {
      body: 'This line!',
      chapterSlug: slug,
      blockId: 'b1',
    })
    expect(posted.statusCode).toBe(201)
    const { id } = posted.json() as { id: string }
    // a reply stays with its paragraph
    await ama.call('POST', `/api/v1/reading/${w.publicPath}/comments`, { body: 'Thank you.', parentId: id })
    await bo.call('POST', `/api/v1/reading/${w.publicPath}/comments`, { body: 'Loved the whole thing.' })

    const counts = (await pub(`/reading/${w.publicPath}/chapters/${slug}/paragraph-comments`)).json() as {
      counts: Record<string, number>
    }
    expect(counts.counts).toEqual({ b1: 2 })
    const thread = (
      await pub(`/reading/${w.publicPath}/comments?chapter=${slug}&block=b1`)
    ).json() as Comments
    expect(thread.items.map((c) => c.body)).toEqual(['This line!'])
    expect(thread.items[0]!.replies.map((r) => r.body)).toEqual(['Thank you.'])
    const main = (await pub(`/reading/${w.publicPath}/comments`)).json() as Comments
    expect(main.items.map((c) => c.body)).toEqual(['Loved the whole thing.'])
    // an unknown chapter is a 404, not a silent empty list
    expect((await pub(`/reading/${w.publicPath}/comments?chapter=nope-zzzzzz&block=b1`)).statusCode).toBe(404)
  })
})

describe('chapter discussion', () => {
  // sign-up is rate limited, so the four tests share one writer and one reader
  let people: Promise<[Awaited<ReturnType<typeof person>>, Awaited<ReturnType<typeof person>>]> | undefined
  async function discussed() {
    people ??= Promise.all([person('Ama Chapter'), person('Bo Chapter')])
    const [ama, bo] = await people
    const w = await piece(ama, 'Chapter Talk', ['One.', 'Two is the line.', 'Three.'], 'short_story', true)
    const page = (await pub(`/works/${w.publicPath}`)).json() as { chapters: { slug: string }[] }
    const slug = page.chapters[0]!.slug
    const post = (body: Record<string, unknown>) =>
      bo.call('POST', `/api/v1/reading/${w.publicPath}/comments`, body)
    const list = async (q: string) => (await pub(`/reading/${w.publicPath}/comments${q}`)).json() as Comments
    return { w, slug, post, list }
  }

  it('a chapter comment shows in its chapter, not on the work page', async () => {
    const { w, slug, post, list } = await discussed()
    const r = await post({ body: 'Great chapter.', chapterSlug: slug })
    expect(r.statusCode).toBe(201)
    const chapter = await list(`?chapter=${slug}`)
    expect(chapter.items.map((c) => c.body)).toEqual(['Great chapter.'])
    expect(chapter.items[0]!.quote).toBeNull()
    expect((await list('')).items).toEqual([])
    // still counted toward the work's total
    expect((await ctx.db.db.select().from(works).where(eq(works.id, w.id)))[0]!.readerCommentCount).toBe(1)
  })

  it('paragraph comments appear in the chapter discussion quoting their line', async () => {
    const { slug, post, list } = await discussed()
    const id = (
      (await post({ body: 'This line!', chapterSlug: slug, blockId: 'b1' })).json() as { id: string }
    ).id
    await post({ body: 'Chapter-level.', chapterSlug: slug })
    const chapter = await list(`?chapter=${slug}`)
    expect(chapter.items.map((c) => [c.body, c.quote])).toEqual([
      ['Chapter-level.', null],
      ['This line!', 'Two is the line.'],
    ])
    // replies share the shape; they carry no quote of their own
    await post({ body: 'Agreed.', parentId: id })
    expect((await list(`?chapter=${slug}`)).items[1]!.replies[0]!.quote).toBeNull()
    // the paragraph's own thread is unchanged
    expect((await list(`?chapter=${slug}&block=b1`)).items.map((c) => c.body)).toEqual(['This line!'])
  })

  it('whole-work comments stay on the work page', async () => {
    const { slug, post, list } = await discussed()
    await post({ body: 'Loved the whole thing.' })
    await post({ body: 'Chapter one only.', chapterSlug: slug })
    expect((await list('')).items.map((c) => c.body)).toEqual(['Loved the whole thing.'])
    expect((await list(`?chapter=${slug}`)).items.map((c) => c.body)).toEqual(['Chapter one only.'])
  })

  it('the quote is null when the block is no longer in the published text', async () => {
    const { slug, post, list } = await discussed()
    await post({ body: 'Gone line.', chapterSlug: slug, blockId: 'ghost' })
    expect((await list(`?chapter=${slug}`)).items.map((c) => [c.body, c.quote])).toEqual([
      ['Gone line.', null],
    ])
  })
})

describe('"what if" reader polls (P-062)', () => {
  it('the writer asks; readers vote once (changeable); counts appear after voting; answers lock once voted', async () => {
    const ama = await person('Ama Polls')
    const bo = await person('Bo Polls')
    const cy = await person('Cy Polls')
    const w = await piece(ama, 'Crossroads', ['She stood at the fork.'])
    const page = (await pub(`/works/${w.publicPath}`)).json() as { chapters: { slug: string }[] }
    const slug = page.chapters[0]!.slug
    const chapterId = (
      (await ama.call('GET', `/api/v1/works/${w.id}/chapters`)).json() as { items: { id: string }[] }
    ).items[0]!.id
    const set = await ama.call('PUT', `/api/v1/chapters/${chapterId}/poll`, {
      question: 'Which way should she go?',
      options: ['Left, to the sea', 'Right, to the city'],
      closesInDays: 7,
    })
    expect(set.statusCode).toBe(200)
    // readers can't set polls
    expect(
      (await bo.call('PUT', `/api/v1/chapters/${chapterId}/poll`, { question: 'Mine?', options: ['a', 'b'] }))
        .statusCode,
    ).toBe(404)

    const before = (await pub(`/reading/${w.publicPath}/chapters/${slug}/poll`)).json() as {
      poll: { options: { votes: number | null }[] }
    }
    expect(before.poll.options.map((o) => o.votes)).toEqual([null, null]) // no herding before you vote
    const vote = (u: User, option: number) =>
      u.call('POST', `/api/v1/reading/${w.publicPath}/chapters/${slug}/poll/vote`, { option })
    await vote(bo, 0)
    await vote(cy, 1)
    const changed = (await vote(bo, 1)).json() as {
      myVote: number
      total: number
      options: { votes: number }[]
    }
    expect(changed).toMatchObject({ myVote: 1, total: 2 })
    expect(changed.options.map((o) => o.votes)).toEqual([0, 2])
    // with votes in, the answers can't change under people
    expect(
      (
        await ama.call('PUT', `/api/v1/chapters/${chapterId}/poll`, {
          question: 'Which way?',
          options: ['Up', 'Down'],
        })
      ).statusCode,
    ).toBe(409)
  })
})

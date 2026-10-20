import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test'
import { fileURLToPath } from 'node:url'

/**
 * Real screenshots of a lived-in Morrow (data from `pnpm --filter @morrow/api seed-demo`): twelve people in one
 * chapter at once, the feed, Discover, Insights, Activity, review, reading on a phone. Saved to docs/images/raw.
 */
const OUT = fileURLToPath(new URL('../../../docs/images/raw/', import.meta.url))
const PASSWORD = 'morrow demo password'
const TEAM = [
  'Ama',
  'Tolu',
  'Mei',
  'Kofi',
  'Priya',
  'Mateo',
  'Leila',
  'Jonas',
  'Ngozi',
  'Haruto',
  'Aroha',
  'Sofia',
]
const LINES = [
  'The well was older than the orchard. ',
  'Kwesi said nothing, which was how he argued. ',
  'The ferryman counted the coins twice. ',
  'Somewhere a gull laughed at the tide. ',
  'She had not cried at the funeral; she cried at the bread. ',
  'The lamp swung once, then held. ',
  'Every root remembered the sea. ',
  'The letters were tied with fishing line. ',
  'Nobody owned the lighthouse, so everyone did. ',
  'The salt tasted of their grandmother’s hands. ',
  'Morning came in sideways. ',
]

async function signIn(
  browser: Browser,
  first: string,
  viewport = { width: 1440, height: 900 },
  scale = 2,
  reducedMotion: 'reduce' | 'no-preference' = 'no-preference',
) {
  const ctx = await browser.newContext({
    viewport,
    deviceScaleFactor: scale,
    colorScheme: 'light',
    reducedMotion,
  })
  const p = await ctx.newPage()
  await p.goto('/sign-in')
  await expect(p.getByLabel('Email')).toBeEnabled()
  await p.getByLabel('Email').fill(`${first.toLowerCase()}@demo.morrow.test`)
  await p.getByLabel('Password').fill(PASSWORD)
  await p.getByRole('button', { name: 'Sign in' }).click()
  await expect(p).not.toHaveURL(/sign-in/)
  return { ctx, p }
}
const shot = (p: Page, name: string, full = false) => {
  console.warn(`  shot: ${name}`)
  return p.screenshot({ path: `${OUT}${name}.png`, fullPage: full })
}
const settle = (p: Page) => p.waitForLoadState('networkidle').catch(() => {})

test('capture', async ({ browser }) => {
  // Reduced motion keeps every remote caret's name label up (it fades after 2.5s otherwise): how the product
  // renders for people who prefer less motion, and what a still picture needs.
  const { ctx: amaCtx, p: ama } = await signIn(browser, 'Ama', undefined, 2, 'reduce')
  const works = (await (await ama.request.get('/api/v1/works')).json()) as {
    items: { id: string; title: string; publicPath: string }[]
  }
  const salt = works.items.find((w) => w.title === 'The Salt Orchard')!
  const chapters = (await (await ama.request.get(`/api/v1/works/${salt.id}/chapters`)).json()) as {
    items: { id: string; title: string }[]
  }
  const keeper = chapters.items.find((c) => c.title === 'What the Keeper Saw')!
  const chapterUrl = `/app/works/${salt.id}/edit/${keeper.id}`

  // --- Twelve people, one chapter ---
  const others: { ctx: BrowserContext; p: Page }[] = []
  for (const name of TEAM.slice(1)) others.push(await signIn(browser, name, { width: 1280, height: 800 }, 1))
  await ama.goto(chapterUrl)
  await expect(ama.getByRole('status').filter({ hasText: 'Saved' })).toBeVisible({ timeout: 30_000 })
  for (const o of others) await o.p.goto(chapterUrl)
  for (const o of others)
    await expect(o.p.getByRole('textbox', { name: /manuscript/ })).toBeVisible({ timeout: 30_000 })

  console.warn('  everyone is in')
  // Two collaborators leave comments on passages first, so the feedback panel has a conversation in it.
  for (const [i, o] of others.slice(0, 2).entries()) {
    const para = o.p
      .getByRole('textbox', { name: /manuscript/ })
      .locator('p')
      .nth(i + 1)
    await para.evaluate((el) => {
      const text = el.firstChild!
      const range = document.createRange()
      range.setStart(text, 0)
      range.setEnd(text, Math.min(42, text.textContent!.length))
      const sel = window.getSelection()!
      sel.removeAllRanges()
      sel.addRange(range)
    })
    await o.p.getByRole('button', { name: 'Comment', exact: true }).click()
    await o.p
      .getByLabel('Your comment')
      .fill(
        i === 0
          ? 'Could this be the moment Kwesi first sees the lamp? @ama'
          : 'Love this. Can we hear the sea here too?',
      )
    try {
      // the @mention suggestion opens over the form: choose the person first
      if (i === 0) await o.p.getByRole('option', { name: /Ama Owusu/ }).click()
      await o.p.getByRole('button', { name: 'Comment', exact: true }).last().click()
    } catch (e) {
      await o.p.screenshot({ path: `${OUT}debug-comment.png` })
      throw e
    }
    await o.p.getByRole('button', { name: /^Feedback/ }).click()
  }

  console.warn('  comments left')
  // Everyone who can edit puts their caret in a different paragraph and writes, at the same time.
  // The two who just commented stay in the chapter (their selection is still on the passage they quoted); eight
  // others write. Sofia is a reader: present, not typing.
  const writers = others.slice(2, 10)
  await Promise.all(
    writers.map(async (o, i) => {
      const paras = o.p.getByRole('textbox', { name: /manuscript/ }).locator('p')
      const n = await paras.count()
      // the start of a different paragraph each, so every caret is in view and every sentence reads cleanly; set as a
      // DOM selection, because a click on a commented passage opens its thread instead of placing the caret
      // skip the two paragraphs with comment threads on them (a caret inside a comment mark types backwards)
      const target = [0, 3, 4, 5, 6, 7, 8, 9, 10, 11][i]! % n
      await paras.nth(target).evaluate((el) => {
        ;(el.closest('[contenteditable="true"]') as HTMLElement).focus()
        const text = document.createTreeWalker(el, NodeFilter.SHOW_TEXT).nextNode()!
        const range = document.createRange()
        range.setStart(text, 0)
        range.collapse(true)
        const sel = window.getSelection()!
        sel.removeAllRanges()
        sel.addRange(range)
      })
      await o.p.waitForTimeout(150)
    }),
  )
  await ama.getByRole('button', { name: /^Feedback/ }).click()
  const typing = Promise.all(
    writers.map(async (o, i) => {
      for (const ch of LINES[i]!) {
        await o.p.keyboard.type(ch)
        await o.p.waitForTimeout(90 + (i % 4) * 25)
      }
    }),
  )
  await ama.waitForTimeout(2600) // mid-sentence for everyone: carets and name flags are all up
  await shot(ama, 'editor-live-12')
  await typing
  await ama.getByRole('button', { name: /^Feedback/ }).click()
  await ama.waitForTimeout(1200)
  await shot(ama, 'editor-live-quiet')
  for (const o of others) await o.ctx.close()

  // --- Around the product, as Ama ---
  await ama.goto('/')
  await settle(ama)
  await shot(ama, 'home')
  await ama.goto('/discover')
  await settle(ama)
  await shot(ama, 'discover')
  await shot(ama, 'discover-full', true)
  await ama.goto(`/works/${salt.publicPath}`)
  await settle(ama)
  await shot(ama, 'work')
  await ama.goto('/app/dashboard')
  await settle(ama)
  await shot(ama, 'insights')
  await ama.goto('/app/notifications')
  await settle(ama)
  await shot(ama, 'activity')
  await ama.goto(`/app/works/${salt.id}/proposals`)
  await settle(ama)
  await shot(ama, 'proposals')
  await ama.getByRole('link', { name: /The Night of the Second Tide/ }).click()
  await expect(ama).toHaveURL(/\/proposals\/[0-9a-f-]{36}/)
  await expect(ama.getByRole('complementary', { name: 'Proposal details' })).toBeVisible()
  await settle(ama)
  await ama.waitForTimeout(600)
  await shot(ama, 'proposal')
  await ama.goto('/app/library')
  await settle(ama)
  await shot(ama, 'you')
  await ama.goto('/classics')
  await settle(ama)
  await shot(ama, 'classics')
  await ama.goto('/research')
  await settle(ama)
  await shot(ama, 'research')
  await ama.goto(chapterUrl)
  await expect(ama.getByRole('status').filter({ hasText: 'Saved' })).toBeVisible({ timeout: 30_000 })
  await ama.getByRole('button', { name: 'Share' }).click()
  await ama.waitForTimeout(800)
  await shot(ama, 'share')
  await amaCtx.close()

  // --- On a phone ---
  const { ctx: phone, p: m } = await signIn(browser, 'Kofi', { width: 390, height: 844 }, 3)
  await m.goto('/')
  await settle(m)
  await shot(m, 'phone-home')
  const page = (await (await m.request.get(`/api/v1/public/works/${salt.publicPath}`)).json()) as {
    chapters: { slug: string }[]
  }
  await m.goto(`/works/${salt.publicPath}/read/${page.chapters[0]!.slug}`)
  await settle(m)
  await m.waitForTimeout(800)
  await shot(m, 'phone-reader')
  await m
    .getByRole('button', { name: /comments on this paragraph/ })
    .first()
    .click()
  await m.waitForTimeout(900)
  await shot(m, 'phone-paragraph-comments')
  await m.goto(`/works/${salt.publicPath}/read/${page.chapters.at(-1)!.slug}`)
  await settle(m)
  const poll = m.getByRole('region', { name: 'Who should keep the lighthouse?' })
  await poll.scrollIntoViewIfNeeded()
  await poll.getByRole('button', { name: /Kwesi/ }).click()
  await m.waitForTimeout(900)
  await m.evaluate(() => window.scrollBy(0, -120))
  await shot(m, 'phone-poll')
  await m.goto(chapterUrl)
  await expect(m.getByRole('textbox', { name: /manuscript/ })).toBeVisible({ timeout: 30_000 })
  await m
    .getByRole('textbox', { name: /manuscript/ })
    .locator('p')
    .nth(2)
    .click()
  await m.waitForTimeout(900)
  await shot(m, 'phone-editor')
  await phone.close()
})

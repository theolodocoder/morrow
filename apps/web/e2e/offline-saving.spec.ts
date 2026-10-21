import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test'

/**
 * Resilience R1: words written offline are kept on the device (IndexedDB), survive the tab closing, and reach the
 * server once back online. The save status says honestly where the words are.
 */
const password = 'correct horse battery staple'
const editor = (p: Page) => p.getByRole('textbox', { name: /manuscript/ })
// Exact: "Saved on this device" must not pass for "Saved".
const status = (p: Page, label: string, timeout = 10_000) =>
  expect(p.getByRole('status').filter({ hasText: new RegExp(`^${label}$`) })).toBeVisible({ timeout })

async function signUp(page: Page, name: string, email: string) {
  await page.getByLabel('Name').fill(name)
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password').fill(password)
  await page.getByRole('button', { name: 'Create account' }).click()
}

/** A fresh owner with a new work, on its first chapter, with one saved line. Returns the chapter URL. */
async function ownerWithChapter(page: Page, email: string, firstLine: string) {
  await page.goto('/sign-up')
  await signUp(page, 'Ama Owusu', email)
  await page.getByRole('button', { name: 'Skip for now' }).click()
  await page.getByRole('button', { name: 'New work' }).first().click()
  await page.getByLabel('Title').fill('The Salt Orchard')
  await page.getByRole('button', { name: 'Create' }).click()
  await expect(page).toHaveURL(/\/app\/works\/.+\/edit\/.+/)
  await status(page, 'Saved')
  await editor(page).click()
  await page.keyboard.type(firstLine)
  await status(page, 'Saved')
  return page.url()
}

async function signIn(browser: Browser, email: string): Promise<[BrowserContext, Page]> {
  const ctx = await browser.newContext()
  const p = await ctx.newPage()
  await p.goto('/sign-in')
  await p.getByLabel('Email').fill(email)
  await p.getByLabel('Password').fill(password)
  await p.getByRole('button', { name: 'Sign in' }).click()
  await expect(p).toHaveURL(/\/app\/library$/)
  return [ctx, p]
}

/** Paragraph text without remote caret labels. */
const paragraphs = (p: Page) =>
  editor(p).evaluate((root) =>
    [...root.querySelectorAll('p')].map((el) => {
      const copy = el.cloneNode(true) as HTMLElement
      copy.querySelectorAll('.collaboration-carets__caret').forEach((c) => c.remove())
      return copy.textContent
    }),
  )

async function typeNewParagraph(p: Page, text: string) {
  await editor(p).click()
  await p.keyboard.press('ControlOrMeta+End')
  await p.keyboard.press('Enter')
  await p.keyboard.type(text)
}

test('edits made offline survive closing the tab and sync when back online', async ({ browser }) => {
  const email = `ama-${crypto.randomUUID()}@example.test`
  const ctx = await browser.newContext()
  const page = await ctx.newPage()
  const url = await ownerWithChapter(page, email, 'The salt had come up through the roots again.')

  await ctx.setOffline(true)
  await typeNewParagraph(page, 'Written on the train with no signal.')
  await status(page, 'Saved on this device')
  // Close the whole browser, not just the tab: Chromium would otherwise still deliver the closed tab's unsent
  // WebSocket frames once back online, and the test couldn't tell the device copy apart from that.
  const device = await ctx.storageState({ indexedDB: true })
  await ctx.close()

  const ctx2 = await browser.newContext({ storageState: device })
  const again = await ctx2.newPage()
  await again.goto(url)
  await expect(editor(again)).toContainText('The salt had come up through the roots again.')
  await expect(editor(again)).toContainText('Written on the train with no signal.')
  await status(again, 'Saved')

  // Another device proves the offline line reached the server, not just this browser's storage.
  const [otherCtx, other] = await signIn(browser, email)
  await other.goto(url)
  await expect(editor(other)).toContainText('Written on the train with no signal.')
  await otherCtx.close()
  await ctx2.close()
})

test('two writers, one offline: both keep their words and converge', async ({ browser }) => {
  const aCtx = await browser.newContext()
  const a = await aCtx.newPage()
  const url = await ownerWithChapter(a, `ama-${crypto.randomUUID()}@example.test`, 'Base.')

  const guestEmail = `tolu-${crypto.randomUUID()}@example.test`
  await a.getByRole('button', { name: 'Share' }).click()
  await a.getByLabel('Invite by email').fill(guestEmail)
  await a.getByRole('button', { name: 'Create invitation' }).click()
  const link = await a.getByLabel('Invitation link').inputValue()
  await a.getByRole('button', { name: 'Done' }).click()
  const bCtx = await browser.newContext()
  const b = await bCtx.newPage()
  await b.goto(link)
  await b.getByRole('link', { name: 'Create an account to accept' }).click()
  await signUp(b, 'Tolu Ade', guestEmail)
  await b.getByRole('button', { name: 'Accept invitation' }).click()
  await status(b, 'Saved')

  await aCtx.setOffline(true)
  await typeNewParagraph(a, 'Offline words from Ama.')
  await status(a, 'Saved on this device')
  await typeNewParagraph(b, 'Online words from Tolu.')
  await status(b, 'Saved')
  await a.close()

  await aCtx.setOffline(false)
  const a2 = await aCtx.newPage()
  await a2.goto(url)
  for (const p of [a2, b]) {
    await expect(editor(p)).toContainText('Offline words from Ama.')
    await expect(editor(p)).toContainText('Online words from Tolu.')
  }
  await status(a2, 'Saved')
  await expect
    .poll(async () => JSON.stringify(await paragraphs(b)))
    .toBe(JSON.stringify(await paragraphs(a2)))
  await aCtx.close()
  await bCtx.close()
})

test('the save status is honest offline and recovers when back online', async ({ browser }) => {
  test.setTimeout(90_000)
  const ctx = await browser.newContext()
  const page = await ctx.newPage()
  await ownerWithChapter(page, `ama-${crypto.randomUUID()}@example.test`, 'First line.')
  // Remember every label the status ever shows, so a brief wrong one can't slip between assertions.
  await page.evaluate(() => {
    const seen: string[] = ((window as unknown as { __seen: string[] }).__seen = [])
    const record = () =>
      document.querySelectorAll('[role=status]').forEach((s) => seen.push(s.textContent ?? ''))
    new MutationObserver(record).observe(document.body, {
      subtree: true,
      childList: true,
      characterData: true,
    })
  })
  const seen = () => page.evaluate(() => (window as unknown as { __seen: string[] }).__seen.splice(0))

  // Offline and typing: never "Saving…" (nothing can reach the server), but saved on this device.
  await ctx.setOffline(true)
  await status(page, 'Offline')
  await typeNewParagraph(page, 'Typed while offline.')
  await status(page, 'Saved on this device')
  await page.waitForTimeout(2_500) // longer than the delay before "Saving…" appears
  await status(page, 'Saved on this device')
  expect(await seen()).not.toContain('Saving…')

  await ctx.setOffline(false)
  await status(page, 'Saved', 10_000)
  await seen()

  // Offline for a while without typing, then back: "Saved" again quickly, never stuck on "Reconnecting…".
  await ctx.setOffline(true)
  await status(page, 'Offline')
  await page.waitForTimeout(10_000)
  await ctx.setOffline(false)
  await status(page, 'Saved', 5_000)
  await ctx.close()
})

test('signing out clears this device’s copies of your documents', async ({ browser }) => {
  const ctx = await browser.newContext()
  const page = await ctx.newPage()
  await ownerWithChapter(page, `ama-${crypto.randomUUID()}@example.test`, 'Kept on the device.')
  const names = () =>
    page.evaluate(async () =>
      (await indexedDB.databases()).map((d) => d.name ?? '').filter((n) => n.startsWith('morrow:doc:')),
    )
  const before = await names()
  expect(before.length).toBeGreaterThan(0)
  const userId = before[0]!.split(':')[2]!

  await page.goto('/app/library')
  await page.getByRole('button', { name: 'Your account' }).click()
  await page.getByRole('menuitem', { name: 'Sign out' }).click()
  await expect(page).toHaveURL(/\/sign-in$/)
  await expect
    .poll(async () => (await names()).filter((n) => n.startsWith(`morrow:doc:${userId}:`)))
    .toEqual([])
  await ctx.close()
})

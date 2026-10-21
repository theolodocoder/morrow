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

/** Remembers every label the save status shows, so a brief wrong one can't slip between assertions. */
function recordStatus() {
  const seen: string[] = ((window as unknown as { __seen: string[] }).__seen = [])
  new MutationObserver(() =>
    document.querySelectorAll('[role=status]').forEach((s) => seen.push(s.textContent ?? '')),
  ).observe(document, { subtree: true, childList: true, characterData: true })
}
const seenLabels = (p: Page) => p.evaluate(() => (window as unknown as { __seen: string[] }).__seen.splice(0))

const deviceCopies = (p: Page) =>
  p.evaluate(async () =>
    (await indexedDB.databases()).map((d) => d.name ?? '').filter((n) => n.startsWith('morrow:doc:')),
  )

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
  // Hold the device's words on their way to the server: until the server has them, the label must not say "Saved".
  let release = () => {}
  await ctx2.routeWebSocket(/:4001/, (ws) => {
    const server = ws.connectToServer()
    const held: (string | Buffer)[] = []
    let holding = true
    ws.onMessage((m) => {
      if (holding && m.toString().includes('signal')) held.push(m)
      else server.send(m)
    })
    release = () => {
      holding = false
      held.splice(0).forEach((m) => server.send(m))
    }
  })
  const again = await ctx2.newPage()
  await again.addInitScript(recordStatus)
  await again.goto(url)
  await expect(editor(again)).toContainText('The salt had come up through the roots again.')
  await expect(editor(again)).toContainText('Written on the train with no signal.')
  await status(again, 'Saving…')
  await again.waitForTimeout(1_500)
  expect(await seenLabels(again)).not.toContain('Saved')
  release()
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
  await page.evaluate(recordStatus)
  const seen = () => seenLabels(page)

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
  const names = () => deviceCopies(page)
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

test('signing out never silently deletes writing the server hasn’t got', async ({ browser }) => {
  const ctx = await browser.newContext()
  const page = await ctx.newPage()
  await ownerWithChapter(page, `ama-${crypto.randomUUID()}@example.test`, 'Online line.')
  await ctx.setOffline(true)
  await typeNewParagraph(page, 'Only on this device.')
  await status(page, 'Saved on this device')
  const device = await ctx.storageState({ indexedDB: true })
  await ctx.close()

  // Back online, but only on a page without the editor: nothing syncs, so the words are still only here.
  const ctx2 = await browser.newContext({ storageState: device })
  const p = await ctx2.newPage()
  await p.goto('/app/library')
  const before = await deviceCopies(p)
  expect(before.length).toBeGreaterThan(0)
  const signOut = async () => {
    await p.getByRole('button', { name: 'Your account' }).click()
    await p.getByRole('menuitem', { name: 'Sign out' }).click()
  }
  const dialog = p.getByRole('dialog', { name: 'Some writing hasn’t reached Morrow yet' })

  await signOut()
  await expect(dialog).toBeVisible()
  await expect(dialog).toContainText('It’s saved on this device only.')
  await dialog.getByRole('button', { name: 'Stay signed in' }).click()
  await expect(dialog).toHaveCount(0)
  await expect(p).toHaveURL(/\/app\/library$/)
  expect(await deviceCopies(p)).toEqual(before)

  await signOut()
  await dialog.getByRole('button', { name: 'Sign out and delete it' }).click()
  await expect(p).toHaveURL(/\/sign-in$/)
  await expect.poll(() => deviceCopies(p)).toEqual([])
  await ctx2.close()
})

test('without IndexedDB, editing works as before and the tab asks before closing with unsent words', async ({
  browser,
}) => {
  const ctx = await browser.newContext()
  await ctx.addInitScript(() => {
    IDBFactory.prototype.open = () => {
      throw new DOMException('IndexedDB is disabled', 'SecurityError')
    }
  })
  const page = await ctx.newPage()
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  await ownerWithChapter(page, `ama-${crypto.randomUUID()}@example.test`, 'Typed without a device copy.')

  await ctx.setOffline(true)
  await typeNewParagraph(page, 'Unsent.')
  await status(page, 'Offline') // not "Saved on this device": nothing holds the words but this tab
  const asked = page.waitForEvent('dialog')
  await page.close({ runBeforeUnload: true })
  const d = await asked
  expect(d.type()).toBe('beforeunload')
  await d.dismiss()
  expect(errors).toEqual([])
  await ctx.close()
})

test('a view-only session keeps no copy on the device', async ({ browser }) => {
  const aCtx = await browser.newContext()
  const a = await aCtx.newPage()
  await ownerWithChapter(a, `ama-${crypto.randomUUID()}@example.test`, 'Read, not written.')
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
  expect((await deviceCopies(b)).length).toBe(1)

  await a.getByRole('button', { name: 'Share' }).click()
  await a.getByRole('button', { name: /Role for Tolu Ade/ }).click()
  await a.getByRole('option', { name: 'Reader' }).click()
  await a.getByRole('button', { name: 'Done' }).click()
  await status(b, 'View only')
  await expect.poll(() => deviceCopies(b)).toEqual([])
  await b.reload()
  await status(b, 'View only')
  await expect.poll(() => deviceCopies(b)).toEqual([])
  await aCtx.close()
  await bCtx.close()
})

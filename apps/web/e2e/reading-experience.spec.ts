import { expect, test, type Page } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'

/**
 * Published reading experience (docs/superpowers/specs/2026-10-20-published-reading-experience-design.md): a work
 * written by two people, with an alternate version, read as a book. Start → Keep reading → pick a path → the
 * chapter's discussion → resume to the paragraph.
 */
const password = 'correct horse battery staple'
const editor = (p: Page) => p.getByRole('textbox', { name: /manuscript/ })
const status = (p: Page, text: string) =>
  expect(p.getByRole('status').filter({ hasText: text })).toBeVisible({ timeout: 10_000 })
const axe = async (p: Page) =>
  (await new AxeBuilder({ page: p }).withTags(['wcag2a', 'wcag2aa', 'wcag22aa']).analyze()).violations

async function signUpOn(page: Page, name: string, email: string) {
  await page.getByLabel('Name').fill(name)
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password').fill(password)
  await page.getByRole('button', { name: 'Create account' }).click()
}

async function rename(p: Page, from: string, to: string) {
  await p.getByRole('button', { name: `Actions for ${from}` }).click()
  await p.getByRole('menuitem', { name: 'Edit details' }).click()
  await p.getByRole('dialog').getByLabel('Title').fill(to)
  await p.getByRole('dialog').getByRole('button', { name: 'Save' }).click()
  await expect(p.getByRole('link', { name: new RegExp(to) })).toBeVisible()
}

/**
 * The collab server has `text`: a fresh tab loads the chapter from the server, not from this tab's unsent edits. The
 * "Saved" indicator can't tell us, since it already shows from the previous save before new keystrokes go out.
 */
async function onServer(p: Page, text: string) {
  const fresh = await p.context().newPage()
  await fresh.goto(p.url())
  await expect(editor(fresh)).toContainText(text)
  await fresh.close()
}

/** The chapter's client code is live once the discussion knows whether the reader is signed in. */
const hydrated = (p: Page) => expect(p.getByRole('button', { name: 'Join the conversation…' })).toBeVisible()

test('a reader starts, keeps reading, picks a path, joins the discussion, and resumes', async ({
  browser,
}) => {
  test.setTimeout(180_000)
  const title = `The Salt Orchard ${crypto.randomUUID().slice(0, 6)}`
  const memberEmail = `tolu-${crypto.randomUUID()}@example.test`
  const readerEmail = `kofi-${crypto.randomUUID()}@example.test`

  // The reader already has an account; they read signed out first.
  const setupCtx = await browser.newContext()
  const setup = await setupCtx.newPage()
  await setup.goto('/sign-up')
  await signUpOn(setup, 'Kofi Mensah', readerEmail)
  await expect(setup).toHaveURL(/\/app\/onboarding$/)
  await setupCtx.close()

  // Owner: three named chapters.
  const ownerCtx = await browser.newContext()
  const owner = await ownerCtx.newPage()
  await owner.goto('/sign-up')
  await signUpOn(owner, 'Ama Owusu', `ama-${crypto.randomUUID()}@example.test`)
  await owner.getByRole('button', { name: 'Skip for now' }).click()
  await owner.getByRole('button', { name: 'New work' }).first().click()
  await owner.getByLabel('Title').fill(title)
  await owner.getByRole('button', { name: 'Create' }).click()
  await status(owner, 'Saved')
  await editor(owner).click()
  await owner.keyboard.type('The salt had come up through the roots again.')
  await onServer(owner, 'The salt had come up through the roots again.')
  for (const [n, text] of [
    [2, 'She stood at the gate for a long time.'],
    [3, 'Ama locked the gate behind her and took the coast road.'],
  ] as const) {
    await owner.getByRole('button', { name: 'New chapter' }).click()
    await expect(owner.getByRole('heading', { name: `Chapter ${n}`, level: 1 })).toBeVisible()
    await status(owner, 'Saved')
    await editor(owner).click()
    await owner.keyboard.type(text)
    await onServer(owner, text)
  }
  await rename(owner, 'Chapter 1', 'Salt')
  await rename(owner, 'Chapter 2', 'The Gate')
  await rename(owner, 'Chapter 3', 'The Coast Road')

  // Owner invites Tolu as an editor.
  await owner.getByRole('button', { name: 'Share' }).click()
  await owner.getByLabel('Invite by email').fill(memberEmail)
  await owner.getByRole('button', { name: 'Create invitation' }).click()
  const invite = await owner.getByLabel('Invitation link').inputValue()
  await owner.getByRole('button', { name: 'Done' }).click()

  // Tolu co-writes chapter 2 (well past the 20 recorded edits a co-writer credit needs).
  const memberCtx = await browser.newContext()
  const member = await memberCtx.newPage()
  await member.goto(invite)
  await member.getByRole('link', { name: 'Create an account to accept' }).click()
  await signUpOn(member, 'Tolu Ade', memberEmail)
  await member.getByRole('button', { name: 'Accept invitation' }).click()
  await expect(member).toHaveURL(/\/app\/works\/.+\/edit\/.+/)
  await member.getByRole('link', { name: /The Gate/ }).click()
  await expect(editor(member)).toContainText('She stood at the gate for a long time.')
  await status(member, 'Saved')
  await editor(member).click()
  await member.keyboard.press('End')
  await member.keyboard.press('Enter')
  const tolu = 'Tolu wrote the long walk home, past the rows the frost had taken.'
  await member.keyboard.type(tolu, { delay: 15 })
  await onServer(member, tolu)

  // Tolu branches where the story turns (chapter 3) and writes a long alternate chapter.
  await member.getByRole('button', { name: /Version: Main/ }).click()
  await member.getByRole('button', { name: /New branch from/ }).click()
  await member.getByLabel('Name').fill('If She Had Stayed')
  await member.getByLabel('What’s different here? (optional)').fill('What if Ama never leaves the orchard?')
  await member.getByRole('button', { name: 'Create branch' }).click()
  await expect(member.getByRole('button', { name: /Version: If She Had Stayed/ })).toBeVisible()
  await member.getByRole('link', { name: /The Coast Road/ }).click()
  await expect(editor(member)).toContainText('took the coast road')
  await status(member, 'Saved')
  await rename(member, 'The Coast Road', 'The Long Stay')
  await editor(member).click()
  await member.keyboard.press('ControlOrMeta+a')
  await member.keyboard.type('Ama stayed.')
  for (let i = 1; i <= 24; i++) {
    await member.keyboard.press('Enter')
    await member.keyboard.insertText(
      `Stay ${i}. The orchard kept her through another season of salt and slow rain, and every morning she ` +
        `walked the rows and counted what the frost had spared, then wrote the count on the wall of the shed.`,
    )
  }
  await onServer(member, 'Stay 24.')
  // Leaving a chapter's connection is what records an edit session (credits are built from them at publish):
  // chapter 2's when Tolu moved to the branch, the branch's chapter 3's now.
  await memberCtx.close()

  // Owner publishes the main story, then Tolu's version beside it from the publish dialog.
  await owner.getByRole('button', { name: 'Publish', exact: true }).click()
  const dialog = owner.getByRole('dialog')
  await dialog.getByText('Public', { exact: true }).click()
  await dialog.getByRole('button', { name: 'Continue' }).click()
  await dialog.getByRole('button', { name: 'Publish publicly' }).click()
  const link = await dialog.getByLabel('Public link').inputValue()
  const path = new URL(link).pathname
  const publicPath = path.split('/').pop()!
  const versions = dialog.getByRole('region', { name: 'Alternate versions' })
  await expect(versions.getByText('Differs from The Coast Road')).toBeVisible()
  await versions.getByRole('button', { name: 'Publish version' }).click()
  await expect(versions.getByText('Published · 1 chapter')).toBeVisible()
  await dialog.getByRole('button', { name: 'Done' }).click()
  await ownerCtx.close()

  // A signed-out reader: the front page.
  const readerCtx = await browser.newContext()
  const reader = await readerCtx.newPage()
  await reader.goto(path)
  await expect(reader.getByRole('heading', { name: title, level: 1 })).toBeVisible()
  const credits = reader.getByRole('region', { name: 'Written by' }).getByRole('listitem')
  await expect(credits.nth(0)).toContainText('Ama Owusu')
  await expect(credits.nth(0)).toContainText('Author')
  await expect(credits.nth(1)).toContainText('Tolu Ade')
  await expect(credits.nth(1)).toContainText('Co-writer · chapter 2')
  const contents = reader.getByRole('region', { name: 'Contents' }).locator('ol > li')
  await expect(contents).toHaveCount(3)
  await expect(contents.nth(1).getByRole('link', { name: /Also:/ })).toHaveText(
    '↳ Also: “If She Had Stayed”, Tolu Ade’s version from here',
  )
  await expect(
    reader.getByText('Read without an account. Sign in to keep your place on every device.'),
  ).toBeVisible()
  expect(await axe(reader)).toEqual([])

  // Start reading: the chapter opener.
  await reader.getByRole('link', { name: 'Start reading' }).click()
  await expect(reader.getByText('Chapter one', { exact: true })).toBeVisible()
  const chapter1 = new URL(reader.url()).pathname
  await expect(reader.getByRole('heading', { name: 'Salt', level: 1 })).toBeVisible()
  const dropCap = await reader
    .locator('.reading-body > p')
    .first()
    .evaluate((p) => {
      const s = getComputedStyle(p, '::first-letter') as CSSStyleDeclaration & { initialLetter?: string }
      return { initial: s.initialLetter ?? s.getPropertyValue('-webkit-initial-letter'), float: s.float }
    })
  expect(dropCap.initial === '3' || dropCap.float === 'left', JSON.stringify(dropCap)).toBe(true)
  await hydrated(reader)
  expect(await axe(reader)).toEqual([])

  // The end of chapter one: Up next with chapter two's opening line.
  await reader.getByRole('heading', { name: 'End of chapter one' }).scrollIntoViewIfNeeded()
  await expect(reader.getByText('Up next · Chapter two · 1 min')).toBeVisible()
  await expect(reader.getByRole('heading', { name: 'The Gate' })).toBeVisible()
  await expect(reader.getByText('“She stood at the gate for a long time.”')).toBeVisible()
  const keepReading = reader.getByRole('link', { name: 'Keep reading' })
  await expect(keepReading).toBeVisible()
  const chapter2 = (await keepReading.getAttribute('href'))!
  expect(await axe(reader)).toEqual([])

  // → turns the page.
  await reader.keyboard.press('ArrowRight')
  await expect(reader).toHaveURL(new RegExp(`${chapter2}$`))
  await expect(reader.getByText('Chapter two', { exact: true })).toBeVisible()
  await expect(reader.getByText('Ama Owusu, with Tolu Ade')).toBeVisible()
  await hydrated(reader)

  // The end of chapter two: the story splits.
  await reader.getByRole('heading', { name: 'End of chapter two' }).scrollIntoViewIfNeeded()
  const paths = reader.locator('section').filter({ hasText: 'The story splits here. Which way?' })
  await expect(paths.getByRole('heading', { name: 'The story splits here. Which way?' })).toBeVisible()
  const mainStory = paths.getByRole('link', { name: /Main story · Chapter three/ })
  await expect(mainStory).toContainText('The Coast Road')
  const mainChapter3 = (await mainStory.getAttribute('href'))!
  const alternate = paths.getByRole('link', { name: /If She Had Stayed/ })
  await expect(alternate).toContainText('Tolu Ade’s version · 1 chapter')
  await expect(alternate).toContainText('What if Ama never leaves the orchard?')
  expect(await axe(reader)).toEqual([])

  // Choosing Tolu's version opens it; ← goes back to the main story's chapter two.
  await alternate.click()
  await expect(reader.getByRole('heading', { name: 'The Long Stay', level: 1 })).toBeVisible()
  await expect(reader.getByText('Chapter three', { exact: true })).toBeVisible()
  const alternateUrl = new URL(reader.url()).pathname
  await hydrated(reader)
  await reader.keyboard.press('ArrowLeft')
  await expect(reader).toHaveURL(new RegExp(`${chapter2}$`))

  // The reader signs in from chapter two's discussion and comes straight back to it.
  await hydrated(reader)
  await reader.getByRole('button', { name: 'Join the conversation…' }).click()
  await reader.getByRole('link', { name: 'I have an account' }).click()
  await reader.getByLabel('Email').fill(readerEmail)
  await reader.getByLabel('Password').fill(password)
  await reader.getByRole('button', { name: 'Sign in' }).click()
  await expect(reader).toHaveURL(new RegExp(`${chapter2}$`))
  await expect(reader.getByRole('textbox', { name: 'Talk about chapter two' })).toBeVisible() // signed in

  // Resume: halfway through Tolu's long chapter, then open it again.
  await reader.goto(alternateUrl)
  await expect(reader.getByRole('textbox', { name: 'Talk about chapter three' })).toBeVisible()
  await reader.evaluate(() => {
    const body = document.querySelector('.reading-body')!
    window.scrollTo(0, (body.getBoundingClientRect().bottom + window.scrollY - window.innerHeight) / 2)
  })
  // the paragraph saved for this chapter, once it is the one on screen
  let blockId: string | null = null
  await expect
    .poll(
      async () =>
        (blockId = await reader.evaluate(
          ([key, slug]) => {
            type Saved = { items?: { chapterSlug: string; blockId: string | null; percent: number }[] }
            const items = (JSON.parse(localStorage.getItem(key) ?? '{}') as Saved).items ?? []
            const here = items.find((p) => p.chapterSlug === slug)
            if (!here?.blockId || here.percent < 30 || here.percent > 70) return null
            const r = document
              .querySelector(`[data-block="${CSS.escape(here.blockId)}"]`)
              ?.getBoundingClientRect()
            return r && r.bottom > 0 && r.top < window.innerHeight ? here.blockId : null
          },
          [`morrow:pos:${publicPath}`, alternateUrl.split('/').pop()!] as const,
        )),
      { timeout: 15_000 },
    )
    .not.toBeNull()
  // Opened afresh (a new tab), since a reload lets the browser restore the scroll position by itself.
  const again = await readerCtx.newPage()
  await again.goto(alternateUrl)
  await expect(again.locator(`[data-block="${blockId}"]`)).toBeInViewport()
  await again.goto(path)
  await expect(again.getByRole('link', { name: /^Continue · The Long Stay · \d+%$/ })).toBeVisible()

  // Each chapter's discussion holds its own comments only, and the work page's thread holds none of them. Every page
  // first shows the comment posted there (so its list has loaded) before the others are checked absent.
  const tag = crypto.randomUUID().slice(0, 6)
  const threads = [
    { url: chapter2, box: 'Talk about chapter two', text: `The gate scene stayed with me ${tag}.` },
    { url: chapter1, box: 'Talk about chapter one', text: `Salt in the roots, what a start ${tag}.` },
    { url: mainChapter3, box: 'Talk about chapter three', text: `The coast road broke my heart ${tag}.` },
    { url: alternateUrl, box: 'Talk about chapter three', text: `I am glad she stayed ${tag}.` },
    { url: path, box: 'Add a comment', text: `The whole book, in one word: salt ${tag}.` },
  ]
  for (const t of threads) {
    if (new URL(reader.url()).pathname !== t.url) await reader.goto(t.url)
    await reader.getByRole('textbox', { name: t.box }).fill(t.text)
    await reader.getByRole('button', { name: 'Post comment' }).click()
    await expect(reader.getByText(t.text)).toBeVisible()
  }
  for (const t of threads) {
    await reader.goto(t.url)
    await expect(reader.getByText(t.text)).toBeVisible()
    for (const other of threads) if (other !== t) await expect(reader.getByText(other.text)).toHaveCount(0)
  }

  await readerCtx.close()
})

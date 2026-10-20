import { expect, test, type Page } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'

/**
 * M1 acceptance journey (plans/development-sequence.md): a writer signs up, creates a private novel,
 * writes, closes the browser, signs in on another device, and finds every word plus a saved version.
 */
const password = 'correct horse battery staple'

async function signUp(page: Page, email: string) {
  await page.goto('/sign-up')
  await page.getByLabel('Name').fill('Ama Owusu')
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password').fill(password)
  await page.getByRole('button', { name: 'Create account' }).click()
  await expect(page).toHaveURL(/\/app\/onboarding$/)
  await page.getByRole('button', { name: 'Skip for now' }).click()
  await expect(page).toHaveURL(/\/app\/library$/)
}

const editor = (page: Page) => page.getByRole('textbox', { name: /manuscript/ })
const saved = (page: Page) => expect(page.getByRole('status').filter({ hasText: 'Saved' })).toBeVisible()

test('M1: write privately, never lose a word', async ({ browser }) => {
  const email = `writer-${crypto.randomUUID()}@example.test`
  const deviceA = await browser.newContext()
  const page = await deviceA.newPage()

  await signUp(page, email)
  await expect(page.getByText('Every work starts as a single line.')).toBeVisible()
  expect(
    (await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag22aa']).analyze()).violations,
  ).toEqual([])

  // Create a private novel → lands in Chapter 1.
  await page.getByRole('button', { name: 'New work' }).first().click()
  await page.getByLabel('Title').fill('The Salt Orchard')
  await page.getByRole('button', { name: 'Create' }).click()
  await expect(page).toHaveURL(/\/app\/works\/.+\/edit\/.+/)
  await saved(page)

  // Write.
  await editor(page).click()
  await page.keyboard.type('The salt had come up through the roots again that spring.')
  await page.keyboard.press('Enter')
  await page.keyboard.type('Ama walked the rows with her palms open.')
  await saved(page)

  // A second chapter.
  await page.getByRole('button', { name: 'New chapter' }).click()
  await expect(page.getByRole('heading', { name: 'Chapter 2', level: 1 })).toBeVisible()
  await saved(page)
  await editor(page).click()
  await page.keyboard.type('Low tide came early.')
  await saved(page)

  // Save a named version.
  await page.getByRole('button', { name: 'Versions' }).click()
  page.once('dialog', (d) => d.accept('First draft'))
  await page.getByRole('button', { name: 'Save version' }).click()
  await expect(page.getByRole('button', { name: /First draft/ })).toBeVisible()
  expect(
    (await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag22aa']).analyze()).violations,
  ).toEqual([])

  // Reload: still there, and exactly the paragraphs that were written (no stray empty blocks).
  await page.reload()
  await expect(editor(page)).toContainText('Low tide came early.')
  await expect(editor(page).locator('p')).toHaveCount(1)
  await page.getByRole('link', { name: /Chapter 1/ }).click()
  await expect(editor(page).locator('p')).toHaveCount(2)
  await deviceA.close() // "close the browser"

  // Another device: sign in fresh and find every word.
  const deviceB = await browser.newContext()
  const b = await deviceB.newPage()
  await b.goto('/sign-in')
  await b.getByLabel('Email').fill(email)
  await b.getByLabel('Password').fill(password)
  await b.getByRole('button', { name: 'Sign in' }).click()
  await expect(b).toHaveURL(/\/app\/library$/)
  await expect(b.getByText('The Salt Orchard')).toBeVisible()
  await expect(b.getByText('23 words')).toBeVisible() // 11 + 8 + 4, from server projections
  await b.getByText('The Salt Orchard').click()
  await expect(editor(b)).toContainText('The salt had come up through the roots again that spring.')
  await expect(editor(b)).toContainText('Ama walked the rows with her palms open.')
  await b.getByRole('link', { name: /Chapter 2/ }).click()
  await expect(editor(b)).toContainText('Low tide came early.')
  await b.getByRole('button', { name: 'Versions' }).click()
  await expect(b.getByRole('button', { name: /First draft/ })).toBeVisible()
  const workUrl = b.url()
  await deviceB.close()

  // Private means private: another account sees "not here", and signed-out visitors are sent to sign in.
  const stranger = await browser.newContext()
  const s = await stranger.newPage()
  await s.goto(workUrl)
  await expect(s).toHaveURL(/\/sign-in$/)
  await signUp(s, `stranger-${crypto.randomUUID()}@example.test`)
  await s.goto(workUrl)
  await expect(
    s.getByText('It doesn’t exist, it was unpublished, or you don’t have access to it.'),
  ).toBeVisible()
  await stranger.close()
})

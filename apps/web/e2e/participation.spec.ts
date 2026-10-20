import { expect, test, type Page } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'

/** M6 public participation: a stranger suggests an edit to what's published; the draft never reaches them. */
const editor = (p: Page) => p.getByRole('textbox', { name: /manuscript/ })
const saved = (p: Page) =>
  expect(p.getByRole('status').filter({ hasText: 'Saved' })).toBeVisible({ timeout: 10_000 })
const axe = async (p: Page) =>
  (await new AxeBuilder({ page: p }).withTags(['wcag2a', 'wcag2aa', 'wcag22aa']).analyze()).violations
async function signUp(p: Page, name: string, onboard: 'Continue' | 'Skip for now') {
  await p.goto('/sign-up')
  await p.getByLabel('Name').fill(name)
  await p.getByLabel('Email').fill(`${crypto.randomUUID()}@example.test`)
  await p.getByLabel('Password').fill('correct horse battery staple')
  await p.getByRole('button', { name: 'Create account' }).click()
  await p.getByRole('button', { name: onboard }).click()
}

test('A stranger suggests an edit from the published chapter; the writer accepts; drafts stay private', async ({
  browser,
}) => {
  test.setTimeout(90_000)
  const author = await (await browser.newContext()).newPage()
  await signUp(author, 'Ama Owusu', 'Continue')
  await author.getByRole('button', { name: 'New work' }).first().click()
  await author.getByLabel('Title').fill('The Salt Orchard')
  await author.getByRole('button', { name: 'Create' }).click()
  await saved(author)
  await editor(author).click()
  await author.keyboard.type('The salt had come up through the roots again.')
  await saved(author)
  await author.getByRole('button', { name: 'Publish', exact: true }).click()
  await author.getByRole('dialog').getByText('Public', { exact: true }).click()
  await author.getByRole('dialog').getByRole('button', { name: 'Continue' }).click()
  await author.getByRole('dialog').getByRole('button', { name: 'Publish publicly' }).click()
  const link = await author.getByRole('dialog').getByLabel('Public link').inputValue()
  await author.getByRole('dialog').getByRole('button', { name: 'Done' }).click()
  await author.getByRole('button', { name: 'More actions' }).click()
  await author.getByRole('menuitem', { name: 'Work settings' }).click()
  await author.getByRole('dialog').getByText('Anyone signed in', { exact: true }).click()
  await author.getByRole('button', { name: 'Save settings' }).click()
  await expect(author.getByRole('dialog')).toHaveCount(0)
  // Keep drafting after publishing: this must never reach the stranger.
  await editor(author).click()
  await author.keyboard.press('End')
  await author.keyboard.press('Enter')
  await author.keyboard.type('SECRET DRAFT LINE.')
  await saved(author)

  // A stranger reads, and suggests an edit.
  const stranger = await (await browser.newContext()).newPage()
  await signUp(stranger, 'Tolu Ade', 'Skip for now')
  await stranger.goto(link)
  // Contribute, on the work page: the way in for anyone who isn't part of the work (P-050).
  await stranger.getByRole('button', { name: 'Contribute' }).click()
  const sheet = stranger.getByRole('dialog', { name: /Help shape/ })
  await expect(sheet.getByRole('button', { name: /Ask to collaborate/ })).toBeEnabled()
  expect(await axe(stranger)).toEqual([])
  await sheet.getByRole('button', { name: /Suggest an edit/ }).click()
  await sheet.getByLabel('What are you suggesting?').fill('Name the roots')
  await sheet.getByRole('button', { name: 'Start editing' }).click()
  await expect(stranger.getByText('You’re editing a private copy of the published chapter.')).toBeVisible()
  await expect(editor(stranger)).toContainText('The salt had come up through the roots again.')
  await expect(editor(stranger)).not.toContainText('SECRET')
  await saved(stranger)
  await editor(stranger).getByText('The salt had come up through the roots again.').click({ clickCount: 3 })
  await expect(editor(stranger)).toBeFocused()
  await stranger.keyboard.type('The salt had come up through the olive roots again.')
  await saved(stranger)
  expect(await axe(stranger)).toEqual([])
  await stranger.getByRole('button', { name: 'Submit for review' }).click()
  await expect(stranger.getByText('Submitted', { exact: true })).toBeVisible()
  await expect(stranger.locator('body')).not.toContainText('SECRET')

  // The writer reviews with the live comparison and accepts.
  const workId = /\/app\/works\/([^/]+)\//.exec(stranger.url())![1]!
  await author.goto(`/app/works/${workId}/proposals`)
  await author.getByRole('link', { name: /Name the roots/ }).click()
  // The writer added a paragraph right after the one Tolu rewrote: the classifier flags it (conservatively), shows
  // both side by side, and the writer explicitly chooses Tolu's wording there.
  await expect(author.getByText('Overlaps with newer changes')).toBeVisible()
  await author.getByRole('button', { name: 'Accept using their wording…' }).click()
  await author.getByRole('button', { name: 'Accept', exact: true }).click()
  await expect(author.getByText('Accepted', { exact: true })).toBeVisible()
  await author.goto(`/app/works/${workId}`)
  await expect(editor(author)).toContainText('The salt had come up through the olive roots again.')
  await expect(editor(author)).toContainText('SECRET DRAFT LINE.') // the writer's own draft, untouched

  // The stranger sees the outcome.
  await stranger.goto('/app/suggestions')
  await expect(stranger.getByRole('link', { name: /Name the roots/ })).toContainText('Accepted')
})

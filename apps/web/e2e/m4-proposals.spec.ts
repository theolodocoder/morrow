import { expect, test, type Page } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'

/**
 * M4 / PRD Journey C: a contributor proposes an edit in a private copy; meanwhile the owner keeps writing elsewhere
 * in the chapter; the owner reviews the difference and accepts; both changes are in the chapter, and nothing
 * changed before acceptance.
 */
const password = 'correct horse battery staple'
const editor = (p: Page) => p.getByRole('textbox', { name: /manuscript/ })
const saved = (p: Page) =>
  expect(p.getByRole('status').filter({ hasText: 'Saved' })).toBeVisible({ timeout: 10_000 })
const axe = async (p: Page) =>
  (await new AxeBuilder({ page: p }).withTags(['wcag2a', 'wcag2aa', 'wcag22aa']).analyze()).violations

async function signUp(p: Page, name: string, email: string) {
  await p.getByLabel('Name').fill(name)
  await p.getByLabel('Email').fill(email)
  await p.getByLabel('Password').fill(password)
  await p.getByRole('button', { name: 'Create account' }).click()
}

test('M4: propose in a private copy, review the difference, accept, credit', async ({ browser }) => {
  const owner = await (await browser.newContext()).newPage()
  const guest = await (await browser.newContext()).newPage()
  const guestEmail = `tolu-${crypto.randomUUID()}@example.test`

  await owner.goto('/sign-up')
  await signUp(owner, 'Ama Owusu', `ama-${crypto.randomUUID()}@example.test`)
  await owner.getByRole('button', { name: 'Skip for now' }).click()
  await owner.getByRole('button', { name: 'New work' }).first().click()
  await owner.getByLabel('Title').fill('The Salt Orchard')
  await owner.getByRole('button', { name: 'Create' }).click()
  await saved(owner)
  await editor(owner).click()
  await owner.keyboard.type('The salt had come up through the roots again.')
  await owner.keyboard.press('Enter')
  await owner.keyboard.type('She did not look back.')
  await saved(owner)
  const workId = /\/app\/works\/([^/]+)\//.exec(owner.url())![1]!

  // Invite Tolu as a contributor: they propose, they don't write directly.
  await owner.getByRole('button', { name: 'Share' }).click()
  await owner.getByLabel('Invite by email').fill(guestEmail)
  await owner.getByRole('dialog').getByRole('button', { name: /Role/ }).click()
  await owner.getByRole('option', { name: /Contributor/ }).click()
  await owner.getByRole('button', { name: 'Create invitation' }).click()
  const link = await owner.getByLabel('Invitation link').inputValue()
  await owner.getByRole('button', { name: 'Done' }).click()

  await guest.goto(link)
  await guest.getByRole('link', { name: 'Create an account to accept' }).click()
  await signUp(guest, 'Tolu Ade', guestEmail)
  await guest.getByRole('button', { name: 'Accept invitation' }).click()
  await expect(guest).toHaveURL(/\/app\/works\/.+\/edit\/.+/)
  await expect(editor(guest)).toHaveAttribute('contenteditable', 'false')

  // Tolu proposes an edit and writes in the private copy.
  await guest.getByRole('button', { name: /Propose/ }).click()
  await guest.getByLabel('Title').fill('Let her look back')
  await guest.getByLabel('Why (optional)').fill('The ending lands harder if she does.')
  await guest.getByRole('button', { name: 'Start editing' }).click()
  await expect(guest).toHaveURL(/\/proposals\//)
  await expect(guest.getByText('You’re writing in a private copy of this chapter.')).toBeVisible()
  await saved(guest)
  // Triple-click selects just this paragraph's text; typing replaces it.
  await editor(guest).getByText('She did not look back.').click({ clickCount: 3 })
  await expect(editor(guest)).toBeFocused()
  await guest.keyboard.type('She looked back, once.')
  await expect(editor(guest)).toContainText('She looked back, once.')
  await saved(guest)
  expect(await axe(guest)).toEqual([])

  // Nothing has changed in the chapter yet. The owner keeps writing, in the other paragraph.
  await expect(editor(owner)).toContainText('She did not look back.')
  await editor(owner).getByText('The salt had come up through the roots again.').click()
  await expect(editor(owner)).toBeFocused()
  // under load the click's caret can arrive after the next key: wait until it's really in that paragraph
  await expect
    .poll(() => owner.evaluate(() => document.getSelection()?.anchorNode?.textContent ?? ''))
    .toContain('The salt had come up')
  await owner.keyboard.press('Home')
  await owner.keyboard.type('That spring, ')
  await saved(owner)

  await guest.getByRole('button', { name: 'Submit for review' }).click()
  await expect(guest.getByText('Submitted', { exact: true })).toBeVisible()

  // The owner reviews: the difference, word by word, and it applies cleanly.
  await owner.goto(`/app/works/${workId}/proposals`)
  await owner.getByRole('link', { name: /Let her look back/ }).click()
  await expect(owner.getByText('Applies cleanly.')).toBeVisible()
  await expect(owner.getByRole('region', { name: 'Changed' })).toContainText('looked back, once.')
  await expect(owner.getByText('In review', { exact: true })).toBeVisible()
  expect(await axe(owner)).toEqual([])
  await owner.getByLabel(/Note to Tolu Ade/).fill('Yes. Thank you.')
  await owner.getByRole('button', { name: 'Accept…' }).click()
  await owner.getByRole('button', { name: 'Accept', exact: true }).click()
  await expect(owner.getByText('Accepted', { exact: true })).toBeVisible()

  // Both changes are in the chapter.
  await owner.goto(`/app/works/${workId}`)
  await expect(editor(owner)).toContainText('That spring, The salt had come up through the roots again.')
  await expect(editor(owner)).toContainText('She looked back, once.')

  // Tolu sees the decision and the note.
  await guest.reload()
  await expect(guest.getByText('Accepted', { exact: true })).toBeVisible()
  await expect(guest.getByText('Yes. Thank you.')).toBeVisible()
})

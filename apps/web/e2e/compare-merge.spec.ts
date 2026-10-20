import { expect, test, type Page } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'

/**
 * PRD FR-018/019: compare a saved version with now; branch, write in both the branch and Main, compare chapter by
 * chapter, merge cleanly; then clash in the same paragraph, see the merge refused, update from Main, merge again.
 */
const editor = (p: Page) => p.getByRole('textbox', { name: /manuscript/ })
const saved = (p: Page) =>
  expect(p.getByRole('status').filter({ hasText: 'Saved' })).toBeVisible({ timeout: 10_000 })
const axe = async (p: Page) =>
  (await new AxeBuilder({ page: p }).withTags(['wcag2a', 'wcag2aa', 'wcag22aa']).analyze()).violations

/** Replace one paragraph's text: triple-click selects just that paragraph. */
async function rewrite(p: Page, current: string | RegExp, next: string) {
  await editor(p).getByText(current).click({ clickCount: 3 })
  await expect(editor(p)).toBeFocused()
  await p.keyboard.type(next)
  await expect(editor(p)).toContainText(next)
  await saved(p)
}
async function switchTo(p: Page, from: RegExp, to: RegExp) {
  await p.getByRole('button', { name: from }).click()
  await p.getByRole('button', { name: to }).click()
}

test('Compare a version with now; compare and merge a branch, including a conflict resolved by updating', async ({
  page,
}) => {
  await page.goto('/sign-up')
  await page.getByLabel('Name').fill('Ama Owusu')
  await page.getByLabel('Email').fill(`ama-${crypto.randomUUID()}@example.test`)
  await page.getByLabel('Password').fill('correct horse battery staple')
  await page.getByRole('button', { name: 'Create account' }).click()
  await page.getByRole('button', { name: 'Skip for now' }).click()
  await page.getByRole('button', { name: 'New work' }).first().click()
  await page.getByLabel('Title').fill('The Salt Orchard')
  await page.getByRole('button', { name: 'Create' }).click()
  await saved(page)
  await editor(page).click()
  await page.keyboard.type('The salt had come up through the roots again.')
  await page.keyboard.press('Enter')
  await page.keyboard.type('Ama walked the rows with her palms open.')
  await saved(page)

  // FR-019: save a named version, change the text, compare that version with now.
  await page.getByRole('button', { name: 'Versions' }).click()
  page.once('dialog', (d) => d.accept('Draft one'))
  await page.getByRole('button', { name: 'Save version' }).click()
  await rewrite(
    page,
    'The salt had come up through the roots again.',
    'That spring the salt came up through the roots.',
  )
  await page.getByRole('button', { name: /Draft one/ }).click()
  await expect(page.getByRole('button', { name: /Draft one/ })).toContainText('by Ama Owusu')
  await page.getByRole('button', { name: 'Compare with now' }).click()
  await expect(page.getByText(/1 changed \(from “Draft one” to “Now”\)/)).toBeVisible()
  await expect(page.getByRole('region', { name: 'Changed' })).toContainText('That spring')
  expect(await axe(page)).toEqual([])
  await page.getByRole('button', { name: 'Close' }).click()
  await page.getByRole('button', { name: 'Versions' }).click()

  // A branch: rewrite the second paragraph and add a chapter.
  await page.getByRole('button', { name: /Version: Main/ }).click()
  await page.getByRole('button', { name: /New branch from/ }).click()
  await page.getByLabel('Name').fill('The Lighthouse Ending')
  await page.getByRole('button', { name: 'Create branch' }).click()
  await expect(page.getByRole('button', { name: /Version: The Lighthouse Ending/ })).toBeVisible()
  await saved(page)
  await rewrite(page, 'Ama walked the rows with her palms open.', 'Ama ran to the lighthouse.')
  await page.getByRole('button', { name: 'New chapter' }).click()
  await expect(page.getByRole('heading', { name: 'Chapter 2', level: 1 })).toBeVisible()
  await saved(page)
  await editor(page).click()
  await page.keyboard.type('Years later, the light still turned.')
  await saved(page)

  // Meanwhile on Main, a different paragraph changes.
  await switchTo(page, /Version: The Lighthouse Ending/, /^Main/)
  await expect(page.getByRole('button', { name: /Version: Main/ })).toBeVisible()
  await saved(page)
  await rewrite(page, 'That spring the salt came up through the roots.', 'That spring, the salt rose.')

  // Compare the branch with Main, then merge.
  await switchTo(page, /Version: Main/, /The Lighthouse Ending/)
  await expect(page.getByRole('button', { name: /Version: The Lighthouse Ending/ })).toBeVisible()
  await page.getByRole('button', { name: 'More actions' }).click()
  await page.getByRole('menuitem', { name: 'Compare & merge…' }).click()
  await expect(page.getByRole('heading', { level: 1 })).toContainText('The Lighthouse Ending')
  const compareUrl = page.url()
  await expect(page.locator('summary', { hasText: 'Chapter 1' })).toContainText('Changed')
  await expect(page.locator('summary', { hasText: 'Chapter 2' })).toContainText('Only in this branch')
  expect(await axe(page)).toEqual([])
  await page.getByRole('button', { name: 'Merge into Main…' }).click()
  await page.getByRole('button', { name: 'Merge', exact: true }).click()
  await expect(page.getByText('Merged into Main')).toBeVisible()
  await page.getByRole('link', { name: 'Open Main' }).click()
  await expect(editor(page)).toContainText('That spring, the salt rose.') // Main's own edit kept
  await expect(editor(page)).toContainText('Ama ran to the lighthouse.') // the branch's edit merged in
  await expect(page.getByRole('link', { name: /Chapter 2/ })).toBeVisible() // the new chapter joined Main

  // A clash: both change the same paragraph. The merge is refused; updating from Main resolves it.
  await saved(page)
  await rewrite(page, 'Ama ran to the lighthouse.', 'Ama waited by the sea.')
  await page.goto(compareUrl)
  await page.getByRole('link', { name: 'back to the branch' }).click()
  await saved(page)
  await rewrite(page, 'Ama ran to the lighthouse.', 'Ama walked home in the dark.')
  await page.goto(compareUrl)
  await page.getByRole('button', { name: 'Merge into Main…' }).click()
  await page.getByRole('button', { name: 'Merge', exact: true }).click()
  await expect(page.getByText('Nothing was merged')).toBeVisible()
  await expect(page.getByRole('status').filter({ hasText: 'Conflict · 1 paragraph' })).toBeVisible()
  await page.getByRole('button', { name: 'Update from Main' }).click()
  await expect(
    page.getByText(/In 1 paragraph you both changed, the branch kept its own wording/),
  ).toBeVisible()
  await page.getByRole('button', { name: 'Merge into Main…' }).click()
  await page.getByRole('button', { name: 'Merge', exact: true }).click()
  await expect(page.getByText('Merged into Main')).toBeVisible()
  await page.getByRole('link', { name: 'Open Main' }).click()
  await expect(editor(page)).toContainText('Ama walked home in the dark.')
  await expect(editor(page)).not.toContainText('Ama waited by the sea.')
  await expect(editor(page)).toContainText('That spring, the salt rose.')
})

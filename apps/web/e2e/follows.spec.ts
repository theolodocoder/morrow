import { expect, test, type Page } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'

/** PRD FR-022: follow writers and works, bookmark, a reading list, and hearing about new releases. */
const password = 'correct horse battery staple'
const editor = (p: Page) => p.getByRole('textbox', { name: /manuscript/ })
const saved = (p: Page) =>
  expect(p.getByRole('status').filter({ hasText: 'Saved' })).toBeVisible({ timeout: 10_000 })
const axe = async (p: Page) =>
  (await new AxeBuilder({ page: p }).withTags(['wcag2a', 'wcag2aa', 'wcag22aa']).analyze()).violations

async function signUp(p: Page, name: string) {
  await p.goto('/sign-up')
  await p.getByLabel('Name').fill(name)
  await p.getByLabel('Email').fill(`${crypto.randomUUID()}@example.test`)
  await p.getByLabel('Password').fill(password)
  await p.getByRole('button', { name: 'Create account' }).click()
}

test('Follow and bookmark from public pages; the reading list; followers hear about a new release', async ({
  browser,
}) => {
  const author = await (await browser.newContext()).newPage()
  await signUp(author, 'Ama Owusu')
  await author.getByRole('button', { name: 'Continue' }).click() // keep the suggested username
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

  // Signed out, following asks you to sign in first.
  const visitor = await (await browser.newContext()).newPage()
  await visitor.goto(link)
  await visitor.getByRole('button', { name: 'More', exact: true }).click()
  await visitor.getByRole('menuitem', { name: 'Follow this work' }).click()
  await expect(visitor).toHaveURL(/\/sign-in\?next=%2Fworks%2F/)

  // A reader follows the work, bookmarks it, and follows the writer.
  const reader = await (await browser.newContext()).newPage()
  await signUp(reader, 'Bisi Reader')
  await reader.getByRole('button', { name: 'Skip for now' }).click()
  await expect(reader).toHaveURL(/\/app\/library/) // onboarding saved before we move on
  await reader.goto(link)
  // Following and reporting live in ⋯; save is in sight.
  await reader.getByRole('button', { name: 'More', exact: true }).click()
  await reader.getByRole('menuitem', { name: 'Follow this work' }).click()
  await expect(reader.getByText('You’ll hear when it’s updated')).toBeVisible()
  await reader.getByRole('button', { name: 'More', exact: true }).click()
  await expect(reader.getByRole('menuitem', { name: 'Unfollow this work' })).toBeVisible()
  await reader.keyboard.press('Escape')
  await reader.getByRole('button', { name: 'Save to your reading list' }).click()
  await expect(reader.getByRole('button', { name: 'Saved to your reading list' })).toBeVisible()
  expect(await axe(reader)).toEqual([])
  await reader.getByRole('link', { name: 'Ama Owusu' }).first().click()
  // The work page has a Follow-the-writer button too: be on the author's page before following from it.
  await expect(reader).toHaveURL(/\/authors\//)
  await reader.getByRole('button', { name: 'Follow Ama' }).click()
  await expect(reader.getByRole('button', { name: 'Following Ama' })).toBeVisible()
  await reader.reload()
  const stats = reader.locator('main dl').first()
  await expect(stats).toContainText(/follower\s*1/)
  await expect(stats).toContainText(/following\s*0/)

  await reader.goto('/app/reading')
  await expect(reader.getByRole('region', { name: 'Bookmarks' })).toContainText('The Salt Orchard')
  await expect(reader.getByRole('region', { name: 'Works you follow' })).toContainText('The Salt Orchard')
  await expect(reader.getByRole('region', { name: 'Writers you follow' })).toContainText('Ama Owusu')
  expect(await axe(reader)).toEqual([])

  // A new release reaches followers.
  await author.getByRole('button', { name: 'Published', exact: true }).click()
  await author.getByRole('dialog').getByRole('button', { name: 'Publish latest' }).click()
  await author.getByRole('dialog').getByRole('button', { name: 'Publish publicly' }).click()
  await expect
    .poll(
      async () => {
        await reader.goto('/app/notifications')
        await reader.waitForLoadState('networkidle')
        return reader.getByRole('button', { name: /Ama Owusu updated “The Salt Orchard”/ }).count()
      },
      { timeout: 15_000 },
    )
    .toBe(1)
  await reader.getByRole('button', { name: /Ama Owusu updated/ }).click()
  await expect(reader).toHaveURL(/\/works\/the-salt-orchard-/)
})

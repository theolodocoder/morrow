import { expect, test, type Page } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'

/** PRD FR-020/021: browse without an account; find public work by title or topic; link-only work stays out. */
const editor = (p: Page) => p.getByRole('textbox', { name: /manuscript/ })
const saved = (p: Page) =>
  expect(p.getByRole('status').filter({ hasText: 'Saved' })).toBeVisible({ timeout: 10_000 })
const axe = async (p: Page) =>
  (await new AxeBuilder({ page: p }).withTags(['wcag2a', 'wcag2aa', 'wcag22aa']).analyze()).violations

async function publish(p: Page, title: string, audience: 'Public' | 'Unlisted', tags = '') {
  await p.goto('/app/library')
  await p.getByRole('button', { name: 'New work' }).first().click()
  await p.getByLabel('Title').fill(title)
  await p.getByRole('button', { name: 'Create' }).click()
  await saved(p)
  await editor(p).click()
  await p.keyboard.type('A first line.')
  await saved(p)
  if (tags) {
    await p.getByRole('button', { name: 'More actions' }).click()
    await p.getByRole('menuitem', { name: 'Work settings' }).click()
    await p.getByLabel('Tags').fill(tags)
    await p.getByRole('button', { name: 'Save settings' }).click()
    await expect(p.getByRole('dialog')).toHaveCount(0)
  }
  await p.getByRole('button', { name: 'Publish', exact: true }).click()
  await p.getByRole('dialog').getByText(audience, { exact: true }).click()
  await p.getByRole('dialog').getByRole('button', { name: 'Continue' }).click()
  await p
    .getByRole('dialog')
    .getByRole('button', { name: audience === 'Public' ? 'Publish publicly' : 'Publish to link' })
    .click()
  await p.getByRole('dialog').getByRole('button', { name: 'Done' }).click()
}

test('Discover and search: public work is findable by title and topic; link-only work never is', async ({
  browser,
}) => {
  const word = `quince${crypto.randomUUID().slice(0, 6)}`
  const author = await (await browser.newContext()).newPage()
  await author.goto('/sign-up')
  await author.getByLabel('Name').fill('Ama Owusu')
  await author.getByLabel('Email').fill(`${crypto.randomUUID()}@example.test`)
  await author.getByLabel('Password').fill('correct horse battery staple')
  await author.getByRole('button', { name: 'Create account' }).click()
  await author.getByRole('button', { name: 'Skip for now' }).click()
  await publish(author, `The ${word} Orchard`, 'Public', `${word}topic, family`)
  await publish(author, `The Secret ${word} Garden`, 'Unlisted')

  // Signed out, home is the feed, and Discover is a click away: no account needed to read.
  const visitor = await (await browser.newContext()).newPage()
  await visitor.goto('/')
  await expect(visitor.getByRole('article', { name: `The ${word} Orchard` })).toBeVisible()
  await visitor.goto('/discover')
  await expect(visitor.getByRole('region', { name: 'Recently published' })).toContainText(
    `The ${word} Orchard`,
  )
  await expect(visitor.getByText(`The Secret ${word} Garden`)).toHaveCount(0)
  expect(await axe(visitor)).toEqual([])

  // A topic filter.
  await visitor.goto(`/discover?tag=${word}topic`)
  await expect(visitor.getByRole('region', { name: 'Recently published' })).toContainText(
    `The ${word} Orchard`,
  )

  // Search from the header.
  await visitor.getByRole('searchbox', { name: 'Search works and writers' }).first().fill(word)
  await visitor.keyboard.press('Enter')
  await expect(visitor).toHaveURL(new RegExp(`/search\\?q=${word}`))
  await expect(visitor.getByRole('region', { name: 'Works' })).toContainText(`The ${word} Orchard`)
  await expect(visitor.getByText(`The Secret ${word} Garden`)).toHaveCount(0)
  expect(await axe(visitor)).toEqual([])
  await visitor.getByRole('link', { name: new RegExp(`The ${word} Orchard`) }).click()
  await expect(visitor.getByRole('heading', { name: `The ${word} Orchard`, level: 1 })).toBeVisible()

  // An empty search says so, and points somewhere useful.
  await visitor.goto(`/search?q=${word}nothinghere`)
  await expect(visitor.getByText(`Nothing public matches “${word}nothinghere”.`)).toBeVisible()
  await expect(visitor.getByRole('link', { name: 'browse Discover' })).toBeVisible()
})

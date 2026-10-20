import { expect, test, type Page } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'

/** The writer's dashboard: profile at a glance, period stats, a chart with a table, top works, recent activity. */
const editor = (p: Page) => p.getByRole('textbox', { name: /manuscript/ })
const saved = (p: Page) =>
  expect(p.getByRole('status').filter({ hasText: 'Saved' })).toBeVisible({ timeout: 10_000 })
const axe = async (p: Page) =>
  (await new AxeBuilder({ page: p }).withTags(['wcag2a', 'wcag2aa', 'wcag22aa']).analyze()).violations

async function signUp(p: Page, name: string) {
  await p.goto('/sign-up')
  await p.getByLabel('Name').fill(name)
  await p.getByLabel('Email').fill(`${crypto.randomUUID()}@example.test`)
  await p.getByLabel('Password').fill('correct horse battery staple')
  await p.getByRole('button', { name: 'Create account' }).click()
  await p.getByRole('button', { name: 'Skip for now' }).click()
}

test('a writer sees who liked, commented and followed, and how the numbers moved', async ({ browser }) => {
  test.setTimeout(90_000)
  const title = `Harbour Notes ${crypto.randomUUID().slice(0, 6)}`
  const author = await (await browser.newContext()).newPage()
  await signUp(author, 'Ama Owusu')
  await author.getByRole('button', { name: 'New work' }).first().click()
  await author.getByLabel('Title').fill(title)
  await author.getByRole('button', { name: 'Create' }).click()
  await saved(author)
  await editor(author).click()
  await author.keyboard.type('The harbour at dawn.')
  await saved(author)
  await author.getByRole('button', { name: 'Publish', exact: true }).click()
  await author.getByRole('dialog').getByText('Public', { exact: true }).click()
  await author.getByRole('dialog').getByRole('button', { name: 'Continue' }).click()
  await author.getByRole('dialog').getByRole('button', { name: 'Publish publicly' }).click()
  const link = await author.getByRole('dialog').getByRole('textbox', { name: 'Public link' }).inputValue()
  await author.getByRole('dialog').getByRole('button', { name: 'Done' }).click()

  const reader = await (await browser.newContext()).newPage()
  await signUp(reader, 'Tolu Reader')
  await reader.goto(link)
  await reader.getByRole('button', { name: /^Like/ }).click()
  await expect(reader.getByRole('button', { name: /^Unlike/ })).toBeVisible()
  await reader.getByRole('button', { name: 'More', exact: true }).click()
  await reader.getByRole('menuitem', { name: /^Follow Ama/ }).click()
  await reader.getByRole('textbox', { name: 'Add a comment' }).fill('Dawn is my favourite too.')
  await reader.getByRole('button', { name: 'Post comment' }).click()
  await expect(reader.getByText('Dawn is my favourite too.')).toBeVisible()

  await author.goto('/app/library')
  await author.getByRole('link', { name: 'Insights' }).first().click()
  await expect(author.getByRole('heading', { name: 'Ama Owusu', level: 1 })).toBeVisible()
  const card = (label: string) => author.getByRole('listitem').filter({ hasText: label }).first()
  await expect(card('Likes')).toContainText('1')
  await expect(card('Comments')).toContainText('1')
  await expect(card('New followers')).toContainText('1')
  await expect(author.getByRole('table').first()).toContainText(title)
  const activity = author.getByRole('region', { name: 'Recent activity' })
  await expect(activity).toContainText(`Tolu Reader liked ${title}`)
  await expect(activity).toContainText('Dawn is my favourite too.')
  await expect(activity).toContainText('Tolu Reader started following you')
  await activity.getByRole('button', { name: 'Follow Tolu Reader back' }).click()
  await expect(activity.getByRole('button', { name: 'Following Tolu Reader' })).toBeVisible()

  // Other periods, and the chart's numbers as a table.
  await author.getByRole('link', { name: '7 days' }).click()
  await expect(author).toHaveURL(/days=7/)
  await author.getByRole('button', { name: 'Likes', exact: true }).click()
  await author.getByText('Show as a table').click()
  await expect(author.getByRole('table', { name: 'Likes by day' })).toBeVisible()
  expect(await axe(author)).toEqual([])
})

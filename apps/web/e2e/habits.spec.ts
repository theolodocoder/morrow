import { expect, test, type Page } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'

/**
 * The habit loops: the weekly prompt, a daily goal and streak while writing, a serial schedule and an open call, and
 * readers commenting on a single paragraph.
 */
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
  await expect(p).toHaveURL(/\/app\/library/)
}

test('prompt → write with a goal → schedule and open call → paragraph comments', async ({ browser }) => {
  test.setTimeout(120_000)
  const title = `Harbour Lights ${crypto.randomUUID().slice(0, 6)}`
  const author = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage()
  await signUp(author, 'Ama Owusu')

  // This week's prompt, beside the feed: write for it in one tap.
  await author.goto('/')
  const prompt = author
    .getByRole('complementary', { name: 'About Morrow' })
    .getByRole('region', { name: /./ })
    .first()
  await expect(prompt).toContainText('This week’s prompt')
  await prompt.getByRole('button', { name: 'Write for this prompt' }).click()
  const sheet = author.getByRole('dialog', { name: 'Begin a new work' })
  await expect(sheet).toContainText('For this week’s prompt')
  await sheet.getByLabel('Title').fill(title)
  await sheet.getByRole('button', { name: 'Create' }).click()

  // Writing: the ring counts my words; I set a goal.
  await saved(author)
  await editor(author).click()
  await author.keyboard.type('The lights came on one by one along the harbour wall.\n')
  await author.keyboard.type('Nobody had lit them in forty years.')
  await saved(author)
  const ring = author.getByRole('button', { name: /^Today: \d+ words/ })
  await expect(ring).toHaveAccessibleName(/Today: 1[5-9] words|Today: [2-9]\d words/)
  await ring.click()
  const goals = author.getByRole('dialog', { name: 'Your writing' })
  await goals.getByRole('button', { name: '250' }).click()
  await expect(goals.getByRole('button', { name: '250' })).toHaveAttribute('aria-pressed', 'true')
  await author.keyboard.press('Escape')

  // A serial schedule and an open call, from Work settings; then publish.
  await author.getByRole('button', { name: 'More actions' }).click()
  await author.getByRole('menuitem', { name: 'Work settings' }).click()
  const settings = author.getByRole('dialog', { name: 'Work settings' })
  await settings.getByRole('button', { name: /New chapters come out/ }).click()
  await author.getByRole('option', { name: 'Every week, on Fridays' }).click()
  await settings.getByText('Illustrator', { exact: true }).click()
  await settings.getByRole('button', { name: 'Save settings' }).click()
  await expect(settings).toHaveCount(0)
  await author.getByRole('button', { name: 'Publish', exact: true }).click()
  await author.getByRole('dialog').getByText('Public', { exact: true }).click()
  await author.getByRole('dialog').getByRole('button', { name: 'Continue' }).click()
  await author.getByRole('dialog').getByRole('button', { name: 'Publish publicly' }).click()
  const link = await author.getByRole('dialog').getByLabel('Public link').inputValue()
  await author.getByRole('dialog').getByRole('button', { name: 'Done' }).click()

  // A reader sees the schedule and the call, then comments on one paragraph.
  const reader = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage()
  await signUp(reader, 'Tolu Ade')
  await reader.goto(link)
  await expect(reader.getByText('New chapter every Friday')).toBeVisible()
  await expect(reader.getByText('Looking for')).toBeVisible()
  await expect(reader.getByText('Illustrator', { exact: true })).toBeVisible()
  await reader.getByRole('link', { name: 'Start reading' }).click()
  await reader.getByText('Nobody had lit them in forty years.').click()
  await reader.getByRole('button', { name: 'Comment on this paragraph' }).click()
  const thread = reader.getByRole('dialog', { name: 'Comments on this paragraph' })
  await expect(thread).toContainText('Nobody had lit them in forty years.')
  await thread.getByRole('textbox', { name: 'Comment on this paragraph' }).fill('Chills. Who lit them?')
  await thread.getByRole('button', { name: 'Post comment' }).click()
  await expect(thread.getByRole('region', { name: 'Comments on this paragraph' })).toContainText(
    'Chills. Who lit them?',
  )
  expect(await axe(reader)).toEqual([])
  await reader.keyboard.press('Escape')
  await expect(reader.getByRole('button', { name: '1 comment on this paragraph' })).toBeVisible()

  // Discover gathers open calls; signed in, Home offers "For you".
  await reader.goto('/discover')
  await expect(reader.getByRole('region', { name: 'Looking for collaborators' })).toContainText(title)
  await reader.goto('/')
  await reader.getByRole('navigation', { name: 'Feeds' }).getByRole('link', { name: 'For you' }).click()
  await expect(reader).toHaveURL(/sort=for_you/)
})

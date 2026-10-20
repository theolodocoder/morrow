import { expect, test, type Page } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'

/**
 * The public feed (FR-020), reading open to everyone (P-049), likes, reader comments, avatars and badges.
 */
const editor = (p: Page) => p.getByRole('textbox', { name: /manuscript/ })
const saved = (p: Page) =>
  expect(p.getByRole('status').filter({ hasText: 'Saved' })).toBeVisible({ timeout: 10_000 })
const axe = async (p: Page) =>
  (await new AxeBuilder({ page: p }).withTags(['wcag2a', 'wcag2aa', 'wcag22aa']).analyze()).violations

async function signUp(p: Page, name: string, onboarding: (p: Page) => Promise<void> = async () => {}) {
  await p.goto('/sign-up')
  await p.getByLabel('Name').fill(name)
  await p.getByLabel('Email').fill(`${crypto.randomUUID()}@example.test`)
  await p.getByLabel('Password').fill('correct horse battery staple')
  await p.getByRole('button', { name: 'Create account' }).click()
  await expect(p.getByRole('heading', { name: /Welcome/ })).toBeVisible()
  await onboarding(p)
}

test('feed, open reading, likes, comments, avatars and badges', async ({ browser }) => {
  test.setTimeout(90_000)
  const word = `lantern${crypto.randomUUID().slice(0, 6)}`
  const title = `The ${word} Keeper`

  // A writer publishes a piece with several paragraphs.
  const author = await (await browser.newContext()).newPage()
  await signUp(author, 'Ama Owusu', async (p) => {
    await p.getByRole('button', { name: 'Skip for now' }).click()
  })
  await author.getByRole('button', { name: 'New work' }).first().click()
  await author.getByLabel('Title').fill(title)
  await author.getByRole('button', { name: 'Create' }).click()
  await saved(author)
  await editor(author).click()
  for (const line of ['First light on the water.', 'Second, the gulls.', 'Third, the keeper woke.'])
    await author.keyboard.type(`${line}\n`)
  await author.keyboard.type(`Fourth: the hidden ${word} ending.`)
  await saved(author)
  await author.getByRole('button', { name: 'Publish', exact: true }).click()
  await author.getByRole('dialog').getByText('Public', { exact: true }).click()
  await author.getByRole('dialog').getByRole('button', { name: 'Continue' }).click()
  await author.getByRole('dialog').getByRole('button', { name: 'Publish publicly' }).click()
  await author.getByRole('dialog').getByText('This work is complete').click()
  await expect(
    author.getByRole('dialog').getByRole('checkbox', { name: /This work is complete/ }),
  ).toBeChecked()
  await author.getByRole('dialog').getByRole('button', { name: 'Done' }).click()

  // Signed out: the feed shows it with its opening; liking asks you to join (and can be dismissed).
  const visitor = await (await browser.newContext()).newPage()
  await visitor.goto('/')
  const post = visitor.getByRole('article', { name: title })
  await expect(post).toBeVisible()
  await expect(post).toContainText('First light on the water.')
  await expect(post).toContainText('Complete')
  expect(await axe(visitor)).toEqual([])
  await post.getByRole('button', { name: /^Like/ }).click()
  await expect(visitor.getByRole('dialog', { name: 'Join Morrow to like this' })).toBeVisible()
  await visitor.keyboard.press('Escape')
  await expect(visitor.getByRole('dialog')).toHaveCount(0)

  // Reading needs no account (P-049): the whole piece is there, with no wall, even after a long scroll.
  await post
    .getByRole('link', { name: new RegExp(title) })
    .first()
    .click()
  await expect(visitor.getByRole('heading', { name: title, level: 1 })).toBeVisible()
  await visitor.getByRole('link', { name: 'Start reading' }).click()
  await expect(visitor.getByText(`Fourth: the hidden ${word} ending.`)).toBeVisible()
  await expect(visitor.getByRole('dialog')).toHaveCount(0)
  expect(await axe(visitor)).toEqual([])

  // A reader joins, builds an avatar, likes and comments; signed in, the whole chapter is there.
  const reader = await (await browser.newContext()).newPage()
  // React Aria radios: the visible swatch (the label) is what people click; the input itself is visually hidden.
  await signUp(reader, 'Tolu Reader', async (p) => {
    await p.getByRole('radio', { name: 'Curls' }).locator('xpath=ancestor::label').click()
    await p.getByRole('tab', { name: 'Extras' }).click()
    await p.getByRole('radio', { name: 'Round glasses' }).locator('xpath=ancestor::label').click()
    await expect(p.getByRole('radio', { name: 'Round glasses' })).toBeChecked()
    await p.getByRole('button', { name: 'Continue' }).click()
    await expect(p).toHaveURL(/\/app\/library/)
  })
  await reader.goto('/')
  const readerPost = reader.getByRole('article', { name: title })
  await readerPost.getByRole('button', { name: 'Like, 0 likes' }).click()
  await expect(readerPost.getByRole('button', { name: 'Unlike, 1 like' })).toBeVisible()
  await readerPost.getByRole('link', { name: '0 comments' }).click()
  await reader.getByRole('textbox', { name: 'Add a comment' }).fill('The gulls line got me.')
  await reader.getByRole('button', { name: 'Post comment' }).click()
  await expect(reader.getByRole('region', { name: /Comments/ })).toContainText('The gulls line got me.')
  expect(await axe(reader)).toEqual([])
  await reader.getByRole('link', { name: 'Start reading' }).click()
  await expect(reader.getByText(`Fourth: the hidden ${word} ending.`)).toBeVisible()
  await expect(reader.getByRole('dialog')).toHaveCount(0)

  // The writer earned badges, shown on their page with their avatar.
  await author.goto('/app/badges')
  await expect(author.getByText('2 of 10 earned', { exact: false })).toBeVisible()
  await author.goto('/app/settings/profile')
  await author.getByRole('link', { name: 'View public page' }).click()
  await expect(author.getByRole('region', { name: 'Badges' })).toContainText('First Chapter')
  await expect(author.getByRole('region', { name: 'Badges' })).toContainText('The Finisher')
})

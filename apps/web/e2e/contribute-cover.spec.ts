import { expect, test, type Page } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'

/**
 * Contributing to someone else's published work (P-050): ask to collaborate, the writer accepts from Activity, and
 * the work appears in your works. And covers (P-051): the writer picks one, and it's on the public page.
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

test('ask to collaborate, accept from Activity; choose a cover', async ({ browser }) => {
  test.setTimeout(90_000)
  const title = `Tidewater ${crypto.randomUUID().slice(0, 6)}`
  const author = await (await browser.newContext()).newPage()
  await signUp(author, 'Ama Owusu')
  await author.getByRole('button', { name: 'New work' }).first().click()
  await author.getByLabel('Title').fill(title)
  await author.getByRole('button', { name: 'Create' }).click()
  await saved(author)
  await editor(author).click()
  await author.keyboard.type('The water came in twice a day.')
  await saved(author)

  // A cover of the writer's own, from the editor's ⋯ menu.
  await author.getByRole('button', { name: 'More actions' }).click()
  await author.getByRole('menuitem', { name: 'Cover…' }).click()
  const cover = author.getByRole('dialog', { name: 'Cover' })
  await cover.getByRole('radio', { name: 'Plum' }).locator('xpath=ancestor::label').click()
  await cover.getByRole('radio', { name: 'Band' }).locator('xpath=ancestor::label').click()
  await expect(cover.getByRole('radio', { name: 'Band' })).toBeChecked()
  expect(await axe(author)).toEqual([])
  await cover.getByRole('button', { name: 'Save cover' }).click()
  await expect(author.getByText('Cover saved')).toBeVisible()

  await author.getByRole('button', { name: 'Publish', exact: true }).click()
  await author.getByRole('dialog').getByText('Public', { exact: true }).click()
  await author.getByRole('dialog').getByRole('button', { name: 'Continue' }).click()
  await author.getByRole('dialog').getByRole('button', { name: 'Publish publicly' }).click()
  const link = await author.getByRole('dialog').getByLabel('Public link').inputValue()
  await author.getByRole('dialog').getByRole('button', { name: 'Done' }).click()

  // Its share card is the cover beside the title.
  const card = await author.request.get(`${link}/opengraph-image`)
  expect(card.status()).toBe(200)
  expect(card.headers()['content-type']).toContain('image/png')

  // Signed out: Contribute invites you to join first.
  const visitor = await (await browser.newContext()).newPage()
  await visitor.goto(link)
  await visitor.getByRole('button', { name: 'Contribute' }).click()
  await expect(visitor.getByRole('dialog', { name: 'Join Morrow to contribute' })).toBeVisible()

  // Signed in: ask to collaborate, with a note.
  const helper = await (await browser.newContext()).newPage()
  await signUp(helper, 'Tolu Ade')
  await helper.goto(link)
  await helper.getByRole('button', { name: 'Contribute' }).click()
  const sheet = helper.getByRole('dialog', { name: /Help shape/ })
  // Edit suggestions are off for this work, and the sheet says so.
  await expect(sheet.getByRole('button', { name: /Suggest an edit/ })).toBeDisabled()
  await sheet.getByRole('button', { name: /Ask to collaborate/ }).click()
  await sheet.getByLabel(/A note to Ama/).fill('I know the tides; I could help with the harbour scenes.')
  await sheet.getByRole('button', { name: 'Send request' }).click()
  await expect(sheet.getByText('Request sent')).toBeVisible()

  // The writer answers from Activity; the helper is now in the work.
  await author.goto('/app/notifications')
  const requests = author.getByRole('region', { name: 'Asking to collaborate' })
  await expect(requests).toContainText('I know the tides')
  expect(await axe(author)).toEqual([])
  await requests.getByRole('button', { name: 'Accept Tolu Ade' }).click()
  await expect(author.getByText(`Tolu Ade joined “${title}”`)).toBeVisible()
  await expect(requests).toHaveCount(0)
  await helper.goto('/app/library')
  await expect(helper.getByRole('link', { name: new RegExp(title) }).first()).toBeVisible()

  // Comics are coming: a page that says what's planned, and a list to join.
  await helper.goto('/')
  await helper
    .getByRole('navigation', { name: 'Kinds of writing' })
    .getByRole('link', { name: /Comics/ })
    .click()
  await expect(helper.getByRole('heading', { name: /Make comics/ })).toBeVisible()
  expect(await axe(helper)).toEqual([])
  await helper.getByRole('button', { name: 'Notify me when it’s ready' }).click()
  await expect(helper.getByRole('button', { name: 'You’re on the list' })).toBeVisible()
})

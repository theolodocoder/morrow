import { expect, test, type Page } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'

/**
 * The rich editor, Notion-style: formatting stays out of sight until asked for ("/", the block handle, the selection
 * toolbar), and the form of writing shapes what's offered and how it reads.
 */
const editor = (p: Page) => p.getByRole('textbox', { name: /manuscript/ })
const saved = (p: Page) =>
  expect(p.getByRole('status').filter({ hasText: 'Saved' })).toBeVisible({ timeout: 10_000 })
const menu = (p: Page) => p.getByRole('listbox', { name: 'Add a block' })
const axe = async (p: Page) =>
  (await new AxeBuilder({ page: p }).withTags(['wcag2a', 'wcag2aa', 'wcag22aa']).analyze()).violations

async function newWork(p: Page, title: string, kind: string) {
  await p.goto('/app/library')
  await p.getByRole('button', { name: 'New work' }).first().click()
  await p.getByLabel('Title').fill(title)
  await p
    .getByRole('radio', { name: new RegExp(`^${kind}:`) })
    .locator('xpath=ancestor::label')
    .click()
  await p.getByRole('button', { name: 'Create' }).click()
  await saved(p)
}

test('a paper: "/" offers paper blocks first; abstract, table and citation reach the reader', async ({
  page: p,
}) => {
  test.setTimeout(90_000)
  await p.goto('/sign-up')
  await p.getByLabel('Name').fill('Ada Writer')
  await p.getByLabel('Email').fill(`${crypto.randomUUID()}@example.test`)
  await p.getByLabel('Password').fill('correct horse battery staple')
  await p.getByRole('button', { name: 'Create account' }).click()
  await p.getByRole('button', { name: 'Skip for now' }).click()
  const title = `Tides ${crypto.randomUUID().slice(0, 6)}`
  await newWork(p, title, 'Paper')

  // "/" opens the menu; for a paper, paper blocks come first. Nothing shows before that.
  await expect(menu(p)).toHaveCount(0)
  await editor(p).click()
  await p.keyboard.type('/')
  await expect(menu(p)).toBeVisible()
  await expect(menu(p).getByRole('option').first()).toContainText('Heading')
  expect(await axe(p)).toEqual([])
  await p.keyboard.type('abstr')
  await expect(menu(p).getByRole('option')).toHaveCount(1)
  await p.keyboard.press('Enter')
  await p.keyboard.type('We measure tides.')
  await p.keyboard.press('Enter')
  await p.keyboard.press('Enter') // Enter on an empty last line leaves the box

  // A claim with a citation: the note opens for its source straight away.
  await p.keyboard.type('Tides rise twice a day /cita') // "/" after a space; the marker then hugs "day"
  await p.keyboard.press('Enter')
  const note = p.getByRole('dialog', { name: 'Citation' })
  await expect(note).toBeVisible()
  await expect(note.getByRole('textbox', { name: 'Source' })).toBeFocused() // straight to typing
  await p.keyboard.type('Okafor (2026), On Tides.')
  await p.keyboard.press('Escape')
  await expect(note).toHaveCount(0)
  await p.keyboard.type('.')

  // A table, with its own bar.
  await p.keyboard.press('Enter')
  await p.keyboard.type('/table')
  await p.keyboard.press('Enter')
  await expect(p.getByRole('toolbar', { name: 'Table' })).toBeVisible()
  await p.keyboard.type('Tide')
  await p.keyboard.press('Tab')
  await p.keyboard.type('Height')
  await saved(p)

  // The selection toolbar: turn a paragraph into a heading. (After a table there's always a line to write on.)
  await editor(p).locator('p').last().click()
  await p.keyboard.type('Method')
  await p.keyboard.press('Shift+Home')
  const bar = p.getByRole('toolbar', { name: 'Format text' })
  await expect(bar).toBeVisible()
  await bar.getByRole('button', { name: /^Turn into/ }).click()
  await p.getByRole('menuitemradio', { name: 'Heading', exact: true }).click()
  await expect(editor(p).getByRole('heading', { name: 'Method' })).toBeVisible()
  await saved(p)

  // The block handle appears beside a block on hover.
  await editor(p).getByText('We measure tides.').hover()
  await expect(p.getByRole('button', { name: 'Add a block below' })).toBeVisible()

  // Published, a reader sees the abstract, the numbered section, the table and the reference.
  await p.getByRole('button', { name: 'Publish', exact: true }).click()
  await p.getByRole('dialog').getByText('Public', { exact: true }).click()
  await p.getByRole('dialog').getByRole('button', { name: 'Continue' }).click()
  await p.getByRole('dialog').getByRole('button', { name: 'Publish publicly' }).click()
  const link = await p.getByRole('dialog').getByRole('textbox', { name: 'Public link' }).inputValue()
  await p.goto(link)
  await p.getByRole('link', { name: 'Start reading' }).click()
  await expect(p.getByRole('complementary', { name: 'Abstract' })).toContainText('We measure tides.')
  await expect(p.getByRole('table')).toContainText('Height')
  await expect(p.getByRole('link', { name: 'Reference 1' })).toBeVisible()
  await expect(p.getByRole('region', { name: 'References' })).toContainText('Okafor (2026), On Tides.')
  expect(await axe(p)).toEqual([])
})

test('a story and a poem: scene breaks by typing ***, verse keeps its lines', async ({ page: p }) => {
  await p.goto('/sign-up')
  await p.getByLabel('Name').fill('Ola Writer')
  await p.getByLabel('Email').fill(`${crypto.randomUUID()}@example.test`)
  await p.getByLabel('Password').fill('correct horse battery staple')
  await p.getByRole('button', { name: 'Create account' }).click()
  await p.getByRole('button', { name: 'Skip for now' }).click()
  await newWork(p, `Harbour ${crypto.randomUUID().slice(0, 6)}`, 'Story')
  await editor(p).click()
  await p.keyboard.type('The boats came in.\n*** ')
  await expect(editor(p).getByRole('separator')).toHaveCount(1)
  await p.keyboard.type('Morning.')
  await saved(p)

  await newWork(p, `Stanzas ${crypto.randomUUID().slice(0, 6)}`, 'Poetry')
  await editor(p).click()
  await p.keyboard.type('/')
  await expect(menu(p).getByRole('option').first()).toContainText('Verse')
  await p.keyboard.press('Enter')
  await p.keyboard.type('salt on the tongue')
  await p.keyboard.press('Enter')
  await p.keyboard.type('  and the gulls')
  await p.keyboard.press('Enter')
  await p.keyboard.press('Enter') // twice: out of the stanza
  await p.keyboard.type('After.')
  await saved(p)
  const verse = editor(p).locator('.verse')
  await expect(verse).toHaveText('salt on the tongue\n  and the gulls')
  await expect(editor(p).locator('.verse + p')).toHaveText('After.')
})

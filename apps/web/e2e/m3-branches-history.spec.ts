import { expect, test, type Page } from '@playwright/test'

/**
 * M3 acceptance (PRD Journey D + FR-018/019): a writer explores an alternate ending in a branch without
 * endangering the original, restores an earlier version as a new change, and exports the work.
 */
const password = 'correct horse battery staple'
const editor = (p: Page) => p.getByRole('textbox', { name: /manuscript/ })
const saved = (p: Page) =>
  expect(p.getByRole('status').filter({ hasText: 'Saved' })).toBeVisible({ timeout: 10_000 })

test('M3: branch an alternate ending, keep the original safe, restore a version, export', async ({
  page,
}) => {
  await page.goto('/sign-up')
  await page.getByLabel('Name').fill('Ama Owusu')
  await page.getByLabel('Email').fill(`ama-${crypto.randomUUID()}@example.test`)
  await page.getByLabel('Password').fill(password)
  await page.getByRole('button', { name: 'Create account' }).click()
  await page.getByRole('button', { name: 'Skip for now' }).click()
  await page.getByRole('button', { name: 'New work' }).first().click()
  await page.getByLabel('Title').fill('The Salt Orchard')
  await page.getByRole('button', { name: 'Create' }).click()
  await saved(page)
  await editor(page).click()
  await page.keyboard.type('Ama walked the rows with her palms open.')
  await saved(page)

  // Chapter 2, with a named version.
  await page.getByRole('button', { name: 'New chapter' }).click()
  await expect(page.getByRole('heading', { name: 'Chapter 2', level: 1 })).toBeVisible()
  await saved(page)
  await editor(page).click()
  await page.keyboard.type('She stood at the gate for a long time.')
  await saved(page)
  await page.getByRole('button', { name: 'Versions' }).click()
  page.once('dialog', (d) => d.accept('Gate draft'))
  await page.getByRole('button', { name: 'Save version' }).click()
  await expect(page.getByRole('button', { name: /Gate draft/ })).toBeVisible()
  await page.getByRole('button', { name: 'Versions' }).click()

  // Branch from Chapter 2.
  await page.getByRole('button', { name: /Version: Main/ }).click()
  await page.getByRole('button', { name: /New branch from/ }).click()
  await page.getByLabel('Name').fill('The Lighthouse Ending')
  await page.getByLabel('What’s different here? (optional)').fill('What if Ama stays?')
  await page.getByRole('button', { name: 'Create branch' }).click()
  await expect(page.getByRole('button', { name: /Version: The Lighthouse Ending/ })).toBeVisible()
  await expect(editor(page)).toContainText('Ama walked the rows with her palms open.') // chapter 1, copied

  // Write the alternate ending in the branch's Chapter 2.
  await page.getByRole('link', { name: /Chapter 2/ }).click()
  await expect(editor(page)).toContainText('She stood at the gate for a long time.')
  await saved(page)
  await editor(page).click()
  await page.keyboard.press('Enter')
  await page.keyboard.type('The lighthouse keeper waved her in.')
  await saved(page)

  // Main is untouched.
  await page.getByRole('button', { name: /Version: The Lighthouse Ending/ }).click()
  await expect(page.getByText('from Main · diverges at Chapter 2 · by Ama Owusu')).toBeVisible()
  await page.getByRole('button', { name: /^Main/ }).click()
  await expect(page.getByRole('button', { name: /Version: Main/ })).toBeVisible()
  await page.getByRole('link', { name: /Chapter 2/ }).click()
  await expect(editor(page)).toContainText('She stood at the gate for a long time.')
  await expect(editor(page)).not.toContainText('lighthouse')

  // A mistaken edit on Main, then restore the named version as a new change.
  await saved(page)
  await editor(page).click()
  await page.keyboard.press('Enter')
  await page.keyboard.type('A line I regret.')
  await saved(page)
  await page.getByRole('button', { name: 'Versions' }).click()
  await page.getByRole('button', { name: /Gate draft/ }).click()
  page.once('dialog', (d) => d.accept())
  await page.getByRole('button', { name: 'Restore', exact: true }).click()
  await expect(editor(page)).not.toContainText('A line I regret.')
  await expect(editor(page)).toContainText('She stood at the gate for a long time.')
  await expect(page.getByRole('button', { name: /Before restore/ })).toBeVisible() // nothing is lost

  // Export.
  const download = page.waitForEvent('download')
  await page.getByRole('button', { name: 'More actions' }).click()
  await page.getByRole('menuitem', { name: 'Download as Markdown' }).click()
  const file = await download
  expect(file.suggestedFilename()).toBe('the-salt-orchard.md')
  const text = await (
    await file.createReadStream()
  )
    .toArray()
    .then((chunks) => Buffer.concat(chunks).toString('utf8'))
  expect(text).toContain('# The Salt Orchard')
  expect(text).toContain('## Chapter 2')
  expect(text).not.toContain('lighthouse')
})

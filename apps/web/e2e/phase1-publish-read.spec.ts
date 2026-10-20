import { expect, test, type Page } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'

/**
 * PRD Journey A (Phase 1): sign up, choose a username, write, publish, and read it signed out.
 * Drafting after publishing must never reach readers until the writer publishes again.
 */
const editor = (p: Page) => p.getByRole('textbox', { name: /manuscript/ })
const saved = (p: Page) =>
  expect(p.getByRole('status').filter({ hasText: 'Saved' })).toBeVisible({ timeout: 10_000 })
const axe = async (p: Page) =>
  (await new AxeBuilder({ page: p }).withTags(['wcag2a', 'wcag2aa', 'wcag22aa']).analyze()).violations

test('Phase 1: onboard, publish, read signed out, drafts stay private', async ({ page, browser }) => {
  const handle = `ama_${crypto.randomUUID().slice(0, 12).replace(/-/g, '')}`
  await page.goto('/sign-up')
  await page.getByLabel('Name').fill('Ama Owusu')
  await page.getByLabel('Email').fill(`${handle}@example.test`)
  await page.getByLabel('Password').fill('correct horse battery staple')
  await page.getByRole('button', { name: 'Create account' }).click()

  // Onboarding: a username with a live check, and an intent.
  await expect(page).toHaveURL(/\/app\/onboarding$/)
  expect(await axe(page)).toEqual([])
  await page.getByLabel('Username').fill(handle)
  await expect(page.getByText(`your page will be /authors/${handle}`)).toBeVisible()
  await page.getByText('Write my own work').click() // the chip is the label; its input is visually hidden
  await expect(page.getByRole('checkbox', { name: 'Write my own work' })).toBeChecked()
  await page.getByRole('button', { name: 'Continue' }).click()
  await expect(page).toHaveURL(/\/app\/library$/)

  // Write a first chapter.
  await page.getByRole('button', { name: 'New work' }).first().click()
  await page.getByLabel('Title').fill('The Salt Orchard')
  await page.getByRole('button', { name: 'Create' }).click()
  await saved(page)
  await editor(page).click()
  await page.keyboard.type('The salt had come up through the roots again.')
  await saved(page)

  // Publish publicly, with explicit confirmation.
  await page.getByRole('button', { name: 'Publish', exact: true }).click()
  const dialog = page.getByRole('dialog')
  await dialog.getByText('Public', { exact: true }).click()
  await dialog.getByRole('button', { name: 'Continue' }).click()
  await dialog.getByRole('button', { name: 'Publish publicly' }).click()
  const link = await dialog.getByLabel('Public link').inputValue()
  expect(link).toMatch(/\/works\/the-salt-orchard-[0-9a-f]{10}$/)
  await dialog.getByRole('button', { name: 'Done' }).click()

  // Keep drafting after publishing.
  await editor(page).click()
  await page.keyboard.press('End')
  await page.keyboard.type(' SECRET DRAFT LINE.')
  await saved(page)

  // A signed-out reader sees the published copy only.
  const readerCtx = await browser.newContext()
  const reader = await readerCtx.newPage()
  await reader.goto(link)
  await expect(reader.getByRole('heading', { name: 'The Salt Orchard', level: 1 })).toBeVisible()
  await expect(reader.getByRole('link', { name: 'Ama Owusu' })).toHaveAttribute('href', `/authors/${handle}`)
  expect(await axe(reader)).toEqual([])
  await reader.getByRole('link', { name: 'Start reading' }).click()
  await expect(reader.getByText('The salt had come up through the roots again.')).toBeVisible()
  await expect(reader.getByText('SECRET')).toHaveCount(0)
  expect(await axe(reader)).toEqual([])

  // The author page lists the work.
  await reader.goto(`/authors/${handle}`)
  await expect(reader.getByRole('heading', { name: 'Ama Owusu', level: 1 })).toBeVisible()
  await expect(reader.getByRole('link', { name: /The Salt Orchard/ })).toBeVisible()
  expect(await axe(reader)).toEqual([])

  // Unpublish: the reading page is gone for everyone.
  await page.getByRole('button', { name: 'Published', exact: true }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'Unpublish' }).click()
  await expect(page.getByRole('dialog').getByRole('button', { name: 'Continue' })).toBeVisible()
  const gone = await reader.goto(link)
  expect(gone?.status()).toBe(404)
  await readerCtx.close()
})

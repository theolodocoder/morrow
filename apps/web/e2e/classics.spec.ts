import { execSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { expect, test, type Page } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'

/** Classics (P-063): a public-domain book on the shelf, credited to its author, free to read and to retell. */
const axe = async (p: Page) =>
  (await new AxeBuilder({ page: p }).withTags(['wcag2a', 'wcag2aa', 'wcag22aa']).analyze()).violations

test.beforeAll(() => {
  // a tiny built-in book, stored without any download
  execSync('pnpm --filter @morrow/api import-classics --sample', {
    cwd: fileURLToPath(new URL('../../..', import.meta.url)),
    stdio: 'ignore',
  })
})

test('the classics shelf: read signed out, retell signed in', async ({ page: p }) => {
  await p.goto('/classics')
  await expect(p.getByRole('heading', { name: /Classics, free to read/ })).toBeVisible()
  expect(await axe(p)).toEqual([])
  await p
    .getByRole('link', { name: /The Lighthouse Sampler/ })
    .first()
    .click()
  await expect(p.getByRole('heading', { name: 'The Lighthouse Sampler', level: 1 })).toBeVisible()
  await expect(p.getByText('Public domain', { exact: true })).toBeVisible()
  await expect(p.getByText('Anonymous', { exact: true })).toBeVisible()
  await p.getByRole('link', { name: 'Start reading' }).click()
  await expect(p.getByText('Below him the sea went on arguing with the rocks.')).toBeVisible()

  // Retelling needs an account; afterwards it's your own private copy.
  await p.goBack()
  await p.getByRole('button', { name: 'Write a retelling' }).click()
  await expect(p.getByRole('dialog', { name: 'Join Morrow to write a retelling' })).toBeVisible()
  await p.goto('/sign-up')
  await p.getByLabel('Name').fill('Ama Retold')
  await p.getByLabel('Email').fill(`${crypto.randomUUID()}@example.test`)
  await p.getByLabel('Password').fill('correct horse battery staple')
  await p.getByRole('button', { name: 'Create account' }).click()
  await p.getByRole('button', { name: 'Skip for now' }).click()
  await expect(p).toHaveURL(/\/app\/library/)
  await p.goto('/classics')
  await p
    .getByRole('link', { name: /The Lighthouse Sampler/ })
    .first()
    .click()
  await p.getByRole('button', { name: 'Write a retelling' }).click()
  await expect(p).toHaveURL(/\/app\/works\//)
  await expect(p.getByText('The Lighthouse Sampler: a retelling').first()).toBeVisible()
})

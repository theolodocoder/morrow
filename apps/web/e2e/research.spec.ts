import { execSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { expect, test, type Page } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'

/** Open research (P-064): an openly licensed article, credited and linked, readable with its citations; citable. */
const axe = async (p: Page) =>
  (await new AxeBuilder({ page: p }).withTags(['wcag2a', 'wcag2aa', 'wcag22aa']).analyze()).violations

test.beforeAll(() => {
  // a tiny built-in CC BY article, stored without any download
  execSync('pnpm --filter @morrow/api import-articles --sample', {
    cwd: fileURLToPath(new URL('../../..', import.meta.url)),
    stdio: 'ignore',
  })
})

test('the research shelf: credited, licensed, readable, citable; never retold', async ({
  page: p,
  context,
}) => {
  await p.goto('/research')
  await expect(p.getByRole('heading', { name: /Open research/, level: 1 })).toBeVisible()
  expect(await axe(p)).toEqual([])
  await p
    .getByRole('link', { name: /How lighthouse keepers slept/ })
    .first()
    .click()

  // Attribution as CC BY asks: authors, source, licence, and what changed.
  await expect(p.getByRole('heading', { name: 'How lighthouse keepers slept', level: 1 })).toBeVisible()
  await expect(p.getByText('Abena Mensah and Erik Lindqvist')).toBeVisible()
  const source = p.getByRole('complementary', { name: 'Source and licence' })
  await expect(source).toContainText('Journal of Quiet Studies')
  await expect(source.getByRole('link', { name: 'View the original' })).toHaveAttribute(
    'href',
    'https://doi.org/10.0000/quiet.0001',
  )
  await expect(source.getByRole('link', { name: 'CC BY 4.0' })).toBeVisible()
  await expect(source).toContainText('figures omitted')
  await expect(p.getByRole('button', { name: 'Write a retelling' })).toHaveCount(0)
  expect(await axe(p)).toEqual([])

  await context.grantPermissions(['clipboard-read', 'clipboard-write'])
  await p.getByRole('button', { name: 'Cite' }).click()
  await expect(p.getByText('Citation copied')).toBeVisible()
  expect(await p.evaluate(() => navigator.clipboard.readText())).toBe(
    'Abena Mensah, Erik Lindqvist. (2021). How lighthouse keepers slept. Journal of Quiet Studies. https://doi.org/10.0000/quiet.0001',
  )

  // Reading: the abstract leads; citations become numbered references.
  await p.getByRole('link', { name: 'Start reading' }).click()
  await expect(p.getByText('Keepers slept in')).toBeVisible()
  await expect(p.getByRole('heading', { name: 'References' })).toBeVisible()
  await expect(p.getByText(/Hale J 1890 The four-hour watch/)).toBeVisible()
  expect(await axe(p)).toEqual([])
})

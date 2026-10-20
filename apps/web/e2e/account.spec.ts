import { expect, test, type Page } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'

/** Launch basics: forgot password, your data, deleting the account, share cards and the sitemap. */
const axe = async (p: Page) =>
  (await new AxeBuilder({ page: p }).withTags(['wcag2a', 'wcag2aa', 'wcag22aa']).analyze()).violations

test('forgot password, download your data, delete the account; share cards and sitemap', async ({
  page: p,
  request,
}) => {
  test.setTimeout(90_000)
  const email = `${crypto.randomUUID()}@example.test`
  await p.goto('/sign-up')
  await p.getByLabel('Name').fill('Ama Leaving')
  await p.getByLabel('Email').fill(email)
  await p.getByLabel('Password').fill('correct horse battery staple')
  await p.getByRole('button', { name: 'Create account' }).click()
  await p.getByRole('button', { name: 'Skip for now' }).click()
  await expect(p).toHaveURL(/\/app\/library/)

  // Account settings: email status, password, data, deletion.
  await p.goto('/app/settings/account')
  await expect(p.getByRole('heading', { name: 'Account', level: 1 })).toBeVisible()
  await expect(p.getByText('Not confirmed yet')).toBeVisible()
  expect(await axe(p)).toEqual([])
  const download = p.waitForEvent('download')
  await p.getByRole('link', { name: 'Download your data' }).click()
  expect((await download).suggestedFilename()).toMatch(/^morrow-export-.*\.json$/)

  await p.getByRole('button', { name: 'Delete account…' }).click()
  const confirm = p.getByRole('dialog', { name: 'Delete your account?' })
  await confirm.getByLabel('Your password').fill('correct horse battery staple')
  await confirm.getByLabel('Type DELETE to confirm').fill('DELETE')
  await confirm.getByRole('button', { name: 'Delete forever' }).click()
  await expect(p).toHaveURL(/\/\?deleted=1/)

  // The old sign-in no longer works; "Forgot your password?" answers the same for any address.
  await p.goto('/sign-in')
  await p.getByRole('link', { name: 'Forgot your password?' }).click()
  await expect(p.getByRole('heading', { name: 'Forgot your password?' })).toBeVisible()
  expect(await axe(p)).toEqual([])
  await p.getByLabel('Email').fill(email)
  await p.getByRole('button', { name: 'Send me a link' }).click()
  await expect(p.getByRole('heading', { name: 'A link is on its way.' })).toBeVisible()
  await p.goto('/reset-password?token=nope&error=INVALID_TOKEN')
  await expect(p.getByRole('heading', { name: 'That link no longer works.' })).toBeVisible()

  // Share cards and the sitemap.
  const og = await request.get('/opengraph-image')
  expect(og.status()).toBe(200)
  expect(og.headers()['content-type']).toContain('image/png')
  const sitemap = await request.get('/sitemap.xml')
  expect(sitemap.status()).toBe(200)
  expect(await sitemap.text()).toContain('<urlset')
  const robots = await (await request.get('/robots.txt')).text()
  expect(robots).toContain('Disallow: /app/')
})

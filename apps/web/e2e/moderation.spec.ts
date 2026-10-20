import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { expect, test, type Page } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import { totp } from './totp'

/** PRD FR-031/032: report, moderate from the console, the reporter hears back, the author appeals, a block. */
const repo = fileURLToPath(new URL('../../..', import.meta.url))
const editor = (p: Page) => p.getByRole('textbox', { name: /manuscript/ })
const saved = (p: Page) =>
  expect(p.getByRole('status').filter({ hasText: 'Saved' })).toBeVisible({ timeout: 10_000 })
const axe = async (p: Page) =>
  (await new AxeBuilder({ page: p }).withTags(['wcag2a', 'wcag2aa', 'wcag22aa']).analyze()).violations

async function signUp(p: Page, name: string, onboard = true) {
  const email = `${crypto.randomUUID()}@example.test`
  await p.goto('/sign-up')
  await p.getByLabel('Name').fill(name)
  await p.getByLabel('Email').fill(email)
  await p.getByLabel('Password').fill('correct horse battery staple')
  await p.getByRole('button', { name: 'Create account' }).click()
  await p.getByRole('button', { name: onboard ? 'Continue' : 'Skip for now' }).click()
  await expect(p).toHaveURL(/\/app\/library$/)
  return email
}
const ADMIN = process.env.E2E_ADMIN_URL ?? 'http://localhost:3002'
/** A moderator's first visit to the admin app: sign in, then enrol two-factor (required), like a person would. */
async function enterAdmin(p: Page, email: string) {
  await p.goto(`${ADMIN}/sign-in`)
  await p.getByLabel('Email').fill(email)
  await p.getByLabel('Password').fill('correct horse battery staple')
  await p.getByRole('button', { name: 'Continue' }).click()
  await expect(p).toHaveURL(/\/setup-two-factor$/) // staff tools refuse until two-factor is on
  await p.getByLabel('Confirm your password').fill('correct horse battery staple')
  await p.getByRole('button', { name: 'Continue' }).click()
  const secret = (await p.getByTestId('totp-secret').innerText()).replace(/\s/g, '')
  await p.getByLabel('3. Enter the 6-digit code it shows').fill(totp(secret))
  await p.getByRole('button', { name: 'Turn on and continue' }).click()
  await expect(p).toHaveURL(/\/moderation$/)
}
/** Staff roles are granted outside the app, by the operator's CLI. */
const grantModerator = (email: string) =>
  execFileSync('pnpm', ['--filter', '@morrow/api', 'staff', 'grant', email, 'moderator'], {
    cwd: repo,
    stdio: 'pipe',
  })

test('Report → moderate → reporter hears back → appeal → overturned; and blocking', async ({ browser }) => {
  const title = `Orchard ${crypto.randomUUID().slice(0, 6)}`
  const author = await (await browser.newContext()).newPage()
  await signUp(author, 'Ama Owusu')
  await author.getByRole('button', { name: 'New work' }).first().click()
  await author.getByLabel('Title').fill(title)
  await author.getByRole('button', { name: 'Create' }).click()
  await saved(author)
  await editor(author).click()
  await author.keyboard.type('A first line.')
  await saved(author)
  await author.getByRole('button', { name: 'Publish', exact: true }).click()
  await author.getByRole('dialog').getByText('Public', { exact: true }).click()
  await author.getByRole('dialog').getByRole('button', { name: 'Continue' }).click()
  await author.getByRole('dialog').getByRole('button', { name: 'Publish publicly' }).click()
  const link = await author.getByRole('dialog').getByLabel('Public link').inputValue()
  await author.getByRole('dialog').getByRole('button', { name: 'Done' }).click()

  // A reader reports it.
  const reader = await (await browser.newContext()).newPage()
  await signUp(reader, 'Bisi Reader', false)
  await reader.goto(link)
  await reader.getByRole('button', { name: 'More', exact: true }).click()
  await reader.getByRole('menuitem', { name: 'Report this work' }).click()
  await reader.getByRole('dialog').getByText('Spam', { exact: true }).click()
  await reader.getByLabel('Anything a moderator should know (optional)').fill('Looks like an ad.')
  expect(await axe(reader)).toEqual([])
  await reader.getByRole('button', { name: 'Send report' }).click()
  await expect(reader.getByText('Thank you. A moderator will review it.')).toBeVisible()
  await reader.getByRole('button', { name: 'Done' }).click()

  // A moderator reviews the snapshot and hides the work.
  const mod = await (await browser.newContext()).newPage()
  const modEmail = await signUp(mod, 'Mo Derator', false)
  grantModerator(modEmail)
  await enterAdmin(mod, modEmail)
  const card = mod.getByRole('listitem').filter({ hasText: title }).first()
  await expect(card).toContainText('Looks like an ad.')
  expect(await axe(mod)).toEqual([])
  await card.getByLabel('Hide the work from public pages').check()
  await card.getByLabel('Reason (recorded in the audit history)').fill('Advertising, not writing')
  await card.getByLabel('Note to the reporter (optional)').fill('We hid it. Thank you for telling us.')
  await card.getByRole('button', { name: 'Record decision' }).click()
  await expect(mod.getByRole('listitem').filter({ hasText: title })).toHaveCount(0)
  const gone = await reader.goto(link)
  expect(gone?.status()).toBe(404)

  // The reporter sees the outcome.
  await reader.goto('/app/reports')
  await expect(reader.getByText('Action taken')).toBeVisible()
  await expect(reader.getByText('We hid it. Thank you for telling us.')).toBeVisible()

  // The author appeals; a different moderator overturns it.
  await author.goto('/app/moderation-status')
  await expect(author.getByText('A work of yours was hidden')).toBeVisible()
  await author.getByRole('button', { name: 'Appeal' }).click()
  await author
    .getByLabel('Why should this be reconsidered?')
    .fill('It is a novel I am writing, not an advert.')
  await author.getByRole('button', { name: 'Send appeal' }).click()
  await expect(author.getByText(/waiting for a moderator who wasn’t involved/)).toBeVisible()
  const mod2 = await (await browser.newContext()).newPage()
  const mod2Email = await signUp(mod2, 'Second Look', false)
  grantModerator(mod2Email)
  await enterAdmin(mod2, mod2Email)
  await mod2.getByRole('button', { name: 'appeals' }).click()
  const appeal = mod2.getByRole('listitem').filter({ hasText: 'It is a novel I am writing' }).first()
  await appeal.getByLabel('Decision note (sent to them)').fill('It is a novel. Restored, with apologies.')
  await appeal.getByRole('button', { name: 'Overturn and restore' }).click()
  await expect(mod2.getByRole('listitem').filter({ hasText: 'It is a novel I am writing' })).toHaveCount(0)
  const back = await reader.goto(link)
  expect(back?.status()).toBe(200)

  // Blocking, from the author's page.
  await reader.getByRole('link', { name: 'Ama Owusu' }).first().click()
  await expect(reader).toHaveURL(/\/authors\//)
  await reader.getByRole('button', { name: 'More', exact: true }).click() // block lives in ⋯ on a profile
  await reader.getByRole('menuitem', { name: 'Block' }).click()
  await expect(reader.getByRole('dialog')).toContainText('Neither of you can follow the other')
  await reader.getByRole('dialog').getByRole('button', { name: 'Block' }).click()
  await expect(reader.getByText('Ama is blocked.')).toBeVisible()
  await reader.goto('/app/settings/safety')
  await expect(reader.getByRole('region', { name: 'Blocked accounts' })).toContainText('Ama Owusu')
})

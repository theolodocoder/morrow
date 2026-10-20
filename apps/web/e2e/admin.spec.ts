import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { expect, test, type Page } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import { totp } from './totp'

/** The admin app: staff with two-factor; people and comps; plans as data; the audit trail. Writers see their plan. */
const repo = fileURLToPath(new URL('../../..', import.meta.url))
const ADMIN = process.env.E2E_ADMIN_URL ?? 'http://localhost:3002'
const password = 'correct horse battery staple'
const axe = async (p: Page) =>
  (await new AxeBuilder({ page: p }).withTags(['wcag2a', 'wcag2aa', 'wcag22aa']).analyze()).violations
const grant = (email: string, role: 'admin' | 'moderator') =>
  execFileSync('pnpm', ['--filter', '@morrow/api', 'staff', 'grant', email, role], {
    cwd: repo,
    stdio: 'pipe',
  })

async function signUp(p: Page, name: string) {
  const email = `${crypto.randomUUID()}@example.test`
  await p.goto('/sign-up')
  await p.getByLabel('Name').fill(name)
  await p.getByLabel('Email').fill(email)
  await p.getByLabel('Password').fill(password)
  await p.getByRole('button', { name: 'Create account' }).click()
  await p.getByRole('button', { name: 'Skip for now' }).click()
  await expect(p).toHaveURL(/\/app\/library$/)
  return email
}

test('Admin app: two-factor gate, comp a plan the writer then sees, edit plans, audit', async ({
  browser,
}) => {
  const writer = await (await browser.newContext()).newPage()
  const writerName = `Writer ${crypto.randomUUID().slice(0, 5)}`
  await signUp(writer, writerName)
  await writer.goto('/app/settings/plan')
  await expect(writer.getByRole('heading', { name: 'Your plan: Free' })).toBeVisible()
  await expect(writer.getByText('Paid plans aren’t on sale yet.')).toBeVisible()
  expect(await axe(writer)).toEqual([])

  // The writer sends beta feedback from the library.
  const note = `Save badge flickers ${crypto.randomUUID().slice(0, 4)}`
  await writer.goto('/app/library')
  await writer.getByRole('button', { name: 'Your account' }).first().click()
  await writer.getByRole('menuitem', { name: 'Send feedback to Morrow' }).click()
  await writer.getByLabel('Tell us').fill(note)
  await writer.getByRole('dialog').getByRole('button', { name: 'Send', exact: true }).click()
  await expect(writer.getByText('Thank you. It goes straight to the people building Morrow.')).toBeVisible()
  await writer.getByRole('button', { name: 'Done' }).click()

  // A plain account never gets in.
  const nobody = await (await browser.newContext()).newPage()
  const nobodyEmail = await signUp(nobody, 'Not Staff')
  await nobody.goto(`${ADMIN}/sign-in`)
  await nobody.getByLabel('Email').fill(nobodyEmail)
  await nobody.getByLabel('Password').fill(password)
  await nobody.getByRole('button', { name: 'Continue' }).click()
  await expect(nobody.getByRole('heading', { name: 'No staff access' })).toBeVisible()

  // An admin enrols two-factor, then signs in again with a code.
  const admin = await (await browser.newContext()).newPage()
  const adminEmail = await signUp(admin, 'Ada Admin')
  grant(adminEmail, 'admin')
  await admin.goto(`${ADMIN}/sign-in`)
  await admin.getByLabel('Email').fill(adminEmail)
  await admin.getByLabel('Password').fill(password)
  await admin.getByRole('button', { name: 'Continue' }).click()
  await expect(admin).toHaveURL(/\/setup-two-factor$/)
  expect(await axe(admin)).toEqual([])
  await admin.getByLabel('Confirm your password').fill(password)
  await admin.getByRole('button', { name: 'Continue' }).click()
  const secret = (await admin.getByTestId('totp-secret').innerText()).replace(/\s/g, '')
  await admin.getByLabel('3. Enter the 6-digit code it shows').fill(totp(secret))
  await admin.getByRole('button', { name: 'Turn on and continue' }).click()
  await expect(admin).toHaveURL(/\/moderation$/)
  await admin.getByRole('button', { name: 'Sign out' }).click()
  await admin.getByLabel('Email').fill(adminEmail)
  await admin.getByLabel('Password').fill(password)
  await admin.getByRole('button', { name: 'Continue' }).click()
  await expect(admin.getByRole('heading', { name: 'Authentication code' })).toBeVisible()
  await admin.getByLabel('6-digit code from your authenticator app').fill(totp(secret))
  await admin.getByRole('button', { name: 'Continue' }).click()
  await expect(admin).toHaveURL(/\/moderation$/)

  // Find the writer and comp them Studio.
  await admin.getByRole('link', { name: 'People' }).click()
  await admin.getByLabel('Email, name or username').fill(writerName)
  await admin.getByRole('button', { name: 'Search' }).click()
  await admin.getByRole('link', { name: writerName }).click()
  await admin.getByLabel('Plan').selectOption('studio')
  await admin.getByLabel('Why (recorded in the audit)').fill('Beta partner')
  await admin.getByRole('button', { name: 'Grant' }).click()
  await expect(admin.getByText('studio (comped)')).toBeVisible()
  expect(await axe(admin)).toEqual([])
  await writer.goto('/app/settings/plan')
  await expect(writer.getByRole('heading', { name: 'Your plan: Studio' })).toBeVisible()
  await expect(writer.getByText('Given to you by the Morrow team.')).toBeVisible()

  // Plans are data: change a limit; the audit shows both actions.
  await admin.getByRole('link', { name: 'Plans' }).click()
  const free = admin.getByRole('form', { name: 'Plan Free' })
  await free.getByLabel('Branches per work').fill('12')
  await free.getByRole('button', { name: 'Save Free' }).click()
  await expect(free.getByRole('status')).toHaveText('Saved')
  await admin.getByRole('link', { name: 'Audit' }).click()
  await expect(admin.getByRole('cell', { name: /comp granted/ }).first()).toBeVisible()
  await expect(admin.getByRole('cell', { name: /plan updated/ }).first()).toBeVisible()

  // Feedback reaches staff; metrics are counts, not tracking.
  await admin.getByRole('link', { name: 'Feedback' }).click()
  await expect(admin.getByText(note)).toBeVisible()
  await admin.getByRole('link', { name: 'Metrics' }).click()
  await expect(admin.getByText('Nobody is tracked to produce these.')).toBeVisible()
  expect(await axe(admin)).toEqual([])
})

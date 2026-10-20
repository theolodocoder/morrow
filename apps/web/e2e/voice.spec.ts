import { chromium, expect, test, type Page } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'

/**
 * Voice rooms (P-064): two collaborators on the same chapter join voice and connect browser to browser. Chromium's
 * fake microphone stands in for a real one (and grants the permission), so this runs headless.
 */
const password = 'correct horse battery staple'
const editor = (p: Page) => p.getByRole('textbox', { name: /manuscript/ })
const status = (p: Page, text: string) =>
  expect(p.getByRole('status').filter({ hasText: text })).toBeVisible({ timeout: 10_000 })
const axe = async (p: Page) =>
  (await new AxeBuilder({ page: p }).withTags(['wcag2a', 'wcag2aa', 'wcag22aa']).analyze()).violations

async function signUpOn(page: Page, name: string, email: string) {
  await expect(page.getByLabel('Name')).toBeEnabled()
  await page.getByLabel('Name').fill(name)
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password').fill(password)
  await page.getByRole('button', { name: 'Create account' }).click()
}

test('two collaborators talk while they write', async ({ baseURL }) => {
  test.setTimeout(90_000)
  const browser = await chromium.launch({
    args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'],
  })
  const ctx = () => browser.newContext({ baseURL: baseURL!, permissions: ['microphone'] })
  const owner = await (await ctx()).newPage()
  const guest = await (await ctx()).newPage()
  const guestEmail = `tolu-${crypto.randomUUID()}@example.test`

  await owner.goto('/sign-up')
  await signUpOn(owner, 'Ama Owusu', `ama-${crypto.randomUUID()}@example.test`)
  await owner.getByRole('button', { name: 'Skip for now' }).click()
  await owner.getByRole('button', { name: 'New work' }).first().click()
  await owner.getByLabel('Title').fill('Voices')
  await owner.getByRole('button', { name: 'Create' }).click()
  await status(owner, 'Saved')
  await editor(owner).click()
  await owner.keyboard.type('We wrote it out loud.')
  await status(owner, 'Saved')
  await owner.getByRole('button', { name: 'Share' }).click()
  await owner.getByLabel('Invite by email').fill(guestEmail)
  await owner.getByRole('button', { name: 'Create invitation' }).click()
  const link = await owner.getByLabel('Invitation link').inputValue()
  await owner.getByRole('button', { name: 'Done' }).click()

  await guest.goto(link)
  await guest.getByRole('link', { name: 'Create an account to accept' }).click()
  await signUpOn(guest, 'Tolu Ade', guestEmail)
  await guest.getByRole('button', { name: 'Accept invitation' }).click()
  await status(guest, 'Saved')

  // Ama joins (muted); Tolu, who hasn't joined, already sees one person talking.
  await owner.getByRole('button', { name: /^Voice/ }).click()
  const ownerPanel = owner.getByRole('dialog', { name: 'Voice' })
  await ownerPanel.getByRole('button', { name: 'Join voice' }).click()
  await expect(ownerPanel).toHaveAttribute('data-voice-status', 'joined')
  await expect(ownerPanel.locator('[data-voice-peer="me"]')).toBeVisible()
  await expect(guest.getByRole('button', { name: 'Voice: 1 talking' })).toBeVisible()
  expect(await axe(owner)).toEqual([])

  // Tolu joins; the two connect browser to browser.
  await guest.getByRole('button', { name: /^Voice/ }).click()
  const guestPanel = guest.getByRole('dialog', { name: 'Voice' })
  await guestPanel.getByRole('button', { name: 'Join voice' }).click()
  await expect(guestPanel.locator('[data-peer-state="connected"]:not([data-voice-peer="me"])')).toBeVisible({
    timeout: 20_000,
  })
  await expect(ownerPanel.locator('[data-peer-state="connected"]:not([data-voice-peer="me"])')).toBeVisible({
    timeout: 20_000,
  })
  await expect(ownerPanel).toContainText('Tolu Ade')

  // Unmuting shows to the other side; leaving takes you out of the room for everyone.
  await ownerPanel.getByRole('button', { name: 'Unmute' }).click()
  await expect(guestPanel.locator('li', { hasText: 'Ama Owusu' })).toContainText('Unmuted')
  await guestPanel.getByRole('button', { name: 'Leave voice' }).click()
  await expect(ownerPanel.locator('li')).toHaveCount(1)
  await browser.close()
})

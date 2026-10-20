import { expect, test, type Page } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'

/** PRD FR-030: notifications from real activity, a quiet bell, a center that links to the thing, and preferences. */
const password = 'correct horse battery staple'
const editor = (p: Page) => p.getByRole('textbox', { name: /manuscript/ })
const saved = (p: Page) =>
  expect(p.getByRole('status').filter({ hasText: 'Saved' })).toBeVisible({ timeout: 10_000 })
const axe = async (p: Page) =>
  (await new AxeBuilder({ page: p }).withTags(['wcag2a', 'wcag2aa', 'wcag22aa']).analyze()).violations
async function signUp(p: Page, name: string, email: string) {
  await p.getByLabel('Name').fill(name)
  await p.getByLabel('Email').fill(email)
  await p.getByLabel('Password').fill(password)
  await p.getByRole('button', { name: 'Create account' }).click()
}

test('Notifications: a comment and a mention reach the right people, link to the conversation, and respect preferences', async ({
  browser,
}) => {
  const owner = await (await browser.newContext()).newPage()
  const reader = await (await browser.newContext()).newPage()
  const readerEmail = `reader-${crypto.randomUUID()}@example.test`

  await owner.goto('/sign-up')
  await signUp(owner, 'Ama Owusu', `ama-${crypto.randomUUID()}@example.test`)
  await owner.getByRole('button', { name: 'Skip for now' }).click()
  await owner.getByRole('button', { name: 'New work' }).first().click()
  await owner.getByLabel('Title').fill('The Salt Orchard')
  await owner.getByRole('button', { name: 'Create' }).click()
  await saved(owner)
  await editor(owner).click()
  await owner.keyboard.type('The salt had come up through the roots again.')
  await saved(owner)
  await owner.getByRole('button', { name: 'Share' }).click()
  await owner.getByLabel('Invite by email').fill(readerEmail)
  await owner.getByRole('dialog').getByRole('button', { name: /Role/ }).click()
  await owner.getByRole('option', { name: /Reader/ }).click()
  await owner.getByRole('button', { name: 'Create invitation' }).click()
  const link = await owner.getByLabel('Invitation link').inputValue()
  await owner.getByRole('button', { name: 'Done' }).click()

  await reader.goto(link)
  await reader.getByRole('link', { name: 'Create an account to accept' }).click()
  await signUp(reader, 'Bisi Reader', readerEmail)
  await reader.getByRole('button', { name: 'Accept invitation' }).click()
  await expect(editor(reader)).toHaveAttribute('contenteditable', 'false')

  // The owner is told someone joined; the reader comments.
  await editor(reader)
    .getByText(/The salt/)
    .evaluate((el) => {
      const r = document.createRange()
      r.selectNodeContents(el)
      getSelection()!.removeAllRanges()
      getSelection()!.addRange(r)
    })
  await reader.getByRole('button', { name: 'Comment', exact: true }).click()
  await reader.getByLabel('Your comment').fill('Which roots?')
  await reader
    .getByRole('complementary', { name: 'Feedback' })
    .getByRole('button', { name: 'Comment', exact: true })
    .click()

  // The bell counts quietly (no pop-up), refreshed when the window regains focus.
  // The worker turns events into notifications within a second or so; the bell shows them the next time you look.
  await expect
    .poll(
      async () => {
        await owner.goto('/app/library')
        await owner.waitForLoadState('networkidle')
        return owner.getByRole('link', { name: /^Activity/ }).getAttribute('aria-label')
      },
      { timeout: 15_000 },
    )
    .toBe('Activity, 2 unread')
  await owner.getByRole('link', { name: /^Activity/ }).click()
  await expect(owner.getByRole('heading', { name: 'Activity' })).toBeVisible()
  await expect(owner.getByText('Bisi Reader joined “The Salt Orchard”')).toBeVisible()
  expect(await axe(owner)).toEqual([])
  // Opening it lands on the chapter with the conversation open.
  await owner.getByRole('button', { name: /Bisi Reader commented on “Chapter 1”/ }).click()
  await expect(owner).toHaveURL(/\/edit\/.+\?feedback=1/)
  await expect(owner.getByRole('complementary', { name: 'Feedback' }).getByText('Which roots?')).toBeVisible()

  // The owner replies and mentions the reader: one notification for them, as a mention.
  const reply = owner
    .getByRole('complementary', { name: 'Feedback' })
    .getByRole('combobox', { name: 'Reply' })
  await reply.click()
  await reply.pressSequentially('These ones, @bis')
  await owner.getByRole('option', { name: /Bisi Reader/ }).click()
  await owner
    .getByRole('complementary', { name: 'Feedback' })
    .getByRole('button', { name: 'Reply', exact: true })
    .click()
  await expect
    .poll(
      async () => {
        await reader.goto('/app/notifications')
        await reader.waitForLoadState('networkidle')
        return reader.getByRole('button', { name: /Ama Owusu mentioned you on “Chapter 1”/ }).count()
      },
      { timeout: 15_000 },
    )
    .toBe(1)
  await expect(reader.getByRole('button', { name: /replied on/ })).toHaveCount(0) // not twice
  await reader.getByRole('button', { name: 'Mark all as read' }).click()
  await expect(reader.getByText('All caught up.')).toBeVisible()

  // Preferences persist.
  await reader.getByRole('link', { name: 'Notification settings' }).click()
  await reader.getByRole('checkbox', { name: 'Comments and replies: email' }).check()
  await reader.getByRole('checkbox', { name: 'Hold emails overnight' }).check()
  await reader.getByRole('button', { name: 'Save preferences' }).click()
  await expect(reader.getByRole('status').filter({ hasText: 'Saved' })).toBeVisible()
  expect(await axe(reader)).toEqual([])
  await reader.reload()
  await expect(reader.getByRole('checkbox', { name: 'Comments and replies: email' })).toBeChecked()
  await expect(reader.getByRole('checkbox', { name: 'Hold emails overnight' })).toBeChecked()
})

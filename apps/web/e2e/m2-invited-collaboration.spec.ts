import { expect, test, type Page } from '@playwright/test'

/**
 * M2 acceptance journey (plans/development-sequence.md): the owner invites an editor; they co-write in real time
 * with visible presence; the owner downgrades them to viewer and their session becomes read-only immediately;
 * removing them ends their access.
 */
const password = 'correct horse battery staple'
const editor = (p: Page) => p.getByRole('textbox', { name: /manuscript/ })
const status = (p: Page, text: string) =>
  expect(p.getByRole('status').filter({ hasText: text })).toBeVisible({ timeout: 10_000 })

async function signUpOn(page: Page, name: string, email: string) {
  await page.getByLabel('Name').fill(name)
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password').fill(password)
  await page.getByRole('button', { name: 'Create account' }).click()
}

test('M2: invite, co-write live, downgrade to read-only, remove', async ({ browser }) => {
  const ownerCtx = await browser.newContext()
  const owner = await ownerCtx.newPage()
  const guestCtx = await browser.newContext()
  const guest = await guestCtx.newPage()
  const guestEmail = `tolu-${crypto.randomUUID()}@example.test`

  // Owner: a work with a first line.
  await owner.goto('/sign-up')
  await signUpOn(owner, 'Ama Owusu', `ama-${crypto.randomUUID()}@example.test`)
  await owner.getByRole('button', { name: 'Skip for now' }).click()
  await owner.getByRole('button', { name: 'New work' }).first().click()
  await owner.getByLabel('Title').fill('The Salt Orchard')
  await owner.getByRole('button', { name: 'Create' }).click()
  await status(owner, 'Saved')
  await editor(owner).click()
  await owner.keyboard.type('The salt had come up through the roots again.')
  await status(owner, 'Saved')

  // Owner invites Tolu as an editor and copies the link (no email provider yet: the link is the delivery).
  await owner.getByRole('button', { name: 'Share' }).click()
  await owner.getByLabel('Invite by email').fill(guestEmail)
  await owner.getByRole('button', { name: 'Create invitation' }).click()
  const link = await owner.getByLabel('Invitation link').inputValue()
  expect(link).toContain('/invite/')
  await owner.getByRole('button', { name: 'Done' }).click()

  // Tolu opens the link signed out, creates an account, returns to the invitation and accepts.
  await guest.goto(link)
  await expect(guest.getByText('Ama Owusu invited you to join as an editor.')).toBeVisible()
  await guest.getByRole('link', { name: 'Create an account to accept' }).click()
  await signUpOn(guest, 'Tolu Ade', guestEmail)
  await expect(guest).toHaveURL(/\/invite\//)
  await guest.getByRole('button', { name: 'Accept invitation' }).click()
  await expect(guest).toHaveURL(/\/app\/works\/.+\/edit\/.+/)
  await status(guest, 'Saved')
  await expect(editor(guest)).toContainText('The salt had come up through the roots again.')

  // Real-time co-writing with presence.
  await expect(owner.getByRole('group', { name: /Also here: Tolu Ade/ })).toBeVisible()
  await expect(guest.getByRole('group', { name: /Also here: Ama Owusu/ })).toBeVisible()
  await editor(guest).click()
  await guest.keyboard.press('End')
  await guest.keyboard.press('Enter')
  await guest.keyboard.type('Ama walked the rows with her palms open.')
  await expect(editor(owner)).toContainText('Ama walked the rows with her palms open.')
  // Structure, not just text: the guest's Enter made a second paragraph after the owner's.
  const paragraphs = () =>
    editor(owner).evaluate((root) =>
      [...root.querySelectorAll('p')].map((p) => {
        const copy = p.cloneNode(true) as HTMLElement
        copy.querySelectorAll('.collaboration-carets__caret').forEach((c) => c.remove()) // ignore remote caret labels
        return copy.textContent
      }),
    )
  await expect
    .poll(paragraphs)
    .toEqual(['The salt had come up through the roots again.', 'Ama walked the rows with her palms open.'])

  // Downgrade to reader: Tolu's session becomes read-only straight away.
  await owner.getByRole('button', { name: 'Share' }).click()
  await owner.getByRole('button', { name: /Role for Tolu Ade/ }).click()
  await owner.getByRole('option', { name: 'Reader' }).click()
  await owner.getByRole('button', { name: 'Done' }).click()
  await status(guest, 'View only')
  await expect(editor(guest)).toHaveAttribute('contenteditable', 'false')

  // Remove: Tolu loses access entirely.
  await owner.getByRole('button', { name: 'Share' }).click()
  await owner.getByRole('button', { name: 'Remove Tolu Ade' }).click()
  await status(guest, 'No access')
  await guest.goto('/app/library')
  await expect(guest.getByText('The Salt Orchard')).toHaveCount(0)

  await ownerCtx.close()
  await guestCtx.close()
})

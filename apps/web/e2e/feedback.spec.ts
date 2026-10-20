import { expect, test, type Page } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'

/**
 * PRD FR-016/017: a reader comments on a passage and reacts to a paragraph; the anchor follows its words through the
 * owner's edits; replies arrive live; when the passage is rewritten the comment is shown as detached; resolving it
 * closes the thread. The manuscript itself never changes.
 */
const password = 'correct horse battery staple'
const editor = (p: Page) => p.getByRole('textbox', { name: /manuscript/ })
const saved = (p: Page) =>
  expect(p.getByRole('status').filter({ hasText: 'Saved' })).toBeVisible({ timeout: 10_000 })
const panel = (p: Page) => p.getByRole('complementary', { name: 'Feedback' })
const axe = async (p: Page) =>
  (await new AxeBuilder({ page: p }).withTags(['wcag2a', 'wcag2aa', 'wcag22aa']).analyze()).violations

async function signUp(p: Page, name: string, email: string) {
  await p.getByLabel('Name').fill(name)
  await p.getByLabel('Email').fill(email)
  await p.getByLabel('Password').fill(password)
  await p.getByRole('button', { name: 'Create account' }).click()
}

test('Feedback: anchored comments that follow the text, live replies, reactions, detach, resolve', async ({
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
  await owner.keyboard.press('Enter')
  await owner.keyboard.type('She did not look back.')
  await saved(owner)

  // Invite a beta reader.
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

  // The reader selects a word (read-only text is still selectable) and comments on it.
  await editor(reader)
    .getByText('The salt had come up through the roots again.')
    .evaluate((el) => {
      const text = el.firstChild!
      const start = text.textContent!.indexOf('roots')
      const range = document.createRange()
      range.setStart(text, start)
      range.setEnd(text, start + 'roots'.length)
      const sel = window.getSelection()!
      sel.removeAllRanges()
      sel.addRange(range)
    })
  await reader.getByRole('button', { name: 'Comment', exact: true }).click()
  await expect(panel(reader).locator('blockquote').first()).toHaveText('roots')
  await panel(reader).getByLabel('Your comment').fill('Roots, or rows?')
  await panel(reader).getByRole('button', { name: 'Comment', exact: true }).click()
  await expect(panel(reader).getByText('Roots, or rows?')).toBeVisible()
  expect(await axe(reader)).toEqual([])

  // The reader closes their panel; the owner, who hasn't opened Feedback yet, is told there's something new.
  await reader.getByRole('button', { name: /^Feedback/ }).click()
  await expect(owner.getByRole('button', { name: 'Feedback, 1 new' })).toBeVisible()
  await expect(owner.locator('.feedback-dot')).toHaveCount(1)

  // The owner opens Feedback: the signal clears, and the comment is pinned to "roots" in the text.
  await owner.getByRole('button', { name: /^Feedback/ }).click()
  await expect(owner.getByRole('button', { name: 'Feedback', exact: true })).toBeVisible()
  await expect(owner.locator('.feedback-dot')).toHaveCount(0)
  await expect(panel(owner).getByText('Roots, or rows?')).toBeVisible()
  await expect(editor(owner).locator('.comment-anchor')).toHaveText('roots')

  // Editing before the passage doesn't move the highlight off its words.
  await editor(owner).getByText('She did not look back.').click()
  await expect(editor(owner)).toBeFocused()
  // under load the click's caret can arrive after the next key: wait until it's really in that paragraph
  await expect
    .poll(() => owner.evaluate(() => document.getSelection()?.anchorNode?.textContent ?? ''))
    .toContain('She did not look back.')
  await owner.keyboard.press('ArrowUp')
  await owner.keyboard.press('Home')
  // Regression guard: typing must not refetch feedback (a re-subscribe on every save-status change once flooded
  // the API until it rate-limited the writer).
  let feedbackRequests = 0
  const count = (r: { url(): string }) => {
    if (/\/comments|\/reactions|\/feedback\//.test(r.url())) feedbackRequests++
  }
  owner.on('request', count)
  await owner.keyboard.type('That spring, ', { delay: 40 })
  await saved(owner)
  owner.off('request', count)
  expect(feedbackRequests).toBeLessThanOrEqual(2)
  await expect(editor(owner)).toContainText('That spring, The salt had come up through the roots again.')
  await expect(editor(owner).locator('.comment-anchor')).toHaveText('roots')

  // The owner replies and @mentions the reader, picking them from the autocomplete.
  const reply = panel(owner).getByRole('combobox', { name: 'Reply' })
  await reply.click()
  await reply.pressSequentially('Roots. Thanks @bis')
  const option = owner.getByRole('option', { name: /Bisi Reader/ })
  await expect(option).toBeVisible()
  // Handles are unique across all accounts, so read the one the suggestion offers rather than assuming it.
  const handle = (await option.innerText()).match(/@(\w+)/)![1]!
  await reply.press('Enter')
  await expect(reply).toHaveValue(`Roots. Thanks @${handle} `)
  await reply.pressSequentially('— the salt rises through them.')
  await panel(owner).getByRole('button', { name: 'Reply', exact: true }).click()
  await expect(panel(owner).getByText(`@${handle}`, { exact: true })).toBeVisible()

  // The reader's Feedback button lights up; opening it shows the reply.
  await expect(reader.getByRole('button', { name: 'Feedback, 1 new' })).toBeVisible()
  await reader.getByRole('button', { name: /^Feedback/ }).click()
  await expect(panel(reader).getByText(/the salt rises through them/)).toBeVisible()
  expect(await axe(reader)).toEqual([])

  // The reader reacts to the second paragraph.
  await editor(reader)
    .getByText('She did not look back.')
    .evaluate((el) => {
      const range = document.createRange()
      range.selectNodeContents(el)
      window.getSelection()!.removeAllRanges()
      window.getSelection()!.addRange(range)
    })
  await reader.getByRole('button', { name: 'React', exact: true }).click()
  await reader.getByRole('button', { name: 'Beautiful line', exact: true }).click()
  await expect(panel(owner).getByRole('button', { name: /Beautiful line 1/ })).toBeVisible()

  // Rewriting the first paragraph removes the passage: the comment is shown as detached, not pinned to new text.
  await editor(owner)
    .getByText(/That spring/)
    .click({ clickCount: 3 })
  await owner.keyboard.type('A new first line.')
  await saved(owner)
  await expect(panel(owner).getByText('Detached: the passage was changed or removed')).toBeVisible()
  await expect(editor(owner).locator('.comment-anchor')).toHaveCount(0)

  // Resolve closes it for everyone.
  await panel(owner).getByRole('button', { name: 'Resolve' }).click()
  await expect(panel(reader).getByRole('button', { name: 'Show 1 resolved' })).toBeVisible()
  await expect(panel(reader).getByText('Roots, or rows?')).toHaveCount(0)
  expect(await axe(owner)).toEqual([])
})

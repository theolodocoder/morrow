import { expect, test } from '@playwright/test'

/**
 * Accessibility review (PRD Phase 7): what axe can't check. Keyboard-only use, visible focus, the skip link,
 * reduced motion, and reflow at 200% zoom (WCAG 2.4.1, 2.4.7, 2.1.1, 2.3.3, 1.4.10).
 */
test('keyboard only: skip link, visible focus, sign up and start writing without a mouse', async ({
  page,
}) => {
  await page.goto('/sign-up')
  await page.keyboard.press('Tab')
  const skip = page.getByRole('link', { name: 'Skip to content' })
  await expect(skip).toBeFocused()
  await expect(skip).toBeVisible() // revealed on focus
  await page.keyboard.press('Tab')
  // Focus is always visible: the focused element draws an outline or ring.
  const ring = await page.evaluate(() => {
    const el = document.activeElement as HTMLElement
    const cs = getComputedStyle(el)
    return cs.outlineStyle !== 'none' || cs.boxShadow !== 'none'
  })
  expect(ring).toBe(true)
  await page.getByLabel('Name').focus()
  await page.keyboard.type('Ama Owusu')
  await page.keyboard.press('Tab')
  await page.keyboard.type(`${crypto.randomUUID()}@example.test`)
  await page.keyboard.press('Tab')
  await page.keyboard.type('correct horse battery staple')
  await page.keyboard.press('Enter')
  await expect(page).toHaveURL(/\/app\/onboarding$/)
  await page.getByRole('button', { name: 'Skip for now' }).focus()
  await page.keyboard.press('Enter')
  await expect(page).toHaveURL(/\/app\/library$/)
  await page.getByRole('button', { name: 'New work' }).first().focus()
  await page.keyboard.press('Enter')
  await page.keyboard.type('Keyboard Only')
  await page.keyboard.press('Enter')
  await expect(page.getByRole('status').filter({ hasText: 'Saved' })).toBeVisible({ timeout: 10_000 })
  await page.getByRole('textbox', { name: /manuscript/ }).focus()
  await page.keyboard.type('Written without a mouse.')
  await expect(page.getByRole('textbox', { name: /manuscript/ })).toContainText('Written without a mouse.')
  // The menu opens and closes from the keyboard; Escape returns focus to its button.
  await page.getByRole('button', { name: 'More actions' }).focus()
  await page.keyboard.press('Enter')
  await expect(page.getByRole('menu')).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('menu')).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'More actions' })).toBeFocused()
})

test('reduced motion: nothing pulses or animates for people who ask for stillness', async ({ browser }) => {
  const ctx = await browser.newContext({ reducedMotion: 'reduce' })
  const page = await ctx.newPage()
  await page.goto('/sign-up')
  const animated = await page.evaluate(() => {
    const probe = document.createElement('span')
    probe.className = 'feedback-dot'
    document.body.appendChild(probe)
    const after = getComputedStyle(probe, '::after')
    return { name: after.animationName, display: after.display }
  })
  expect(animated.name === 'none' || animated.display === 'none').toBe(true)
  await ctx.close()
})

test('reflow: at 320px wide (400% zoom equivalent) public pages don’t scroll sideways', async ({
  browser,
}) => {
  const ctx = await browser.newContext({ viewport: { width: 320, height: 640 } })
  const page = await ctx.newPage()
  for (const path of ['/discover', '/sign-in', '/search?q=orchard']) {
    await page.goto(path)
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    )
    expect(overflow, path).toBeLessThanOrEqual(1)
  }
  // The editor, which carries the most controls, also fits.
  await page.goto('/sign-up')
  await page.getByLabel('Name').fill('Ama Owusu')
  await page.getByLabel('Email').fill(`${crypto.randomUUID()}@example.test`)
  await page.getByLabel('Password').fill('correct horse battery staple')
  await page.getByRole('button', { name: 'Create account' }).click()
  await page.getByRole('button', { name: 'Skip for now' }).click()
  await page.getByRole('button', { name: 'New work' }).first().click()
  await page.getByLabel('Title').fill('Narrow')
  await page.getByRole('button', { name: 'Create' }).click()
  await expect(page.getByRole('status').filter({ hasText: 'Saved' })).toBeVisible({ timeout: 10_000 })
  const editorOverflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  )
  expect(editorOverflow, 'editor').toBeLessThanOrEqual(1)
  await ctx.close()
})

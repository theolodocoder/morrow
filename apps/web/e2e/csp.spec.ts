import { expect, test } from '@playwright/test'

/** The Content Security Policy must block injected script without breaking the app (Phase 7 security review). */
test('CSP is enforced, the app runs under it, and nothing it needs is blocked', async ({ page }) => {
  const violations: string[] = []
  page.on('console', (m) => {
    if (/Content Security Policy|Refused to/i.test(m.text())) violations.push(m.text())
  })
  const res = await page.goto('/sign-up')
  expect(res?.headers()['content-security-policy']).toContain("script-src 'self' 'nonce-")
  // The app is interactive under the policy (React hydrated): the form works.
  await page.getByLabel('Name').fill('Ama Owusu')
  await page.getByLabel('Email').fill(`${crypto.randomUUID()}@example.test`)
  await page.getByLabel('Password').fill('correct horse battery staple')
  await page.getByRole('button', { name: 'Create account' }).click()
  await page.getByRole('button', { name: 'Skip for now' }).click()
  await page.getByRole('button', { name: 'New work' }).first().click()
  await page.getByLabel('Title').fill('CSP Check')
  await page.getByRole('button', { name: 'Create' }).click()
  // The collaboration websocket is allowed: the chapter syncs.
  await expect(page.getByRole('status').filter({ hasText: 'Saved' })).toBeVisible({ timeout: 10_000 })
  // What an XSS bug would inject is markup: an inline event handler. The policy refuses to run it.
  await page.evaluate(() => {
    ;(window as unknown as { __pwned?: boolean }).__pwned = false
    const box = document.createElement('div')
    box.innerHTML =
      '<img src="data:," onerror="window.__pwned = true"><a href="javascript:window.__pwned=true" id="xss">x</a>'
    document.body.appendChild(box)
  })
  await page.waitForTimeout(300)
  await page.locator('#xss').click({ force: true })
  await page.waitForTimeout(200)
  expect(await page.evaluate(() => (window as unknown as { __pwned?: boolean }).__pwned)).toBe(false)
  expect(violations.filter((v) => !v.includes('__pwned') && !v.includes("'nonce-"))).toEqual([])
})

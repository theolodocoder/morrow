import { expect, test, type Page } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'

/** The phone experience (design/product-redesign.md §3, §7): tabs, the Write sheet, writing with the keyboard bar. */
test.use({ viewport: { width: 390, height: 844 }, hasTouch: true })
const axe = async (p: Page) =>
  (await new AxeBuilder({ page: p }).withTags(['wcag2a', 'wcag2aa', 'wcag22aa']).analyze()).violations

test('on a phone: five tabs, Write from anywhere, a toolbar above the keyboard, reading settings', async ({
  page: p,
}) => {
  test.setTimeout(90_000)
  await p.goto('/sign-up')
  await p.getByLabel('Name').fill('Ola Mobile')
  await p.getByLabel('Email').fill(`${crypto.randomUUID()}@example.test`)
  await p.getByLabel('Password').fill('correct horse battery staple')
  await p.getByRole('button', { name: 'Create account' }).click()
  // Onboarding: the live preview leads, the actions stay in reach at the bottom.
  await expect(p.getByRole('heading', { name: /Welcome/ })).toBeVisible()
  expect(await axe(p)).toEqual([])
  await p.getByRole('button', { name: 'Skip for now' }).click()

  // One bottom bar: Home, Discover, Write, Activity, You. No sidebar.
  const tabs = p.getByRole('navigation', { name: 'Main' })
  await expect(tabs).toHaveCount(1)
  for (const name of ['Home', 'Discover', 'Write', 'Activity', 'You'])
    await expect(
      tabs.getByRole(name === 'Write' ? 'button' : 'link', { name: new RegExp(`^${name}`) }),
    ).toBeVisible()
  expect(await axe(p)).toEqual([])

  // Sheets close with a swipe down on their handle.
  await tabs.getByRole('button', { name: 'Write' }).click()
  const sheet = p.getByRole('dialog', { name: /Begin a new work|Write/ })
  await expect(sheet).toBeVisible()
  const handle = p.locator('.sheet [aria-hidden="true"]').first()
  const box = (await handle.boundingBox())!
  const at = (y: number) => ({
    pointerType: 'touch',
    pointerId: 7,
    isPrimary: true,
    clientX: box.x + 20,
    clientY: y,
  })
  await handle.dispatchEvent('pointerdown', at(box.y + 4))
  await handle.dispatchEvent('pointermove', at(box.y + 120))
  await handle.dispatchEvent('pointermove', at(box.y + 260))
  await handle.dispatchEvent('pointerup', at(box.y + 260))
  await expect(sheet).toHaveCount(0)

  // Write, from the centre of the bar: a sheet to start something new.
  await tabs.getByRole('button', { name: 'Write' }).click()
  await expect(sheet).toBeVisible()
  await sheet.getByLabel('Title').fill('Pocket Story')
  await sheet
    .getByRole('radio', { name: /^Poetry:/ })
    .locator('xpath=ancestor::label')
    .click()
  await sheet.getByRole('button', { name: 'Create' }).click()

  // Writing: the bar sits above the keyboard; "+" offers every block, the form's first.
  const editor = p.getByRole('textbox', { name: /manuscript/ })
  await expect(p.getByRole('status').filter({ hasText: 'Saved' })).toBeVisible({ timeout: 10_000 })
  await editor.click()
  const bar = p.getByRole('toolbar', { name: 'Formatting' })
  await expect(bar).toBeVisible()
  await p.keyboard.type('Salt on the tongue')
  await bar.getByRole('button', { name: 'Add a block' }).click()
  const blocks = p.getByRole('dialog', { name: 'Add a block' })
  await expect(blocks.getByRole('button').first()).toContainText('Verse')
  await blocks.getByRole('button', { name: /Scene break/ }).click()
  await expect(editor.locator('.scene-break')).toHaveCount(1)
  expect(await axe(p)).toEqual([])

  // Panels are sheets on a phone, with a way to close them.
  await p.getByRole('button', { name: /^Feedback/ }).click()
  await expect(p.getByRole('complementary', { name: 'Feedback' })).toBeVisible()
  await p.getByRole('button', { name: 'Hide panel' }).last().click()
  await expect(p.getByRole('complementary', { name: 'Feedback' })).toHaveCount(0)

  // Home's filters: feeds are tabs; a kind is a chip that clears itself when tapped again.
  await p.goto('/')
  await expect(
    p.getByRole('navigation', { name: 'Feeds' }).getByRole('link', { name: 'Latest' }),
  ).toHaveAttribute('aria-current', 'page')
  const kinds = p.getByRole('navigation', { name: 'Kinds of writing' })
  await kinds.getByRole('link', { name: 'Poetry' }).click()
  await expect(p).toHaveURL(/category=poetry/)
  await kinds.getByRole('link', { name: /Poetry, chosen/ }).click()
  await expect(p).not.toHaveURL(/category=/)

  // Reading: Aa changes the page, and remembers it.
  await p.goto('/')
  const post = p.getByRole('article').first()
  await post.getByRole('heading').click()
  await p.getByRole('link', { name: 'Start reading' }).click()
  await p.getByRole('button', { name: 'Reading settings' }).click()
  await p.getByRole('button', { name: 'Night' }).click()
  await expect(p.locator('.reader')).toHaveAttribute('data-tone', 'night')
  await p.reload()
  await expect(p.locator('.reader')).toHaveAttribute('data-tone', 'night')
  expect(await axe(p)).toEqual([])
})

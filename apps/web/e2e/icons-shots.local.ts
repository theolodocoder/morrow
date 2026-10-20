import { chromium } from '@playwright/test'
const S =
  '/private/tmp/claude-501/-Users-promiseokafor-Desktop-Workspaces-prodev-morrow-private/8b2e9415-0971-4dc0-ba7a-4cbb1aa251d9/scratchpad/shots'
const b = await chromium.launch()
for (const scheme of ['light', 'dark'] as const) {
  const p = await (
    await b.newContext({ viewport: { width: 1360, height: 820 }, colorScheme: scheme })
  ).newPage()
  await p.goto('http://localhost:3000/sign-up')
  await p.getByLabel('Name').fill('Ama Owusu')
  await p.getByLabel('Email').fill('shot-' + crypto.randomUUID() + '@example.test')
  await p.getByLabel('Password').fill('correct horse battery staple')
  await p.getByRole('button', { name: 'Create account' }).click()
  await p.getByRole('button', { name: 'Skip for now' }).click()
  await p.getByRole('button', { name: 'New work' }).first().click()
  await p.getByLabel('Title').fill('The Salt Orchard')
  await p.getByRole('button', { name: 'Create' }).click()
  const ed = p.getByRole('textbox', { name: /manuscript/ })
  await ed.click()
  await p.keyboard.type(
    'The salt had come up through the roots again. Ama walked the rows with her palms open.',
  )
  await p.waitForTimeout(800)
  await p.screenshot({
    path: S + '/' + scheme + '-header.png',
    clip: { x: 0, y: 0, width: 1360, height: 60 },
  })
  await ed.getByText(/The salt/).evaluate((el) => {
    const t = el.firstChild!
    const r = document.createRange()
    r.setStart(t, 4)
    r.setEnd(t, 21)
    getSelection()!.removeAllRanges()
    getSelection()!.addRange(r)
  })
  await p.waitForTimeout(400)
  await p.screenshot({
    path: S + '/' + scheme + '-toolbar.png',
    clip: { x: 300, y: 200, width: 760, height: 260 },
  })
  await p.getByRole('button', { name: 'Comment', exact: true }).click()
  await p.getByLabel('Your comment').fill('Is it roots, or rows?')
  await p
    .getByRole('complementary', { name: 'Feedback' })
    .getByRole('button', { name: 'Comment', exact: true })
    .click()
  await p.waitForTimeout(600)
  await p.screenshot({ path: S + '/' + scheme + '-panel.png' })
  await p.getByRole('button', { name: 'More actions' }).click()
  await p.waitForTimeout(300)
  await p.screenshot({
    path: S + '/' + scheme + '-menu.png',
    clip: { x: 1060, y: 0, width: 300, height: 220 },
  })
}
await b.close()

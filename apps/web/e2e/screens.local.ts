import { chromium } from '@playwright/test'
const S =
  '/private/tmp/claude-501/-Users-promiseokafor-Desktop-Workspaces-prodev-morrow-private/8b2e9415-0971-4dc0-ba7a-4cbb1aa251d9/scratchpad/shots'
const b = await chromium.launch()
const ctx = await b.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 })
const p = await ctx.newPage()
const email = 'shots-' + Date.now() + '@example.test'
await p.goto('http://localhost:3000/sign-up')
await p.screenshot({ path: S + '/1-signup.png' })
await p.getByLabel('Name').fill('Ama Owusu')
await p.getByLabel('Email').fill(email)
await p.getByLabel('Password').fill('correct horse battery staple')
await p.getByRole('button', { name: 'Create account' }).click()
await p.waitForURL(/library/)
await p.screenshot({ path: S + '/2-library-empty.png' })
await p.getByRole('button', { name: 'New work' }).first().click()
await p.getByLabel('Title').fill('The Salt Orchard')
await p.screenshot({ path: S + '/3-new-work.png' })
await p.getByRole('button', { name: 'Create' }).click()
await p.waitForURL(/chapters/)
await p.getByRole('status').filter({ hasText: 'Saved' }).waitFor()
const ed = p.getByRole('textbox', { name: /manuscript/ })
await ed.click()
await p.keyboard.type(
  'The salt had come up through the roots again that spring, and Ama walked the rows with her palms open, as if the orchard might answer her.',
)
await p.keyboard.press('Enter')
await p.keyboard.type(
  'Nobody in the village spoke of the tide anymore. It came when it wanted, the way grief does, and left the low fields silvered.',
)
await p.keyboard.press('Enter')
await p.keyboard.type('She stood at the gate for a long time.')
await p.getByRole('button', { name: 'New chapter' }).click()
await p.waitForTimeout(1500)
await p.getByRole('link', { name: /Chapter 1/ }).click()
await p.waitForTimeout(1500)
await p.screenshot({ path: S + '/4-editor.png' })
await p.getByText('Nobody in the village').dblclick()
await p.waitForTimeout(400)
await p.screenshot({ path: S + '/5-selection.png' })
await p.getByRole('button', { name: 'Versions' }).click()
p.once('dialog', (d) => d.accept('First draft'))
await p.getByRole('button', { name: 'Save version' }).click()
await p.waitForTimeout(1200)
await p.screenshot({ path: S + '/6-versions.png' })
await p.emulateMedia({ colorScheme: 'dark' })
await p.waitForTimeout(300)
await p.screenshot({ path: S + '/7-editor-dark.png' })
await p.goto('http://localhost:3000/library')
await p.screenshot({ path: S + '/8-library-dark.png' })
await p.emulateMedia({ colorScheme: 'light' })
const m = await b.newContext({
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 3,
  storageState: await ctx.storageState(),
})
const mp = await m.newPage()
await mp.goto(p.url())
await mp.getByText('The Salt Orchard').click()
await mp.waitForTimeout(1500)
await mp.screenshot({ path: S + '/9-mobile-editor.png' })
await b.close()

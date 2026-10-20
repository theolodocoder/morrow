import { chromium, type Page } from '@playwright/test'
const S =
    '/private/tmp/claude-501/-Users-promiseokafor-Desktop-Workspaces-prodev-morrow-private/8b2e9415-0971-4dc0-ba7a-4cbb1aa251d9/scratchpad/shots',
  pw = 'correct horse battery staple'
const b = await chromium.launch()
const mk = async () => {
  const c = await b.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 })
  return [c, await c.newPage()] as const
}
const signUp = async (p: Page, name: string, email: string) => {
  await p.getByLabel('Name').fill(name)
  await p.getByLabel('Email').fill(email)
  await p.getByLabel('Password').fill(pw)
  await p.getByRole('button', { name: 'Create account' }).click()
}
const [, o] = await mk()
const [, g] = await mk()
const ge = 'tolu-' + Date.now() + '@example.test'
await o.goto('http://localhost:3000/sign-up')
await signUp(o, 'Ama Owusu', 'ama-' + Date.now() + '@example.test')
await o.waitForURL(/library/)
await o.getByRole('button', { name: 'New work' }).first().click()
await o.getByLabel('Title').fill('The Salt Orchard')
await o.getByRole('button', { name: 'Create' }).click()
await o.waitForURL(/chapters/)
await o.getByRole('status').filter({ hasText: 'Saved' }).waitFor()
await o.getByRole('textbox', { name: /manuscript/ }).click()
await o.keyboard.type(
  'The salt had come up through the roots again that spring, and Ama walked the rows with her palms open.',
)
await o.getByRole('button', { name: 'Share' }).click()
await o.getByLabel('Invite by email').fill(ge)
await o.getByRole('button', { name: 'Create invitation' }).click()
const link = await o.getByLabel('Invitation link').inputValue()
await o.waitForTimeout(300)
await o.screenshot({ path: S + '/m2-share-dialog.png' })
await o.getByRole('button', { name: 'Done' }).click()
await g.goto(link)
await g.waitForTimeout(300)
await g.screenshot({ path: S + '/m2-invite-page.png' })
await g.getByRole('link', { name: 'Create an account to accept' }).click()
await signUp(g, 'Tolu Ade', ge)
await g.waitForURL(/invite/)
await g.getByRole('button', { name: 'Accept invitation' }).click()
await g.waitForURL(/chapters/)
await g.getByRole('status').filter({ hasText: 'Saved' }).waitFor()
await g.getByRole('textbox', { name: /manuscript/ }).click()
await g.keyboard.press('End')
await g.keyboard.press('Enter')
await g.keyboard.type('Nobody in the village spoke of the tide anymore.')
await o.waitForTimeout(600)
await o.screenshot({ path: S + '/m2-owner-sees-tolu.png' })
await b.close()

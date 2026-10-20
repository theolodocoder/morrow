import { chromium } from '@playwright/test'
const b = await chromium.launch()
for (const [name, vp, scheme] of [
  ['auth-desktop', { width: 1440, height: 900 }, 'light'],
  ['auth-desktop-dark', { width: 1440, height: 900 }, 'dark'],
  ['auth-mobile', { width: 390, height: 844 }, 'light'],
] as const) {
  const c = await b.newContext({ viewport: vp, deviceScaleFactor: 2, colorScheme: scheme })
  const p = await c.newPage()
  for (const route of ['sign-up', 'sign-in']) {
    await p.goto('http://localhost:3000/' + route)
    await p.waitForTimeout(400)
    await p.screenshot({
      path:
        '/private/tmp/claude-501/-Users-promiseokafor-Desktop-Workspaces-prodev-morrow-private/8b2e9415-0971-4dc0-ba7a-4cbb1aa251d9/scratchpad/shots/' +
        name +
        '-' +
        route +
        '.png',
    })
  }
  await c.close()
}
await b.close()

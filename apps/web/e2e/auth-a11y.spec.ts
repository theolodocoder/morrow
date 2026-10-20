import { expect, test } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'

for (const scheme of ['light', 'dark'] as const)
  for (const route of ['/sign-up', '/sign-in']) {
    test(`${route} has no WCAG 2.2 AA violations (${scheme})`, async ({ page }) => {
      await page.emulateMedia({ colorScheme: scheme })
      await page.goto(route)
      const { violations } = await new AxeBuilder({ page })
        .withTags(['wcag2a', 'wcag2aa', 'wcag22aa'])
        .analyze()
      expect(violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target).join(', ')}`)).toEqual([])
    })
  }

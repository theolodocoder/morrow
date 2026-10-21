import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test'

/**
 * Resilience R2: live editing under bad networks. Each page's network is shaped through the Chrome DevTools
 * Protocol (per page, never `context.setOffline`, which would fight over the same emulation).
 *
 * What this Chromium's emulation does (checked, HeadlessChrome 156):
 * - `offline: true` stalls an open WebSocket rather than killing it: frames queue and arrive once back online, and
 *   `navigator.onLine` turns false. Only a stall longer than the provider's 30 s message timeout drops the socket.
 * - `latency` never reaches WebSocket frames (only throughput does), so a page that needs a slow link gets its
 *   collab socket routed through the test, which delays every frame in order.
 * - `packetLoss` is accepted but only affects WebRTC; HTTP and WebSocket traffic is untouched even at 100 %. So the
 *   "lossy" profile is high latency + low throughput, not real loss.
 */
const password = 'correct horse battery staple'
const editor = (p: Page) => p.getByRole('textbox', { name: /manuscript/ })
const status = (p: Page, label: string, timeout = 10_000) =>
  expect(p.getByRole('status').filter({ hasText: new RegExp(`^${label}$`) })).toBeVisible({ timeout })

/** CDP conditions, plus `ws`: the one-way delay added to collab socket frames (needs a routed writer). */
type Conditions = {
  offline: boolean
  latency: number
  downloadThroughput: number
  uploadThroughput: number
  ws?: number
}
const ONLINE: Conditions = { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 }
const OFFLINE: Conditions = { ...ONLINE, offline: true }
const SLOW_3G: Conditions = {
  offline: false,
  latency: 400,
  downloadThroughput: 50_000,
  uploadThroughput: 50_000,
  ws: 200,
}
const LOSSY: Conditions = {
  offline: false,
  latency: 1_500,
  downloadThroughput: 20_000,
  uploadThroughput: 20_000,
  ws: 750,
}

async function network(w: Writer) {
  const cdp = await w.ctx.newCDPSession(w.page)
  await cdp.send('Network.enable')
  return async ({ ws = 0, ...c }: Conditions) => {
    if (ws && !w.shape) throw new Error('a slow socket needs a routed writer')
    if (w.shape) w.shape.delay = ws
    await cdp.send('Network.emulateNetworkConditions', c)
  }
}

async function signUp(page: Page, name: string, email: string) {
  await page.getByLabel('Name').fill(name)
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password').fill(password)
  await page.getByRole('button', { name: 'Create account' }).click()
}

interface Writer {
  ctx: BrowserContext
  page: Page
  shape?: { delay: number }
}

/**
 * The provider's reconnect backoff uses full jitter: each wait is random, up to 1, 2, 4 … 30 s. Pinning only that
 * random draw to its maximum makes every run see the worst case, so timing assertions can't pass or fail by luck.
 * Dev server only: it matches the `defaultCalculateDelay` stack frame, a name a minified build renames.
 */
function worstCaseBackoff() {
  const random = Math.random
  Math.random = () => (new Error().stack?.includes('defaultCalculateDelay') ? 0.999999 : random())
}

async function writer(browser: Browser, routed = false): Promise<Writer> {
  const ctx = await browser.newContext()
  const shape = routed ? { delay: 0 } : undefined
  if (shape)
    await ctx.routeWebSocket(/:4001/, (ws) => {
      const server = ws.connectToServer()
      // Each direction delivers in order, `delay` after the frame was sent (or right after the frame before it).
      const pipe = (to: { send: (m: string | Buffer) => void }) => {
        let last = 0
        return (m: string | Buffer) => {
          const at = Math.max(Date.now() + shape.delay, last)
          last = at
          setTimeout(() => to.send(m), Math.max(0, at - Date.now()))
        }
      }
      ws.onMessage(pipe(server))
      server.onMessage(pipe(ws))
    })
  await ctx.addInitScript(worstCaseBackoff)
  const page = await ctx.newPage()
  return { ctx, page, shape }
}

/** An owner with a new work whose chapter holds `blocks`, plus invited editors who have it open. */
async function room(browser: Browser, blocks: string[], guests: string[], routedOwner = false) {
  const ownerEmail = `ama-${crypto.randomUUID()}@example.test`
  const owner = await writer(browser, routedOwner)
  const a = owner.page
  await a.goto('/sign-up')
  await signUp(a, 'Ama Owusu', ownerEmail)
  await a.getByRole('button', { name: 'Skip for now' }).click()
  await a.getByRole('button', { name: 'New work' }).first().click()
  await a.getByLabel('Title').fill('Weather Report')
  await a.getByRole('button', { name: 'Create' }).click()
  await expect(a).toHaveURL(/\/app\/works\/.+\/edit\/.+/)
  await status(a, 'Saved')
  await editor(a).click()
  for (const [i, b] of blocks.entries()) {
    if (i) await a.keyboard.press('Enter')
    await a.keyboard.type(b)
  }
  await status(a, 'Saved')
  const url = a.url()

  const writers = [owner]
  for (const name of guests) {
    const email = `${name.toLowerCase()}-${crypto.randomUUID()}@example.test`
    await a.getByRole('button', { name: 'Share' }).click()
    await a.getByLabel('Invite by email').fill(email)
    await a.getByRole('button', { name: 'Create invitation' }).click()
    const link = await a.getByLabel('Invitation link').inputValue()
    await a.getByRole('button', { name: 'Done' }).click()
    const g = await writer(browser)
    await g.page.goto(link)
    await g.page.getByRole('link', { name: 'Create an account to accept' }).click()
    await signUp(g.page, `${name} Ade`, email)
    await g.page.getByRole('button', { name: 'Accept invitation' }).click()
    await expect(g.page).toHaveURL(url)
    await status(g.page, 'Saved')
    writers.push(g)
  }
  for (const w of writers) await expect.poll(() => text(w.page)).toEqual(blocks)
  return { url, ownerEmail, writers }
}

/** Top-level block texts without remote caret labels. */
const text = (p: Page) =>
  editor(p).evaluate((root) =>
    [...root.children].map((el) => {
      const copy = el.cloneNode(true) as HTMLElement
      copy.querySelectorAll('.collaboration-carets__caret').forEach((c) => c.remove())
      return copy.textContent ?? ''
    }),
  )

/** Waits until every page shows the same blocks; on timeout, says who shows what. */
async function converged(pages: Page[], timeout = 30_000) {
  const deadline = Date.now() + timeout
  let texts: string[][] = []
  for (;;) {
    texts = await Promise.all(pages.map(text))
    if (texts.every((t) => JSON.stringify(t) === JSON.stringify(texts[0]))) return texts[0]!
    if (Date.now() > deadline) throw new Error(`clients diverged:\n${JSON.stringify(texts, null, 1)}`)
    await pages[0]!.waitForTimeout(250)
  }
}

/** A fresh context with no device copy: what it shows came from the server. */
async function serverCopy(browser: Browser, email: string, url: string) {
  const ctx = await browser.newContext()
  const p = await ctx.newPage()
  await p.goto('/sign-in')
  await p.getByLabel('Email').fill(email)
  await p.getByLabel('Password').fill(password)
  await p.getByRole('button', { name: 'Sign in' }).click()
  await expect(p).toHaveURL(/\/app\/library$/, { timeout: 30_000 }) // password hashing is slow on a busy machine
  await p.goto(url)
  await status(p, 'Saved')
  const t = await text(p)
  await ctx.close()
  return t
}

/** The slice of the editor these helpers touch (Tiptap puts the editor on its DOM node). */
type Pm = {
  state: {
    doc: { child: (k: number) => { nodeSize: number } }
    selection: {
      anchor: number
      head: number
      from: number
      to: number
      $from: { index: (depth: number) => number; parentOffset: number; parent: { content: { size: number } } }
    }
  }
  view: { posAtDOM: (node: globalThis.Node, offset: number) => number }
  commands: { setTextSelection: (r: { from: number; to: number }) => void }
}

/**
 * Waits until the editor has caught up with the browser's selection. The editor reads a click's new selection a
 * moment later; keys pressed before then land at the old caret (a writer is never that fast, a test is).
 */
const settled = (p: Page) =>
  expect
    .poll(() =>
      editor(p).evaluate((root) => {
        const { view, state } = (root as unknown as { editor: Pm }).editor
        const dom = getSelection()
        if (!dom?.anchorNode || !dom.focusNode || document.activeElement !== root) return false
        try {
          const anchor = view.posAtDOM(dom.anchorNode, dom.anchorOffset)
          const head = view.posAtDOM(dom.focusNode, dom.focusOffset)
          return state.selection.anchor === anchor && state.selection.head === head
        } catch {
          return false
        }
      }),
    )
    .toBe(true)

/** Puts the caret at the end of block `i` (a short, single-line block). */
async function caretAtEnd(p: Page, i: number) {
  await editor(p).locator(':scope > *').nth(i).click()
  await p.keyboard.press('End')
  await settled(p)
  await expect
    .poll(() =>
      editor(p).evaluate((root) => {
        const { $from } = (root as unknown as { editor: Pm }).editor.state.selection
        return [$from.index(0), $from.parentOffset === $from.parent.content.size]
      }),
    )
    .toEqual([i, true])
}

/**
 * Selects `length` characters after the first `offset` of block `i`, through the editor: arrow-key counting misses
 * when remote carets re-render. Typing and deleting still go through the keyboard.
 */
async function select(p: Page, i: number, offset: number, length = 0) {
  await editor(p).locator(':scope > *').nth(i).click() // real focus, as a writer would have
  await settled(p)
  const want = await editor(p).evaluate(
    (root, [i, offset, length]) => {
      const ed = (root as unknown as { editor: Pm }).editor
      let pos = 1 // inside block 0
      for (let k = 0; k < i; k++) pos += ed.state.doc.child(k).nodeSize
      const range = { from: pos + offset, to: pos + offset + length }
      ed.commands.setTextSelection(range)
      return range
    },
    [i, offset, length] as const,
  )
  await settled(p)
  expect(
    await editor(p).evaluate((root) => {
      const { from, to } = (root as unknown as { editor: Pm }).editor.state.selection
      return { from, to }
    }),
  ).toEqual(want)
}
const selected = (p: Page) => editor(p).evaluate(() => getSelection()?.toString() ?? '')

const WORDS =
  'amber birch cedar delta ember fjord grove heron inlet juniper kestrel lumen marsh nectar orchid'.split(' ')
/** At least `n` characters of words; uppercase for the second writer so two interleaved writers can be told apart. */
function words(n: number, upper = false) {
  let s = ''
  while (s.length < n) s += ` ${WORDS[Math.floor(Math.random() * WORDS.length)]}`
  return upper ? s.toUpperCase() : s
}
/** Characters of one case, in order: an interleaved merge keeps each writer's sequence intact. */
const lower = (s: string) => s.replace(/[^a-z]/g, '')
const upper = (s: string) => s.replace(/[^A-Z]/g, '')

/** Records every save-status label with its time, so a brief wrong one can't slip between samples. */
function recordLabels() {
  const w = window as unknown as { __labels: [number, string][] }
  w.__labels = []
  const labels = new Set([
    'Connecting…',
    'Saved',
    'Saving…',
    'Saved on this device',
    'Offline',
    'Reconnecting…',
    'Not saved to server yet',
    'View only',
    'No access',
    'Reload to keep editing',
  ])
  const read = () =>
    [...document.querySelectorAll('[role=status]')].map((s) => s.textContent ?? '').find((t) => labels.has(t))
  const note = () => {
    const l = read()
    if (l && l !== w.__labels.at(-1)?.[1]) w.__labels.push([Date.now(), l])
  }
  note()
  new MutationObserver(note).observe(document, { subtree: true, childList: true, characterData: true })
}
const labelLog = (p: Page) =>
  p.evaluate(() => (window as unknown as { __labels: [number, string][] }).__labels)
/** Labels shown at any moment within [from, to]. */
function labelsDuring(log: [number, string][], from: number, to: number) {
  const before = log.filter(([t]) => t <= from).at(-1)
  return [...(before ? [before[1]] : []), ...log.filter(([t]) => t > from && t <= to).map(([, l]) => l)]
}

test('slow writer and fast writer in the same paragraph converge', async ({ browser }) => {
  test.setTimeout(120_000)
  const { url, ownerEmail, writers } = await room(browser, ['111', '222', '333'], ['Tolu'], true)
  const [a, b] = writers.map((w) => w.page) as [Page, Page]
  await (
    await network(writers[0]!)
  )(SLOW_3G)

  // Same spot: both at the end of the first paragraph, typing at once.
  const a1 = words(320)
  const b1 = words(320, true)
  await caretAtEnd(a, 0)
  await caretAtEnd(b, 0)
  await Promise.all([a.keyboard.type(a1, { delay: 15 }), b.keyboard.type(b1, { delay: 15 })])
  // Different paragraphs, at once. First let the slow side catch up: a click landing while remote keystrokes
  // stream in can be undone by the editor restoring its previous selection (a race the test isn't about).
  await converged([a, b])
  const a2 = words(320)
  const b2 = words(320, true)
  await caretAtEnd(a, 1)
  await caretAtEnd(b, 2)
  await Promise.all([a.keyboard.type(a2, { delay: 15 }), b.keyboard.type(b2, { delay: 15 })])

  const merged = await converged([a, b])
  expect(merged).toHaveLength(3)
  expect(merged[0]!.length, merged[0]).toBe(3 + a1.length + b1.length)
  expect(lower(merged[0]!)).toBe(lower(a1))
  expect(upper(merged[0]!)).toBe(upper(b1))
  expect(merged.slice(1)).toEqual([`222${a2}`, `333${b2}`])
  for (const p of [a, b]) await status(p, 'Saved', 30_000)
  expect(await serverCopy(browser, ownerEmail, url)).toEqual(merged)
  for (const w of writers) await w.ctx.close()
})

test('flapping connection loses nothing', async ({ browser }) => {
  test.setTimeout(120_000)
  const { url, ownerEmail, writers } = await room(browser, ['111', '222'], ['Tolu'], true)
  const [a, b] = writers.map((w) => w.page) as [Page, Page]
  const net = await network(writers[0]!)

  await caretAtEnd(a, 0)
  await caretAtEnd(b, 1)
  let flapping = true
  let typedA = ''
  let typedB = ''
  // Offline/online windows (seconds) adding up to 30 s; the online windows are lossy, not clean.
  const schedule = [3, 2, 4, 5, 2, 3, 4, 2, 5]
  await Promise.all([
    (async () => {
      for (const [i, s] of schedule.entries()) {
        await net(i % 2 === 0 ? OFFLINE : LOSSY)
        await a.waitForTimeout(s * 1_000)
      }
      await net(ONLINE)
      flapping = false
    })(),
    (async () => {
      while (flapping) {
        const w = words(1)
        await a.keyboard.type(w, { delay: 30 })
        typedA += w
      }
    })(),
    (async () => {
      while (flapping) {
        const w = words(1, true)
        await b.keyboard.type(w, { delay: 80 })
        typedB += w
      }
    })(),
  ])

  const merged = await converged([a, b])
  expect(merged).toEqual([`111${typedA}`, `222${typedB}`])
  for (const p of [a, b]) await status(p, 'Saved', 20_000)
  expect(await serverCopy(browser, ownerEmail, url)).toEqual(merged)
  for (const w of writers) await w.ctx.close()
})

test('long offline then reconnect with concurrent remote edits', async ({ browser }) => {
  test.setTimeout(150_000)
  const start = 'Keep this start. '
  const doomed = 'Doomed sentence here. '
  const { url, ownerEmail, writers } = await room(
    browser,
    [`${start}${doomed}Keep this end.`, 'Second paragraph stays.'],
    ['Tolu'],
  )
  const [a, b] = writers.map((w) => w.page) as [Page, Page]
  const net = await network(writers[0]!)
  await a.evaluate(recordLabels)
  const offlineFor = 60_000

  await net(OFFLINE)
  const wentOffline = Date.now()
  // A writes inside the sentence B is about to delete...
  await select(a, 0, `${start}Doomed `.length)
  // No "s" in it: a letter typed just before the same letter is a separate bug (see the next test).
  const inserted = 'willow birch typed offline '
  await a.keyboard.type(inserted, { delay: 20 })
  expect((await text(a))[0]).toBe(`${start}Doomed ${inserted}sentence here. Keep this end.`)
  await status(a, 'Saved on this device')

  // ...which B, online, deletes, and adds to both paragraphs.
  await select(b, 0, start.length, doomed.length)
  expect(await selected(b)).toBe(doomed)
  await b.keyboard.press('Backspace')
  await caretAtEnd(b, 0)
  await b.keyboard.type(' Bee was here.')
  await caretAtEnd(b, 1)
  await b.keyboard.type(' Bee again.')
  expect(await text(b)).toEqual([
    `${start}Keep this end. Bee was here.`,
    'Second paragraph stays. Bee again.',
  ])
  await status(b, 'Saved')

  // A keeps writing a new paragraph for the rest of the minute offline.
  await caretAtEnd(a, 1)
  await a.keyboard.press('Enter')
  let para = ''
  while (Date.now() - wentOffline < offlineFor) {
    const w = words(1)
    await a.keyboard.type(w, { delay: 40 })
    para += w
  }
  await status(a, 'Saved on this device')
  await net(ONLINE)
  const back = Date.now()

  const merged = await converged([a, b], 45_000)
  // CRDT semantics: A's insert inside B's deleted sentence survives as an insert.
  expect(merged).toEqual([
    `${start}${inserted}Keep this end. Bee was here.`,
    'Second paragraph stays. Bee again.',
    para,
  ])
  await status(a, 'Saved', 30_000)
  const saved = (await labelLog(a)).find(([t, l]) => t >= back && l === 'Saved')!
  test.info().annotations.push({
    type: 'reconnect',
    description: `"Saved" ${saved[0] - back} ms after the network returned`,
  })
  expect(await serverCopy(browser, ownerEmail, url)).toEqual(merged)
  for (const w of writers) await w.ctx.close()
})

// Regression (R2-B1, fixed in the y-tiptap patch): the editor→Yjs text diff credited a letter typed right before the
// same letter to the existing one, so a co-writer deleting that letter took the typed one with it.
test('a letter typed offline just before the same letter a co-writer deletes stays put', async ({
  browser,
}) => {
  const start = 'Keep this start. '
  const doomed = 'Doomed sentence here. '
  const { writers } = await room(browser, [`${start}${doomed}Keep this end.`], ['Tolu'])
  const [a, b] = writers.map((w) => w.page) as [Page, Page]
  const net = await network(writers[0]!)

  await net(OFFLINE)
  await select(a, 0, `${start}Doomed `.length)
  await a.keyboard.type('willow words ') // its "s" is typed right before the "s" of "sentence"
  expect((await text(a))[0]).toBe(`${start}Doomed willow words sentence here. Keep this end.`)

  await select(b, 0, start.length, doomed.length)
  expect(await selected(b)).toBe(doomed)
  await b.keyboard.press('Backspace')
  expect(await text(b)).toEqual([`${start}Keep this end.`])
  await status(b, 'Saved')

  await net(ONLINE)
  expect(await converged([a, b])).toEqual([`${start}willow words Keep this end.`])
  for (const w of writers) await w.ctx.close()
})

// Regression (R2-B2): the 1 s "Saving…" delay restarted on every keystroke, so steady typing on a slow link kept
// "Saved" up while words were still in flight.
test('a slow link never says "Saved" while words are still in flight', async ({ browser }) => {
  const { url, ownerEmail, writers } = await room(browser, ['111'], ['Tolu'], true)
  const [a, b] = writers.map((w) => w.page) as [Page, Page]
  const net = await network(writers[0]!)
  await a.evaluate(recordLabels)
  await caretAtEnd(a, 0)

  // Steady typing over a 400 ms round trip: each keystroke is acknowledged long after the next one is sent, so some
  // words are always unconfirmed. "Saving…" may wait 1 s (no flicker), never the whole time.
  await net(SLOW_3G)
  let typed = ''
  const from = Date.now()
  while (Date.now() - from < 8_000) {
    const w = words(1)
    await a.keyboard.type(w, { delay: 40 })
    typed += w
  }
  const to = Date.now()
  const shown = labelsDuring(await labelLog(a), from + 1_500, to)
  await net(ONLINE)

  expect(await converged([a, b])).toEqual([`111${typed}`])
  await status(a, 'Saved')
  expect(await serverCopy(browser, ownerEmail, url)).toEqual([`111${typed}`])
  for (const w of writers) await w.ctx.close()
  expect(shown).not.toContain('Saved')
})

test('status stays honest under chaos', async ({ browser }) => {
  test.setTimeout(120_000)
  const { url, ownerEmail, writers } = await room(browser, ['111', '222'], ['Tolu'], true)
  const [a, b] = writers.map((w) => w.page) as [Page, Page]
  const net = await network(writers[0]!)
  await a.evaluate(recordLabels)
  await caretAtEnd(a, 0)
  let typed = ''

  // Flapping (online windows on a slow link) while typing: every offline window holds unsent words, so it says
  // "Saved on this device" throughout, and it is never left reconnecting.
  const offWindows: [number, number][] = []
  let flapping = true
  const schedule = [3, 2, 4, 5, 2, 3, 4, 2, 5]
  await Promise.all([
    (async () => {
      for (const [i, s] of schedule.entries()) {
        const from = Date.now()
        await net(i % 2 === 0 ? OFFLINE : SLOW_3G)
        await a.waitForTimeout(s * 1_000)
        if (i % 2 === 0) offWindows.push([from, Date.now()])
      }
      await net(ONLINE)
      flapping = false
    })(),
    (async () => {
      while (flapping) {
        const w = words(1)
        await a.keyboard.type(w, { delay: 30 })
        typed += w
      }
    })(),
  ])
  const back = Date.now()
  await status(a, 'Saved', 10_000)

  const log = await labelLog(a)
  for (const [from, to] of offWindows)
    expect.soft(labelsDuring(log, from + 600, to), `offline ${from}–${to}`).toEqual(['Saved on this device'])
  expect.soft(labelsDuring(log, back, Date.now()), 'after the network is back').not.toContain('Offline')
  const stuck = log
    .map(([t, l], i) => ({ l, ms: (log[i + 1]?.[0] ?? Date.now()) - t }))
    .filter(({ l, ms }) => l === 'Reconnecting…' && ms > 10_000)
  expect.soft(stuck, 'Reconnecting… for more than 10 s').toEqual([])

  const merged = await converged([a, b])
  expect(merged).toEqual([`111${typed}`, '222'])
  expect(await serverCopy(browser, ownerEmail, url)).toEqual(merged)
  for (const w of writers) await w.ctx.close()
})

// Regression (R2-B3): coming back online didn't reconnect; the provider's backoff (up to 30 s) decided when.
test('status recovers within 10 s once the network is back after a long outage', async ({ browser }) => {
  test.setTimeout(170_000)
  const { url, ownerEmail, writers } = await room(browser, ['111'], ['Tolu'])
  const [a, b] = writers.map((w) => w.page) as [Page, Page]
  const net = await network(writers[0]!)
  await a.evaluate(recordLabels)

  // Long enough for the provider to give up on the stalled socket (~36–39 s) and back off to its longest waits.
  await net(OFFLINE)
  const off = Date.now()
  await caretAtEnd(a, 0)
  await a.keyboard.type(' offline for a while')
  await status(a, 'Saved on this device')
  await a.waitForTimeout(75_000 - (Date.now() - off))
  expect(labelsDuring(await labelLog(a), off + 1_000, Date.now())).toEqual(['Saved on this device'])
  await net(ONLINE)
  const back = Date.now()
  await status(a, 'Saved', 40_000)
  const recovered = Date.now() - back
  test
    .info()
    .annotations.push({ type: 'recovery', description: `"Saved" ${recovered} ms after the network returned` })

  const merged = await converged([a, b])
  expect(merged).toEqual(['111 offline for a while'])
  expect(await serverCopy(browser, ownerEmail, url)).toEqual(merged)
  for (const w of writers) await w.ctx.close()
  expect(recovered, '"Saved" within 10 s of the network returning').toBeLessThanOrEqual(10_000)
})

test('reconnect storm', async ({ browser }) => {
  test.setTimeout(120_000)
  const { url, ownerEmail, writers } = await room(browser, ['111'], ['Tolu', 'Kemi'])
  const pages = writers.map((w) => w.page)
  const nets = await Promise.all(writers.map(network))
  const tickets = pages.map(() => [] as number[])
  pages.forEach((p, i) =>
    p.on('request', (r) => {
      if (r.method() === 'POST' && r.url().includes('/collab/tickets')) tickets[i]!.push(Date.now())
    }),
  )

  await Promise.all(nets.map((n) => n(OFFLINE)))
  const lines = pages.map((_, i) => `storm line ${i}${words(30)}`)
  for (const [i, p] of pages.entries()) {
    await caretAtEnd(p, 0)
    await p.keyboard.press('Enter')
    await p.keyboard.type(lines[i]!)
    await status(p, 'Saved on this device')
  }
  // Past the provider's 30 s message timeout, so every socket really drops and must reconnect.
  await pages[0]!.waitForTimeout(45_000)
  await Promise.all(nets.map((n) => n(ONLINE)))
  const back = Date.now()

  await Promise.all(pages.map((p) => status(p, 'Saved', 15_000)))
  for (const [i, t] of tickets.entries())
    expect(
      t.filter((at) => at >= back),
      `editor ${i} fresh ticket`,
    ).not.toEqual([])
  const merged = await converged(pages)
  expect(merged[0]).toBe('111')
  expect([...merged.slice(1)].sort()).toEqual([...lines].sort())
  expect(await serverCopy(browser, ownerEmail, url)).toEqual(merged)
  for (const w of writers) await w.ctx.close()
})

// Test 6 (collab server restart) is deferred: it needs its own collab process, which R3 covers.

import { readFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { test } from '@playwright/test'

// 1.5× so the mockups stay crisp on high-density screens without bloating the repository
test.use({ deviceScaleFactor: 1.5 })

/**
 * The README's mockups: real screenshots (docs/images/raw, from capture.spec.ts) set in device frames on Morrow's
 * paper, with the brand's sun and fork, a headline and a few callouts. Rendered at 1600×1000 to docs/images.
 */
const RAW = fileURLToPath(new URL('../../../docs/images/raw/', import.meta.url))
const OUT = fileURLToPath(new URL('../../../docs/images/', import.meta.url))
const FONT = fileURLToPath(new URL('../src/lib/og/InstrumentSerif-Regular.ttf', import.meta.url))

const img = (name: string) => {
  const file = `${RAW}${name}.png`
  return existsSync(file) ? `data:image/png;base64,${readFileSync(file).toString('base64')}` : ''
}
const serif = `data:font/ttf;base64,${readFileSync(FONT).toString('base64')}`

const CSS = `
@font-face { font-family: 'Instrument Serif'; src: url(${serif}); }
* { box-sizing: border-box; margin: 0; }
body { width: 1600px; height: 1000px; overflow: hidden; background: #FBF8F1; color: #22221F;
  font-family: -apple-system, 'Helvetica Neue', Arial, sans-serif; position: relative; }
.serif { font-family: 'Instrument Serif', Georgia, serif; font-weight: 400; }
.kicker { font: 600 14px/1 ui-monospace, 'SF Mono', Menlo, monospace; letter-spacing: .14em; text-transform: uppercase; color: #BD5438; }
h1 { font-family: 'Instrument Serif', Georgia, serif; font-weight: 400; font-size: 76px; line-height: .98; letter-spacing: -.01em; }
h1 em { color: #BD5438; }
p.lede { font-size: 21px; line-height: 1.45; color: #5C5850; max-width: 30ch; }
.laptop { position: absolute; }
.laptop .lid { background: #1D1D1B; border-radius: 22px 22px 6px 6px; padding: 16px 16px 22px; box-shadow: 0 40px 80px rgba(34,34,31,.22), 0 8px 20px rgba(34,34,31,.14); }
.laptop .lid img { display: block; width: 100%; border-radius: 6px; }
.laptop .base { height: 22px; margin: 0 -60px; background: linear-gradient(#D9D4C8, #B9B3A6); border-radius: 0 0 26px 26px; position: relative; }
.laptop .base::after { content: ''; position: absolute; left: 50%; top: 0; width: 160px; height: 9px; margin-left: -80px; background: #A9A396; border-radius: 0 0 10px 10px; }
.browser { position: absolute; background: #fff; border-radius: 14px; overflow: hidden; box-shadow: 0 30px 70px rgba(34,34,31,.18), 0 6px 16px rgba(34,34,31,.10); border: 1px solid rgba(34,34,31,.08); }
.browser .bar { height: 38px; background: #F1EDE4; display: flex; align-items: center; gap: 8px; padding: 0 16px; }
.browser .bar i { width: 12px; height: 12px; border-radius: 12px; background: #DDD6C8; display: block; }
.browser .bar span { margin-left: 18px; flex: 1; height: 22px; border-radius: 11px; background: #fff; font: 12px/22px -apple-system, sans-serif; color: #8A857B; padding-left: 12px; }
.browser img { display: block; width: 100%; }
.phone { position: absolute; background: #1D1D1B; border-radius: 54px; padding: 13px; box-shadow: 0 40px 80px rgba(34,34,31,.25), 0 8px 18px rgba(34,34,31,.14); }
.phone img { display: block; width: 100%; border-radius: 42px; }
.phone::before { content: ''; position: absolute; top: 24px; left: 50%; width: 96px; height: 28px; margin-left: -48px; background: #1D1D1B; border-radius: 20px; z-index: 2; }
.chip { position: absolute; display: flex; align-items: center; gap: 10px; background: #fff; border-radius: 999px; padding: 12px 18px 12px 14px;
  font-size: 16px; font-weight: 600; box-shadow: 0 12px 30px rgba(34,34,31,.14); border: 1px solid rgba(34,34,31,.06); white-space: nowrap; }
.chip b { display: grid; place-items: center; width: 30px; height: 30px; border-radius: 30px; background: #F6E3DA; color: #BD5438; font-size: 15px; }
.call { position: absolute; width: 270px; }
.call h3 { font-family: 'Instrument Serif', Georgia, serif; font-weight: 400; font-size: 27px; line-height: 1.05; }
.call p { margin-top: 6px; font-size: 15.5px; line-height: 1.45; color: #5C5850; }
.call::before { content: ''; display: block; width: 34px; height: 3px; border-radius: 3px; background: #BD5438; margin-bottom: 12px; }
.avatars { display: flex; } .avatars span { width: 34px; height: 34px; border-radius: 34px; border: 3px solid #fff; margin-left: -10px; }
.brand { position: absolute; left: 70px; bottom: 50px; display: flex; align-items: center; gap: 12px; font-family: 'Instrument Serif', Georgia, serif; font-size: 30px; }
.brand i { width: 18px; height: 18px; border-radius: 18px; background: #BD5438; display: block; }
.sun { position: absolute; border-radius: 50%; }
`
const SUN = (x: number, y: number, r: number, c = '#F1C9A8', o = 0.55) =>
  `<div class="sun" style="left:${x - r}px;top:${y - r}px;width:${r * 2}px;height:${r * 2}px;background:${c};opacity:${o}"></div>`
const RINGS = (x: number, y: number) =>
  `<svg style="position:absolute;left:${x - 300}px;top:${y - 300}px" width="600" height="600" viewBox="0 0 600 600" fill="none" stroke="#BD5438" stroke-opacity=".12" stroke-width="2">
    ${[120, 180, 240, 296].map((r) => `<circle cx="300" cy="300" r="${r}"/>`).join('')}</svg>`
const FORK = (x: number, y: number, w = 520) =>
  `<svg style="position:absolute;left:${x}px;top:${y}px" width="${w}" height="120" viewBox="0 0 520 120" fill="none" stroke-linecap="round">
    <path d="M0 90h190c50 0 60-70 120-70h210" stroke="#BD5438" stroke-width="3" stroke-opacity=".5"/>
    <path d="M190 90c50 0 60 20 120 20h210" stroke="#22221F" stroke-width="2" stroke-opacity=".18"/></svg>`
const brand = `<div class="brand"><i></i>Morrow</div>`
const laptop = (src: string, x: number, y: number, w: number) =>
  `<div class="laptop" style="left:${x}px;top:${y}px;width:${w}px"><div class="lid"><img src="${img(src)}"></div><div class="base"></div></div>`
/** A browser window; `crop` trims the screenshot's bottom (never taller than the 16:10 screenshot itself). */
const browser = (src: string, x: number, y: number, w: number, url: string, crop = 0) => {
  const h = Math.min(crop || Infinity, Math.round(w / 1.6) + 38)
  return `<div class="browser" style="left:${x}px;top:${y}px;width:${w}px;height:${h}px"><div class="bar"><i></i><i></i><i></i><span>${url}</span></div><img src="${img(src)}"></div>`
}
const phone = (src: string, x: number, y: number, w = 300, rot = 0) =>
  `<div class="phone" style="left:${x}px;top:${y}px;width:${w}px;transform:rotate(${rot}deg)"><img src="${img(src)}"></div>`
const chip = (x: number, y: number, icon: string, text: string) =>
  `<div class="chip" style="left:${x}px;top:${y}px"><b>${icon}</b>${text}</div>`
const call = (x: number, y: number, title: string, body: string) =>
  `<div class="call" style="left:${x}px;top:${y}px"><h3>${title}</h3><p>${body}</p></div>`
const faces = [
  '#BD5438',
  '#2F5966',
  '#C9A227',
  '#546648',
  '#7A4A68',
  '#E8D9C5',
  '#22221F',
  '#F1C9A8',
  '#C7D3E6',
  '#BFD9D6',
  '#E6CFE0',
  '#F1E2A9',
]
const stack = (n: number) =>
  `<div class="avatars">${faces
    .slice(0, n)
    .map((c) => `<span style="background:${c}"></span>`)
    .join('')}</div>`

const SCENES: Record<string, string> = {
  hero: `${SUN(1330, 980, 420)}${RINGS(1330, 980)}
    <div style="position:absolute;left:70px;top:120px;width:560px">
      <p class="kicker">Morrow · writing, together</p>
      <h1 style="margin-top:22px">Twelve people.<br>One chapter.<br><em>No one waits.</em></h1>
      <p class="lede" style="margin-top:26px">A writing platform where teams draft live, propose and review changes, branch “what if”, and publish to readers who talk back.</p>
      <div style="display:flex;align-items:center;gap:16px;margin-top:34px">${stack(12)}<span style="font-size:16px;color:#5C5850">writing <b style="color:#22221F">The Salt Orchard</b> right now</span></div>
    </div>
    ${laptop('editor-live-12', 640, 120, 900)}
    ${phone('phone-reader', 1300, 430, 250, 4)}
    ${chip(560, 610, '12', 'writing in this chapter')}
    ${chip(1040, 80, '✓', 'Saved · every keystroke')}
    ${brand}`,
  collaboration: `${SUN(80, 960, 300, '#F1E2A9', 0.6)}
    <div style="position:absolute;left:70px;top:70px"><p class="kicker">Real-time collaboration</p>
      <h1 style="margin-top:16px;font-size:60px">Write in the same room,<br><em>from anywhere.</em></h1></div>
    ${laptop('editor-live-12', 70, 250, 1000)}
    ${call(1160, 250, 'Every writer, live', 'Carets and names for each person in the chapter, so nobody writes over anyone. Built on CRDTs (Yjs): edits merge, offline included.')}
    ${call(1160, 440, 'Comments on any passage', 'Select a line, start a thread, @mention a teammate. Threads resolve when the work is done.')}
    ${call(1160, 630, 'Roles that mean something', 'Owner, editors, collaborators, contributors and readers, enforced by one policy on the server and in collab.')}
    ${call(1160, 820, 'Nothing is ever lost', 'Every change saved as you type; named versions, history and restore.')}`,
  review: `${RINGS(1500, 120)}
    <div style="position:absolute;left:70px;top:70px;width:520px"><p class="kicker">Proposals and review</p>
      <h1 style="margin-top:16px;font-size:60px">Nothing changes<br><em>until you say so.</em></h1>
      <p class="lede" style="margin-top:20px">Contributors write in a private copy, or offer the next chapter. You compare, discuss and accept, with every author credited.</p></div>
    ${browser('proposals', 70, 520, 560, 'morrow.app/app/works/the-salt-orchard/proposals', 380)}
    ${browser('proposal', 680, 110, 860, 'morrow.app/app/works/the-salt-orchard/proposals/…', 800)}
    ${FORK(70, 920, 560)}`,
  reading: `${SUN(1500, 90, 260, '#BFD9D6', 0.55)}
    <div style="position:absolute;left:70px;top:90px;width:470px"><p class="kicker">Reading that talks back</p>
      <h1 style="margin-top:16px;font-size:62px">Readers comment<br>on a single line,<br><em>and vote on what if.</em></h1>
      <p class="lede" style="margin-top:22px">Paragraph comments, chapter polls, likes and follows: the loop that brings serial readers back every week.</p></div>
    ${phone('phone-reader', 560, 120, 300, -3)}
    ${phone('phone-paragraph-comments', 900, 90, 300, 0)}
    ${phone('phone-poll', 1240, 140, 300, 3)}
    ${brand}`,
  community: `
    <div style="position:absolute;left:70px;top:70px"><p class="kicker">A community, not a folder</p>
      <h1 style="margin-top:16px;font-size:60px">Publish where <em>readers already are.</em></h1></div>
    ${browser('home', 70, 240, 760, 'morrow.app', 700)}
    ${browser('discover', 870, 210, 660, 'morrow.app/discover', 720)}
    ${chip(700, 900, '★', 'Weekly prompts · streaks · badges · milestones')}`,
  insights: `${SUN(160, 940, 280, '#F1C9A8', 0.5)}
    <div style="position:absolute;left:70px;top:70px"><p class="kicker">Insights</p>
      <h1 style="margin-top:16px;font-size:60px">Know what’s <em>landing.</em></h1></div>
    ${browser('insights', 70, 230, 860, 'morrow.app/app/dashboard', 700)}
    ${browser('activity', 980, 260, 560, 'morrow.app/app/notifications', 640)}`,
  mobile: `${RINGS(240, 860)}
    <div style="position:absolute;left:70px;top:100px;width:520px"><p class="kicker">Built for phones</p>
      <h1 style="margin-top:16px;font-size:62px">The whole studio<br><em>in your pocket.</em></h1>
      <p class="lede" style="margin-top:22px">A toolbar above the keyboard, every block a tap away, panels as sheets you swipe down, and the feed a thumb’s reach from home.</p></div>
    ${phone('phone-editor', 700, 110, 330, -2)}
    ${phone('phone-home', 1110, 150, 330, 3)}
    ${brand}`,
  library: `
    <div style="position:absolute;left:70px;top:70px;width:520px"><p class="kicker">The Morrow Library</p>
      <h1 style="margin-top:16px;font-size:60px">Classics, free to read<br><em>and to retell.</em></h1>
      <p class="lede" style="margin-top:20px">Public-domain books, credited to their authors. Branch one into your own retelling in a click.</p></div>
    ${browser('classics', 620, 120, 920, 'morrow.app/classics', 780)}`,
  enterprise: `${SUN(1420, 980, 360, '#C7D3E6', 0.55)}
    <div style="position:absolute;left:70px;top:70px"><p class="kicker">For teams and organisations</p>
      <h1 style="margin-top:16px;font-size:60px">Serious about <em>access, safety and data.</em></h1></div>
    ${browser('share', 70, 250, 760, 'morrow.app/app/works/the-salt-orchard', 660)}
    ${call(900, 260, 'One access policy', 'Five roles and three collaboration modes, enforced by a single policy in the API and the collaboration service. Read-only means read-only, even on the socket.')}
    ${call(1220, 260, 'Audit trail', 'Every change of visibility, membership and content is an activity event, written in the same transaction.')}
    ${call(900, 470, 'Security by default', 'Nonce-based CSP, same-site cookies and strict Origin checks, rate limits, 2FA (required for staff), short-lived collab tickets.')}
    ${call(1220, 470, 'Your data, your call', 'Full JSON export, real account deletion, private-by-default works, blocks and reports with an appeals process.')}
    ${call(900, 680, 'Moderation built in', 'A staff console with a review queue, hide and restore, account standing, and a record of every decision.')}
    ${call(1220, 680, 'Accessible', 'WCAG 2.2 AA checked with axe on every screen in end-to-end tests; keyboard-only flows tested.')}`,
}

for (const [name, body] of Object.entries(SCENES))
  test(`mockup: ${name}`, async ({ page }) => {
    await page.setViewportSize({ width: 1600, height: 1000 })
    await page.setContent(
      `<!doctype html><html><head><style>${CSS}</style></head><body>${body}</body></html>`,
    )
    await page.evaluate(() => document.fonts.ready)
    await page.waitForTimeout(300)
    await page.screenshot({ path: `${OUT}${name}.png` })
  })

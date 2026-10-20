import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { ImageResponse } from 'next/og'
import type { CoverConfig } from '@morrow/contracts'
import { COVER_PALETTES, Motif } from '@/components/work-cover'

/**
 * Share cards (Open Graph, 1200×630): what a link to Morrow looks like when it's posted elsewhere. A work's card shows
 * its cover beside the title and byline; a writer's card shows their name. Instrument Serif (OFL, bundled here) so it
 * looks like Morrow, not a default.
 */
export const OG_SIZE = { width: 1200, height: 630 }
const PAPER = '#FBF8F1'
const INK = '#22221F'
const CLAY = '#BD5438'
const MUTED = '#6B675F'

let font: Promise<Buffer> | null = null
const serif = () =>
  (font ??= readFile(path.join(process.cwd(), 'src/lib/og/InstrumentSerif-Regular.ttf')).catch((e) => {
    font = null
    throw e
  }))

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s)

/** The book, drawn with boxes (the renderer can't set text inside SVG). */
function Book({ cover, title }: { cover: CoverConfig; title: string }) {
  const p = COVER_PALETTES[cover.palette] ?? COVER_PALETTES[0]
  return (
    <div
      style={{
        width: 300,
        height: 450,
        display: 'flex',
        position: 'relative',
        background: p.ground,
        borderRadius: 6,
        boxShadow: '0 30px 60px rgba(34,34,31,.25)',
        overflow: 'hidden',
      }}
    >
      <div
        style={{
          position: 'absolute',
          left: 0,
          top: 0,
          width: 18,
          height: 450,
          background: 'rgba(0,0,0,.12)',
        }}
      />
      <svg width="300" height="450" viewBox="0 0 120 180" style={{ position: 'absolute', left: 0, top: 0 }}>
        {/* called, not rendered: the image renderer only accepts plain SVG elements inside <svg> */}
        {Motif({ kind: cover.motif, color: p.motif })}
      </svg>
      <div
        style={{
          position: 'absolute',
          left: 44,
          right: 28,
          top: cover.layout === 'band' ? 270 : 60,
          display: 'flex',
          fontSize: 44,
          lineHeight: 1.05,
          color: cover.layout === 'band' ? INK : p.ink,
          background: cover.layout === 'band' ? 'rgba(251,248,241,.92)' : 'transparent',
          padding: cover.layout === 'band' ? '14px 16px' : 0,
          textAlign: cover.layout === 'centered' ? 'center' : 'left',
          justifyContent: cover.layout === 'centered' ? 'center' : 'flex-start',
        }}
      >
        {clip(title, 48)}
      </div>
    </div>
  )
}

function Frame({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        background: PAPER,
        fontFamily: 'Instrument Serif',
        color: INK,
        position: 'relative',
      }}
    >
      {/* the brand's horizon: a low sun at the bottom right */}
      <div
        style={{
          position: 'absolute',
          right: -120,
          bottom: -260,
          width: 520,
          height: 520,
          borderRadius: 520,
          background: '#F1C9A8',
          opacity: 0.5,
        }}
      />
      {children}
      <div
        style={{
          position: 'absolute',
          left: 80,
          bottom: 50,
          display: 'flex',
          alignItems: 'center',
          fontSize: 34,
          color: INK,
        }}
      >
        <div style={{ width: 20, height: 20, borderRadius: 20, background: CLAY, marginRight: 14 }} />
        Morrow
      </div>
    </div>
  )
}

export async function workCard(w: { title: string; kind: string; byline: string; cover: CoverConfig }) {
  return new ImageResponse(
    <Frame>
      <div style={{ display: 'flex', alignItems: 'center', padding: '70px 80px 120px', gap: 64 }}>
        <Book cover={w.cover} title={w.title} />
        <div style={{ display: 'flex', flexDirection: 'column', flex: 1 }}>
          <div style={{ fontSize: 28, color: CLAY, letterSpacing: 2, textTransform: 'uppercase' }}>
            {w.kind}
          </div>
          <div style={{ fontSize: 76, lineHeight: 1.02, marginTop: 16 }}>{clip(w.title, 70)}</div>
          <div style={{ fontSize: 36, color: MUTED, marginTop: 24 }}>{clip(w.byline, 60)}</div>
          <div style={{ fontSize: 30, color: MUTED, marginTop: 40 }}>Read it free on Morrow</div>
        </div>
      </div>
    </Frame>,
    { ...OG_SIZE, fonts: [{ name: 'Instrument Serif', data: await serif(), style: 'normal', weight: 400 }] },
  )
}

export async function textCard(t: { kicker: string; title: string; line?: string }) {
  return new ImageResponse(
    <Frame>
      <div style={{ display: 'flex', flexDirection: 'column', padding: '110px 80px', maxWidth: 1000 }}>
        <div style={{ fontSize: 30, color: CLAY, letterSpacing: 2, textTransform: 'uppercase' }}>
          {t.kicker}
        </div>
        <div style={{ fontSize: 96, lineHeight: 1, marginTop: 20 }}>{clip(t.title, 60)}</div>
        {t.line && <div style={{ fontSize: 40, color: MUTED, marginTop: 28 }}>{clip(t.line, 90)}</div>}
      </div>
    </Frame>,
    { ...OG_SIZE, fonts: [{ name: 'Instrument Serif', data: await serif(), style: 'normal', weight: 400 }] },
  )
}

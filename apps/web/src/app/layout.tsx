import type { Metadata } from 'next'
import { DM_Sans, IBM_Plex_Mono, Instrument_Serif, Literata } from 'next/font/google'
import { connection } from 'next/server'
import './globals.css'
import { Toaster } from '@/components/ui/toast'

// Self-hosted at build time by next/font: no runtime requests to Google. `subsets` only picks what is *preloaded*:
// every subset's @font-face still ships, so latin-ext letters load on demand. Preloading only latin (and not the mono
// face, used for small labels) cut the first visit's font bytes on a phone from 12 files to 5.
const display = Instrument_Serif({
  subsets: ['latin'],
  weight: '400',
  style: ['normal', 'italic'],
  variable: '--nf-display',
})
const manuscript = Literata({
  subsets: ['latin'],
  variable: '--nf-manuscript',
  style: ['normal', 'italic'],
})
const ui = DM_Sans({ subsets: ['latin'], variable: '--nf-ui' })
const mono = IBM_Plex_Mono({
  subsets: ['latin'],
  weight: ['400', '500'],
  variable: '--nf-mono',
  preload: false,
})

export const metadata: Metadata = {
  // Absolute links in share cards and the sitemap: the public address, set per environment.
  metadataBase: new URL(process.env.SITE_URL ?? 'http://localhost:3000'),
  title: { default: 'Morrow', template: '%s · Morrow' },
  description: 'A shared space for words, worlds, and ideas still becoming.',
  openGraph: { siteName: 'Morrow', type: 'website' },
  twitter: { card: 'summary_large_image' },
}

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // Every page renders per request so its scripts carry this request's CSP nonce (src/proxy.ts); a page prerendered
  // at build time would have none, and the policy would block it.
  await connection()
  return (
    <html lang="en" className={`${display.variable} ${manuscript.variable} ${ui.variable} ${mono.variable}`}>
      <body>
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-sm focus:bg-raised focus:px-3 focus:py-2"
        >
          Skip to content
        </a>
        {children}
        <Toaster />
      </body>
    </html>
  )
}

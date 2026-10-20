import type { Metadata } from 'next'
import { DM_Sans, IBM_Plex_Mono } from 'next/font/google'
import './globals.css'

const ui = DM_Sans({ subsets: ['latin', 'latin-ext'], variable: '--nf-ui' })
const mono = IBM_Plex_Mono({ subsets: ['latin'], weight: ['400', '500'], variable: '--nf-mono' })

export const metadata: Metadata = {
  title: { default: 'Morrow Admin', template: '%s · Morrow Admin' },
  robots: { index: false, follow: false },
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${ui.variable} ${mono.variable}`}>
      <body className="bg-app text-primary">{children}</body>
    </html>
  )
}

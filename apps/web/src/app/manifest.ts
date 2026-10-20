import type { MetadataRoute } from 'next'
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Morrow',
    short_name: 'Morrow',
    description: 'A shared space for words, worlds, and ideas still becoming.',
    start_url: '/app/library',
    display: 'standalone',
    background_color: '#FBF8F1',
    theme_color: '#F3EEE4',
    icons: [{ src: '/brand/icon-512.png', sizes: '512x512', type: 'image/png' }],
  }
}

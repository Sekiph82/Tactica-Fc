import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'

// Vercel serves at the root; GitHub Pages sets the repository path in its workflow.
export default defineConfig({
  base: process.env.BASE_PATH ?? (process.env.VERCEL ? '/' : '/tactica-fc/'),
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icon.svg', 'icon-192.png', 'icon-512.png'],
      manifest: {
        name: 'TACTICA FC',
        short_name: 'TACTICA FC',
        description: 'Football management. Your club. Your tactics. Your story.',
        theme_color: '#070b16',
        background_color: '#070b16',
        display: 'standalone',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icon.svg', sizes: 'any', type: 'image/svg+xml' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,json}'],
        // karrierehistorikken hentes først når en spillerprofil åbnes
        globIgnores: ['**/data/careers.json'],
        maximumFileSizeToCacheInBytes: 6 * 1024 * 1024,
        runtimeCaching: [{
          urlPattern: /\/data\/careers\.json$/,
          handler: 'StaleWhileRevalidate',
          options: { cacheName: 'careers', expiration: { maxEntries: 2 } },
        }, {
          urlPattern: /^https:\/\/fonts\.(googleapis|gstatic)\.com\//,
          handler: 'CacheFirst',
          options: { cacheName: 'fonts', expiration: { maxEntries: 30, maxAgeSeconds: 60 * 60 * 24 * 365 }, cacheableResponse: { statuses: [0, 200] } },
        }, {
          urlPattern: /^https:\/\/cdn\.jsdelivr\.net\/gh\/luukhopman\/football-logos/,
          handler: 'CacheFirst',
          options: { cacheName: 'club-logos', expiration: { maxEntries: 600, maxAgeSeconds: 60 * 60 * 24 * 90 }, cacheableResponse: { statuses: [0, 200] } },
        }],
      },
    }),
  ],
  worker: { format: 'es' },
})

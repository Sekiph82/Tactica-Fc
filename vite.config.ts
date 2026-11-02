import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'

// Vercel serves at the root; GitHub Pages sets the repository path in its workflow.
export default defineConfig(({ command }) => ({
  // Local development is served from the origin root (http://localhost:<port>/en).
  // Production builds retain the repository prefix required by GitHub Pages.
  base: process.env.BASE_PATH ?? (process.env.VERCEL || command === 'serve' ? '/' : '/tactica-fc/'),
  // This repository also contains upstream Rust/HTML templates and Android
  // test pages. Keep Vite's dependency scan scoped to the actual React app.
  optimizeDeps: { entries: ['index.html'] },
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: [
        'favicon.ico',
        'tactica-brand/Tactica_FC_Black_Metal.ico',
        'tactica-brand/Tactica_FC_Black_Metal_16x16.png',
        'tactica-brand/Tactica_FC_Black_Metal_32x32.png',
        'tactica-brand/Tactica_FC_Black_Metal_48x48.png',
        'tactica-brand/Tactica_FC_Black_Metal_180x180.png',
        'tactica-brand/Tactica_FC_Black_Metal_192x192.png',
        'tactica-brand/Tactica_FC_Black_Metal_512x512.png',
      ],
      manifest: {
        name: 'TACTICA FC',
        short_name: 'TACTICA FC',
        description: 'Football management. Your club. Your tactics. Your story.',
        theme_color: '#08090c',
        background_color: '#08090c',
        display: 'standalone',
        icons: [
          { src: 'tactica-brand/Tactica_FC_Black_Metal_192x192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: 'tactica-brand/Tactica_FC_Black_Metal_512x512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
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
}))

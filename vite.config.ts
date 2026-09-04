import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const ocrTarget = `http://127.0.0.1:${env.PORT || '8787'}`
  const basePath = env.VITE_BASE_PATH || '/'
  const normalizedBasePath = basePath.replace(/\/$/u, '')
  const apiProxy = {
    '/api': ocrTarget,
    '/api/auth': ocrTarget,
    '/api/ocr': ocrTarget,
    ...(normalizedBasePath
      ? {
        [`${normalizedBasePath}/api/auth`]: {
          target: ocrTarget,
          rewrite: (path: string) => path.slice(normalizedBasePath.length),
        },
        [`${normalizedBasePath}/api/ocr`]: {
          target: ocrTarget,
          rewrite: (path: string) => path.slice(normalizedBasePath.length),
        },
      }
      : {}),
  }

  return {
    base: basePath,
    server: {
      proxy: apiProxy,
    },
    preview: {
      allowedHosts: true,
      proxy: apiProxy,
    },
    plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.ico', 'apple-touch-icon.png'],
      manifest: {
        name: 'Milk Collection App',
        short_name: 'MilkApp',
        description: 'Mobile milk collection management with offline support',
        theme_color: '#1a6b3c',
        background_color: '#ffffff',
        display: 'standalone',
        orientation: 'portrait',
        scope: basePath,
        start_url: basePath,
        icons: [
          {
            src: 'pwa-192x192.png',
            sizes: '192x192',
            type: 'image/png',
          },
          {
            src: 'pwa-512x512.png',
            sizes: '512x512',
            type: 'image/png',
          },
          {
            src: 'pwa-512x512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'any maskable',
          },
        ],
      },
      workbox: {
        cleanupOutdatedCaches: true,
        clientsClaim: true,
        skipWaiting: true,
        globPatterns: ['**/*.{js,css,html,ico,png,svg,woff2}'],
        runtimeCaching: [
          {
            urlPattern: /^https:\/\/api\./,
            handler: 'NetworkFirst',
            options: {
              cacheName: 'api-cache',
              expiration: {
                maxEntries: 100,
                maxAgeSeconds: 60 * 60 * 24,
              },
            },
          },
        ],
      },
    }),
    ],
  }
})

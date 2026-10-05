import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

// Regex per riconoscere i moduli di node_modules su Windows e POSIX
const nm = (pattern: string) => new RegExp(`[\\/]node_modules[\\/]${pattern}`);

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      // "prompt": il service worker nuovo resta in attesa finché l'utente non conferma
      registerType: 'prompt',
      includeAssets: ['favicon.svg'],
      manifest: {
        name: 'WebCAD',
        short_name: 'WebCAD',
        description: 'Modellazione 3D rapida per la stampa 3D',
        lang: 'it',
        theme_color: '#14171c',
        background_color: '#14171c',
        display: 'standalone',
        icons: [
          { src: 'pwa-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'pwa-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'pwa-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        // Elenco completo: js, css, html e il WASM di manifold (circa 540 KB)
        globPatterns: ['**/*.{js,css,html,wasm,svg,png,ico,webmanifest}'],
        maximumFileSizeToCacheInBytes: 5 * 1024 * 1024,
      },
    }),
  ],
  // Il glue Emscripten di manifold cerca il .wasm con import.meta.url: niente pre-bundle
  optimizeDeps: { exclude: ['manifold-3d'] },
  worker: { format: 'es' },
  build: {
    // three.js da solo pesa circa 740 KB (187 KB gzip): è atteso, vive in un chunk dedicato e cacheabile
    chunkSizeWarningLimit: 800,
    rolldownOptions: {
      output: {
        // Chunk separati e cacheabili; priority più alta vince quando più gruppi corrispondono
        codeSplitting: {
          groups: [
            { name: 'react', test: nm('(react|react-dom|scheduler)[\\/]'), priority: 40, includeDependenciesRecursively: false },
            { name: 'r3f', test: nm('@react-three[\\/]'), priority: 30, includeDependenciesRecursively: false },
            { name: 'three', test: nm('three[\\/]'), priority: 20, includeDependenciesRecursively: false },
            { name: 'vendor', test: nm(''), priority: 10 },
          ],
        },
      },
    },
  },
  test: { environment: 'node', include: ['src/**/*.test.ts'] },
});

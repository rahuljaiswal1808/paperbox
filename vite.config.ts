import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

/**
 * Public path the app is served from.
 *
 * Root by default (any static host, `vite preview`, a local file server). On
 * GitHub Pages a project site lives under `/<repo>/`, so the deploy workflow
 * passes that in as PAGES_BASE. Everything that builds a URL at runtime goes
 * through `import.meta.env.BASE_URL`, so this single value is enough.
 */
const base = (() => {
  const raw = process.env.PAGES_BASE ?? process.env.VITE_BASE ?? '/';
  if (!raw || raw === '/') return '/';
  return raw.endsWith('/') ? raw : `${raw}/`;
})();

export default defineConfig({
  base,
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg', 'pdfjs/**/*'],
      manifest: {
        name: 'Paperbox — Local PDF Workspace',
        short_name: 'Paperbox',
        description:
          'A complete PDF workspace that runs on your machine. Edit, sign, merge, split, convert and protect PDFs entirely offline.',
        theme_color: '#0e1116',
        background_color: '#0e1116',
        display: 'standalone',
        // Relative so the installed app works under a subdirectory too.
        start_url: '.',
        scope: base,
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        // pdf.js ships large wasm/font assets; they must be precached for offline use.
        maximumFileSizeToCacheInBytes: 12 * 1024 * 1024,
        globPatterns: ['**/*.{js,mjs,css,html,svg,png,ico,wasm,bcmap,pfb,icc}'],
        navigateFallbackDenylist: [/^\/api\//],
      },
      devOptions: { enabled: false },
    }),
  ],
  worker: { format: 'es' },
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 2500,
  },
  optimizeDeps: {
    // The pdf.js worker is loaded as a URL, not pre-bundled.
    exclude: ['pdfjs-dist/legacy/build/pdf.worker.mjs'],
  },
});

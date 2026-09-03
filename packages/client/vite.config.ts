import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { cdnExternalization } from './vite-cdn.ts'

const boardSchema = readFileSync(
  fileURLToPath(new URL('../shared/board-config.schema.json', import.meta.url)),
  'utf8',
)

/**
 * The `base` is a sentinel, not a URL, and it is set unconditionally — in dev as well as in the
 * production build.
 *
 * That uniformity is the point: the server's only rewriting is one string replacement, and it
 * works identically against a published build and against this dev server. Vite serves its dev
 * index at `/__ASSET_PATH__/index.html` with every module URL under the same prefix, so pointing
 * ASSET_PATH at `http://localhost:5173/__ASSET_PATH__` exercises the real rendering path with HMR
 * intact.
 *
 * The published artifact therefore contains no environment-specific value anywhere — which is
 * what lets one build serve any environment.
 */
export default defineConfig({
  define: {
    'import.meta.env.RELEASE_VERSION': JSON.stringify(process.env.RELEASE_VERSION ?? 'dev'),
  },
  base: '/__ASSET_PATH__/',
  plugins: [
    cdnExternalization(),
    react(),
    {
      name: 'emit-board-config-schema',
      generateBundle() {
        this.emitFile({ type: 'asset', fileName: 'board-config.schema.json', source: boardSchema })
      },
    },
  ],
  server: {
    port: 5173,
    strictPort: true,
    // The server fetches this template cross-origin during local development.
    cors: true,
  },
  preview: {
    // The browser runs in the Playwright container while this preview server remains on the host.
    allowedHosts: ['host.docker.internal'],
  },
  build: {
    // A published version is immutable, so a stale manifest is worth catching loudly.
    manifest: true,
    sourcemap: true,
  },
})

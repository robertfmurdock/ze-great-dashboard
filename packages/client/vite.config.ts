import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { cdnExternalization } from './vite-cdn.ts'

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
  base: '/__ASSET_PATH__/',
  plugins: [cdnExternalization(), react()],
  server: {
    port: 5173,
    strictPort: true,
    // The server fetches this template cross-origin during local development.
    cors: true,
  },
  build: {
    // A published version is immutable, so a stale manifest is worth catching loudly.
    manifest: true,
    sourcemap: true,
  },
})

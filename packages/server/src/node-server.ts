import { serve } from '@hono/node-server'
import { startup } from './startup.ts'

/**
 * The container / local entry point. `docker compose up` and `npm run dev` both land here.
 */
const { app, config } = await startup().catch((error: unknown) => {
  console.error(`\n${error instanceof Error ? error.message : String(error)}\n`)
  process.exit(1)
})

serve({ fetch: app.fetch, port: config.port, hostname: config.host }, (info) => {
  console.log(`Trust dashboard listening on http://${config.host}:${info.port}`)
  console.log(`  board:      ${config.board}`)
  console.log(`  assetPath:  ${config.assetPath}`)
})

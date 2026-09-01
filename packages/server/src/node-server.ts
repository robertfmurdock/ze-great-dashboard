import { serve } from '@hono/node-server'
import { consoleLogger } from './logger.ts'
import { startup } from './startup.ts'

/**
 * The container / local entry point. `docker compose up` and `npm run dev` both land here.
 */
const { app, config } = await startup().catch((_error: unknown) => {
  process.exit(1)
})

serve({ fetch: app.fetch, port: config.port, hostname: config.host }, (info) => {
  consoleLogger.log({
    event: 'server.ready',
    board: config.board ?? 'unknown',
    host: config.host,
    port: info.port,
  })
})

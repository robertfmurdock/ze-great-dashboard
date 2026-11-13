import { serve } from '@hono/node-server'
import { startHostedDeployments } from './hosted-deployments.ts'
import { consoleLogger, serverReadyEvent } from './logger.ts'
import { startup } from './startup.ts'

/**
 * The container / local entry point. `docker compose up` and `npm run dev` both land here.
 */
const hostsFile = process.env.DASHBOARD_HOSTS_FILE
const { fetch, config } =
  hostsFile === undefined
    ? await startup().then(({ app, config }) => ({ fetch: app.fetch, config }))
    : await startHostedDeployments(hostsFile)

serve({ fetch, port: config.port, hostname: config.host }, (info) => {
  consoleLogger.log(
    serverReadyEvent({
      board: config.board ?? 'unknown',
      host: config.host,
      port: info.port,
      serverVersion: config.serverRelease,
    }),
  )
})

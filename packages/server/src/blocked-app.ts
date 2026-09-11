import { Hono } from 'hono'
import type { AppEnvironment } from './app.ts'

/** A deliberately capability-free app for a required-auth configuration failure. */
export function createBlockedApp(): Hono<AppEnvironment> {
  const app = new Hono<AppEnvironment>()
  app.get('/health', (c) => c.json({ status: 'ok' }))
  app.all('/api/*', (c) =>
    c.json({ error: 'Dashboard authentication is required but is not configured.' }, 503, {
      'cache-control': 'no-store',
    }),
  )
  const blocked = () =>
    new Response(blockedEntrypoint(), {
      status: 503,
      headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' },
    })
  app.get('/', blocked)
  app.get('/boards/:board', blocked)
  return app
}

function blockedEntrypoint(): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Dashboard unavailable</title><style>body{margin:0;background:#12140f;color:#f4f2e8;font:clamp(18px,2vw,28px)/1.45 system-ui,sans-serif}main{max-width:42rem;margin:12vh auto;padding:2rem;border:4px solid #e05252;background:#1c1f18}h1{margin-top:0;color:#ff9b8e}a{color:#f4f2e8}</style></head><body><main role="alert"><h1>⚠ Authentication configuration required</h1><p>This dashboard is blocked because authentication is required but has not been configured.</p><p>No dashboard data was loaded.</p><p>Configure the board’s <code>auth</code> block, then restart the dashboard. <a href="https://github.com/robertfmurdock/ze-great-dashboard/blob/main/docs/oidc-authentication.md">Read the authentication setup guide</a>.</p></main></body></html>`
}

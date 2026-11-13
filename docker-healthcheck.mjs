import { createConnection } from 'node:net'

const port = Number(process.env.PORT ?? 3000)

if (process.env.DASHBOARD_HOSTS_FILE !== undefined) {
  // The listener opens only after every configured host finishes startup.
  const socket = createConnection({ host: '127.0.0.1', port })
  socket.once('connect', () => socket.end())
  socket.once('error', () => process.exit(1))
} else {
  const response = await fetch(`http://127.0.0.1:${port}/health`).catch(() => null)
  if (!response?.ok) process.exit(1)
}

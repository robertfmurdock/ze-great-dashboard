import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import { createServer, type Server } from 'node:http'
import { join, normalize } from 'node:path'

export type StaticServer = {
  /** The origin the fixtures are published at, e.g. `http://127.0.0.1:54321`. */
  origin: string
  close: () => Promise<void>
}

/**
 * Serves a directory over real HTTP on an ephemeral port.
 *
 * The IWA test uses this instead of a stubbed fetch so the thing under test is the actual
 * "published client at a URL" arrangement — the property being proven is about fetching a
 * template from somewhere else, and a mock would quietly assume the part that matters.
 */
export async function startStaticServer(rootDir: string): Promise<StaticServer> {
  const server = createServer((req, res) => {
    // Resolve inside rootDir; a fixture server is still not an excuse for path traversal.
    const requestPath = normalize(decodeURIComponent(new URL(req.url ?? '/', 'http://x').pathname))
    const filePath = join(rootDir, requestPath)

    if (!filePath.startsWith(rootDir)) {
      res.writeHead(403).end('forbidden')
      return
    }

    stat(filePath)
      .then((stats) => {
        if (!stats.isFile()) {
          res.writeHead(404).end('not found')
          return
        }
        res.writeHead(200, { 'content-type': contentTypeFor(filePath) })
        createReadStream(filePath).pipe(res)
      })
      .catch(() => {
        res.writeHead(404).end('not found')
      })
  })

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))

  return {
    origin: `http://127.0.0.1:${addressPort(server)}`,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()))
      }),
  }
}

function addressPort(server: Server): number {
  const address = server.address()
  if (address === null || typeof address === 'string') {
    throw new Error('Static fixture server did not bind to a TCP port.')
  }
  return address.port
}

function contentTypeFor(filePath: string): string {
  if (filePath.endsWith('.html')) return 'text/html; charset=utf-8'
  if (filePath.endsWith('.js')) return 'text/javascript; charset=utf-8'
  if (filePath.endsWith('.css')) return 'text/css; charset=utf-8'
  return 'application/octet-stream'
}

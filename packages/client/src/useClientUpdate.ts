import { type ClientEnv, clientIdentitySchema } from '@ze-great-dashboard/shared'
import { useEffect } from 'react'
import type { DiagnosticSink } from './diagnostics.ts'

const clientUpdateIntervalMillis = 60_000
const clientUpdateTimeoutMillis = 10_000
const defaultReload = () => globalThis.window.location.reload()

export function useClientUpdate({
  env,
  diagnostics,
  fetcher,
  reload = defaultReload,
}: {
  env: ClientEnv
  diagnostics: DiagnosticSink
  fetcher?: typeof fetch
  reload?: () => void
}) {
  useEffect(() => {
    let cancelled = false
    let inFlight = false
    let activeController: AbortController | undefined
    const path = `${env.proxyPath}/client`

    const check = async () => {
      if (cancelled || inFlight) return
      inFlight = true
      const controller = new AbortController()
      activeController = controller
      const timeout = globalThis.setTimeout(() => controller.abort(), clientUpdateTimeoutMillis)
      diagnostics.record({ kind: 'client-update-check', path })
      try {
        const response = await (fetcher ?? globalThis.fetch)(path, {
          cache: 'no-store',
          signal: controller.signal,
        })
        if (!response.ok) throw new Error(`Client identity returned ${response.status}`)
        const parsed = clientIdentitySchema.safeParse(await response.json())
        if (!parsed.success) throw new Error('Client identity response was invalid')
        if (cancelled) return
        if (parsed.data.assetPath !== env.assetPath) {
          diagnostics.record({
            kind: 'client-update-detected',
            path,
            current: { assetPath: env.assetPath },
            next: parsed.data,
          })
          reload()
        }
      } catch (error) {
        if (!cancelled && !(error instanceof DOMException && error.name === 'AbortError')) {
          diagnostics.record({
            kind: 'client-update-failure',
            path,
            message: error instanceof Error ? error.message : String(error),
          })
        }
      } finally {
        globalThis.clearTimeout(timeout)
        inFlight = false
        if (activeController === controller) activeController = undefined
        if (!cancelled) globalThis.setTimeout(() => void check(), clientUpdateIntervalMillis)
      }
    }

    void check()
    return () => {
      cancelled = true
      activeController?.abort()
    }
  }, [diagnostics, env.assetPath, env.proxyPath, fetcher, reload])
}

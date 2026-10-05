import type { BoardConfig } from '@ze-great-dashboard/shared'
import { createApp } from '../src/app.ts'
import { loadConfig } from '../src/config.ts'
import type { CredentialResolver } from '../src/credentials.ts'

/**
 * A controlled, route-level definition for the public pipeline-status contract. Provider tests
 * retain ownership of real response shapes and provider-specific behavior; this deliberately
 * supplies only the minimum valid response needed to exercise the common proxy boundary.
 */
export type PipelineAdapterContract = {
  name: string
  boardConfig: BoardConfig
  credentials: CredentialResolver
  successfulUpstream: unknown
  expected: {
    panelId: string
    status: 'passed' | 'failed' | 'warning' | 'running' | 'cancelled' | 'unknown'
    sourceRunId: string
    link: string
  }
}

export function pipelineAdapterApp(adapter: PipelineAdapterContract, fetcher: typeof fetch) {
  return createApp({
    config: loadConfig({ ASSET_PATH: 'https://assets.example.test/dashboard/controlled' }),
    boardConfig: adapter.boardConfig,
    credentials: adapter.credentials,
    fetcher,
  })
}

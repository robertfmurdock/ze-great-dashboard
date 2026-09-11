import type { BoardConfig, ClientSecurityState } from '@ze-great-dashboard/shared'
import { isLocalHost, type ServerConfig } from './config.ts'

/** Internal result of policy resolution; only notices cross the browser boundary. */
export type DeploymentSecurityState = 'normal' | ClientSecurityState

/** Resolve posture before credentials, OIDC, templates, or source adapters are initialized. */
export function deploymentSecurityState(
  config: ServerConfig,
  boardConfig: BoardConfig,
): DeploymentSecurityState {
  if (boardConfig.auth || boardConfig.security === 'unsecured' || isLocalHost(config.host))
    return 'normal'
  if (boardConfig.security === 'required') return 'blocked'
  return config.allowUnprotectedDashboard ? 'normal' : 'warning'
}

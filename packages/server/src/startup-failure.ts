import { type ConfigurationDiagnostic, ConfigurationError } from './configuration-error.ts'

export type StartupFailureCategory =
  | 'configuration'
  | 'template'
  | 'board-config'
  | 'credentials'
  | 'authentication'
  | 'unknown'

/** The only startup failure fields that may leave the process. */
export type StartupFailureDiagnostic = {
  category: StartupFailureCategory
  supportReference: string
  configuration?: ConfigurationDiagnostic[]
}

export class StartupFailure extends Error {
  readonly diagnostic: StartupFailureDiagnostic

  constructor(category: StartupFailureCategory, cause: unknown) {
    super(cause instanceof Error ? cause.message : 'Dashboard startup failed', { cause })
    this.name = 'StartupFailure'
    this.diagnostic = {
      category,
      supportReference: crypto.randomUUID(),
      ...(cause instanceof ConfigurationError ? { configuration: cause.diagnostics } : {}),
    }
  }
}

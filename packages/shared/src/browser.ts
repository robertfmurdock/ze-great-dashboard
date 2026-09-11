/**
 * Browser-safe shared contract. Keep source adapters and their operational defaults out of this
 * entrypoint: immutable browser assets may render public board data but must not carry upstream
 * implementation configuration.
 */
export type {
  AttentionTreatment,
  Board,
  BoardConfig,
  HttpValueFact,
  HttpValueGroupedPanel,
  HttpValueScalarPanel,
  Panel,
  PanelDensity,
  Position,
} from './board-config.ts'
export {
  type ClientEnv,
  type ClientIdentityResponse,
  type ClientSecurityState,
  clientEnvSchema,
  clientIdentityResponseSchema,
  clientSecurityStateSchema,
  clientSecurityStates,
  readClientEnv,
} from './client-env.ts'
export { type Duration, durationSchema, parseDuration } from './duration.ts'
export {
  type Envelope,
  type ErrorEnvelope,
  type ErrorKind,
  envelopeSchema,
  errorKindSchema,
  type HttpValue,
  httpValueSchema,
  type OkEnvelope,
  type PipelineActivity,
  type PipelineStatus,
  type PullRequestBuildObservation,
  type PullRequestCandidate,
  type PullRequestCandidates,
  type PullRequestHealth,
  type PullRequestWorkflowObservation,
  pipelineActivitySchema,
  pipelineStatusPriority,
  pipelineStatusSchema,
  pullRequestBuildObservationSchema,
  pullRequestCandidateSchema,
  pullRequestCandidatesSchema,
  pullRequestHealthSchema,
  pullRequestWorkflowObservationSchema,
} from './envelope.ts'
export { analyzeBoardLayout, isZeroPosition, normalizeBoardLayout } from './layout.ts'
export { type PollingSettings, pollingDefaults, resolvePollingSettings } from './polling-policy.ts'
export { type RunningAnimation, visibleRunningAnimations } from './running-animations.ts'

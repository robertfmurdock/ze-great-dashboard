import { z } from 'zod'
import { durationSchema } from './duration.ts'

/**
 * The board config schema.
 *
 * This is deliberately the *only* definition of this shape in the project. The proxy derives
 * its permitted-call allowlist from this config and the client renders from it, so the two
 * agreeing is security-relevant rather than merely convenient — see "The proxy exposes named
 * operations, not arbitrary URLs" in the design doc.
 *
 * Signal-specific panel fields are intentionally loose at this stage. `id` and `type` are the
 * only universally required fields; Stage 2 tightens each signal type into its own variant as
 * the adapters that consume those fields arrive. Tightening later is safe; guessing the shape
 * now and building the allowlist on the guess is not.
 */

export const positionSchema = z.union([
  z.object({
    x: z.number().int().min(0),
    y: z.number().int().min(0),
    w: z.number().int().min(1).max(12),
    h: z.number().int().min(1),
  }),
  z.object({ x: z.literal(0), y: z.literal(0), w: z.literal(0), h: z.literal(0) }),
])

export type Position = z.infer<typeof positionSchema>

export const panelDensities = ['auto', 'comfortable', 'compact'] as const
export const panelDensitySchema = z.enum(panelDensities)
export type PanelDensity = z.infer<typeof panelDensitySchema>

/** A deliberately small, comparable set of visible active-run treatments. */
export const visibleRunningAnimations = [
  'radial',
  'runway',
  'orbit',
  'signal-field',
  'telemetry-bloom',
  'release-transit',
  'status-weather',
  'falling-shapes',
] as const

export const runningAnimationSchema = z.enum([...visibleRunningAnimations, 'off'])
export type RunningAnimation = z.infer<typeof runningAnimationSchema>

export const panelSchema = z
  .looseObject({
    /** Presentation-only wall label. `id` remains the stable proxy and allowlist address. */
    label: z.string().min(1).optional(),
    id: z.string().min(1),
    type: z.string().min(1),
    source: z.string().min(1).optional(),
    pipeline: z.union([z.string(), z.number()]).optional(),
    /** Resolved public source branch, supplied by the board endpoint for client memory scoping. */
    branch: z.string().min(1).optional(),
    /** Content-density bias; position still controls the panel's explicit grid placement. */
    density: panelDensitySchema.optional(),
    /** Advisory in v1 — a panel without a position renders in config order rather than not at all. */
    position: positionSchema.optional(),
    refresh: durationSchema.optional(),
    /** Active pipeline runs are checked more often than normal panels. */
    running_refresh: durationSchema.optional(),
    /** Polling cadence around the estimated completion boundary. */
    running_completion_refresh: durationSchema.optional(),
    /** Maximum length of the tighter completion polling burst. */
    running_completion_window: durationSchema.optional(),
    /** Optional active-run treatment. Omitted selects a visible treatment at random. */
    running_animation: runningAnimationSchema.optional(),
    /** Local animation-demo cycle duration; ignored by other panel types. */
    demo_run_duration: durationSchema.optional(),
    /** Local animation-demo focused-review duration; ignored by other panel types. */
    demo_review_duration: durationSchema.optional(),
    /** A deliberate override only. Adapters derive links; hand-written ones drift. */
    link: z.url().optional(),
    /** Source-agnostic endpoint used by the http-value signal. */
    url: z.url().optional(),
    /** Small, deliberate JSON path subset: $.version, $.deployment.version, or $.response.docs[0].latestVersion. */
    json_path: z
      .string()
      .regex(/^\$(?:\.[A-Za-z_][A-Za-z0-9_]*|\[\d+\])*$/, 'must be a simple JSON path')
      .optional(),
  })
  .superRefine((panel, ctx) => {
    if ('display' in panel) {
      ctx.addIssue({
        code: 'custom',
        path: ['display'],
        message: 'display was removed; use density',
      })
    }
  })

export type Panel = z.infer<typeof panelSchema>

export const githubAppSchema = z.object({
  app_id_env: z.string().min(1),
  private_key_env: z.string().min(1),
  installation_id_env: z.string().min(1),
})

const sourceAuthenticationSchema = {
  /** Credentials are never in the config — only the name of the env var holding one. */
  token_env: z.string().min(1).optional(),
  github_app: githubAppSchema.optional(),
}

function exactlyOneGithubAuthenticationMode(
  source: { token_env?: string; github_app?: unknown },
  ctx: z.RefinementCtx,
) {
  if (source.token_env && source.github_app)
    ctx.addIssue({ code: 'custom', message: 'configure token_env or github_app, not both' })
}

export const githubActionsSourceSchema = z
  .looseObject({
    type: z.literal('github-actions'),
    repo: z.string().regex(/^[^/\s]+\/[^/\s]+$/, 'must be an owner/repository pair'),
    /** The branch whose workflow health the dashboard represents. */
    branch: z.string().min(1).optional(),
    ...sourceAuthenticationSchema,
  })
  .superRefine(exactlyOneGithubAuthenticationMode)

export type GithubActionsSource = z.infer<typeof githubActionsSourceSchema>

export const azureDevOpsSourceSchema = z.looseObject({
  type: z.literal('azure-devops'),
  /** Azure DevOps organization name, used as one URL path segment. */
  organization: z.string().regex(/^[^/\s]+$/, 'must be an organization name'),
  project: z.string().min(1),
  /** The branch whose build health the dashboard represents. */
  branch: z.string().min(1).optional(),
  /** Azure DevOps Build API access is authenticated with a read-scoped PAT. */
  token_env: z.string().min(1),
})

export type AzureDevOpsSource = z.infer<typeof azureDevOpsSourceSchema>

export const sourceSchema = z
  .looseObject({ type: z.string().min(1), ...sourceAuthenticationSchema })
  .superRefine(exactlyOneGithubAuthenticationMode)

export type Source = z.infer<typeof sourceSchema>

/** Every credential name declared by a source, with no credential values exposed. */
export function credentialEnvironmentNames(source: Source): string[] {
  const githubApp = githubAppSchema.safeParse(source.github_app)
  return [
    ...(source.token_env ? [source.token_env] : []),
    ...(githubApp.success
      ? [
          githubApp.data.app_id_env,
          githubApp.data.private_key_env,
          githubApp.data.installation_id_env,
        ]
      : []),
  ]
}

export const boardSchema = z.object({
  refresh: durationSchema.optional(),
  running_refresh: durationSchema.optional(),
  running_completion_refresh: durationSchema.optional(),
  running_completion_window: durationSchema.optional(),
  panels: z
    .array(panelSchema)
    .min(1)
    .superRefine((panels, ctx) => {
      // Panel ids address a panel in the proxy URL and key the allowlist. Duplicates resolving
      // to "whichever came first" would silently repoint a URL, so they fail loudly instead.
      const seen = new Map<string, number>()
      panels.forEach((panel, index) => {
        const firstIndex = seen.get(panel.id)
        if (firstIndex === undefined) {
          seen.set(panel.id, index)
          return
        }
        ctx.addIssue({
          code: 'custom',
          path: [index, 'id'],
          message: `duplicate panel id "${panel.id}" (already used by panel at index ${firstIndex})`,
        })
      })
    }),
})

export type Board = z.infer<typeof boardSchema>

export const authSchema = z.object({
  issuer: z.url(),
  /** Absent in gateway mode — the gateway does the flow, the proxy still validates. */
  client_id: z.string().min(1).optional(),
  allow: z
    .object({
      groups: z.array(z.string().min(1)).optional(),
      subjects: z.array(z.string().min(1)).optional(),
    })
    .optional(),
})

export type Auth = z.infer<typeof authSchema>

export const boardConfigSchema = z
  .object({
    sources: z.record(z.string().min(1), sourceSchema).default({}),
    boards: z.record(z.string().min(1), boardSchema),
    auth: authSchema.optional(),
  })
  .superRefine((config, ctx) => {
    for (const [sourceName, source] of Object.entries(config.sources)) {
      if (source.type !== 'azure-devops') continue
      const parsedSource = azureDevOpsSourceSchema.safeParse(source)
      if (!parsedSource.success) {
        for (const issue of parsedSource.error.issues) {
          ctx.addIssue({
            code: 'custom',
            path: ['sources', sourceName, ...issue.path],
            message: issue.message,
          })
        }
      }
    }
    for (const [boardName, board] of Object.entries(config.boards)) {
      board.panels.forEach((panel, panelIndex) => {
        const source = panel.source ? config.sources[panel.source] : undefined
        if (panel.type !== 'pipeline-status' || source?.type !== 'azure-devops') return
        if (
          typeof panel.pipeline !== 'number' ||
          !Number.isInteger(panel.pipeline) ||
          panel.pipeline <= 0
        ) {
          ctx.addIssue({
            code: 'custom',
            path: ['boards', boardName, 'panels', panelIndex, 'pipeline'],
            message:
              'Azure DevOps pipeline-status panels require a positive numeric pipeline definition id',
          })
        }
      })
    }
  })

export type BoardConfig = z.infer<typeof boardConfigSchema>

/**
 * Resolves a panel's refresh interval across the three parties who have a say: the board
 * author's default, their per-panel override, and the adapter's floor which clamps both.
 * The floor exists so knowing each upstream's rate limit isn't the board author's problem.
 */
export function resolveRefreshMillis(args: {
  boardDefaultMillis: number
  panelOverrideMillis?: number | undefined
  adapterFloorMillis: number
}): number {
  const requested = args.panelOverrideMillis ?? args.boardDefaultMillis
  return Math.max(requested, args.adapterFloorMillis)
}

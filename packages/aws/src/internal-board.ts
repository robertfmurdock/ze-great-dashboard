import { z } from 'zod'

const durationSchema = z
  .string()
  .regex(/^\d+(?:ms|s|m|h)$/)
  .refine((value) => Number.parseInt(value, 10) > 0)
  .brand<'Duration'>()
const positionSchema = z.union([
  z.object({
    x: z.number().int().min(0),
    y: z.number().int().min(0),
    w: z.number().int().min(1).max(12),
    h: z.number().int().min(1),
  }),
  z.object({ x: z.literal(0), y: z.literal(0), w: z.literal(0), h: z.literal(0) }),
])
const panelSchema = z
  .looseObject({
    // Presentation-only; ids still address proxy calls and the generated allowlist.
    label: z.string().min(1).optional(),
    id: z.string().min(1),
    type: z.string().min(1),
    source: z.string().min(1).optional(),
    density: z.enum(['auto', 'comfortable', 'compact']).optional(),
    position: positionSchema.optional(),
    refresh: durationSchema.optional(),
    link: z.url().optional(),
    url: z.url().optional(),
    json_path: z
      .string()
      .regex(/^\$(?:\.[A-Za-z_][A-Za-z0-9_]*|\[\d+\])*$/)
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
const sourceSchema = z
  .looseObject({
    type: z.string().min(1),
    token_env: z.string().min(1).optional(),
    github_app: z
      .object({
        app_id_env: z.string().min(1),
        private_key_env: z.string().min(1),
        installation_id_env: z.string().min(1),
      })
      .optional(),
  })
  .superRefine((source, ctx) => {
    if (source.token_env && source.github_app)
      ctx.addIssue({ code: 'custom', message: 'configure token_env or github_app, not both' })
  })
const boardSchema = z.object({
  refresh: durationSchema.optional(),
  panels: z
    .array(panelSchema)
    .min(1)
    .superRefine((panels, ctx) => {
      const seen = new Map<string, number>()
      panels.forEach((panel, index) => {
        const firstIndex = seen.get(panel.id)
        if (firstIndex === undefined) seen.set(panel.id, index)
        else
          ctx.addIssue({
            code: 'custom',
            path: [index, 'id'],
            message: `duplicate panel id "${panel.id}" (already used by panel at index ${firstIndex})`,
          })
      })
    }),
})

export const boardConfigSchema = z.object({
  sources: z.record(z.string().min(1), sourceSchema).default({}),
  boards: z.record(z.string().min(1), boardSchema),
  auth: z
    .object({
      issuer: z.url(),
      client_id: z.string().min(1).optional(),
      allow: z
        .object({
          groups: z.array(z.string().min(1)).optional(),
          subjects: z.array(z.string().min(1)).optional(),
        })
        .optional(),
    })
    .optional(),
})

/** Mirrors the shared credential-name contract without making this published package depend on a private workspace. */
export function credentialEnvironmentNames(source: z.infer<typeof sourceSchema>): string[] {
  return [
    ...(source.token_env ? [source.token_env] : []),
    ...(source.github_app
      ? [
          source.github_app.app_id_env,
          source.github_app.private_key_env,
          source.github_app.installation_id_env,
        ]
      : []),
  ]
}

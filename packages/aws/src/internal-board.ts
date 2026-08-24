import { z } from 'zod'

const durationSchema = z
  .string()
  .regex(/^\d+(?:ms|s|m|h)$/)
  .refine((value) => Number.parseInt(value, 10) > 0)
  .brand<'Duration'>()
const positionSchema = z.object({
  x: z.number().int().min(0),
  y: z.number().int().min(0),
  w: z.number().int().min(1).max(12),
  h: z.number().int().min(1),
})
const panelSchema = z.looseObject({
  id: z.string().min(1),
  type: z.string().min(1),
  source: z.string().min(1).optional(),
  // Cosmetic roles remain open so newer board files can safely fall back on older runtimes.
  display: z.string().min(1).optional(),
  position: positionSchema.optional(),
  refresh: durationSchema.optional(),
  link: z.url().optional(),
  url: z.url().optional(),
  json_path: z
    .string()
    .regex(/^\$(?:\.[A-Za-z_][A-Za-z0-9_]*|\[\d+\])*$/)
    .optional(),
})
const sourceSchema = z.looseObject({
  type: z.string().min(1),
  token_env: z.string().min(1).optional(),
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

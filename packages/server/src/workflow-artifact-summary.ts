import { Unzip, UnzipInflate } from 'fflate/browser'
import { z } from 'zod'

const maxArtifactBytes = 64 * 1024

export const testResultsSummarySchema = z
  .object({
    schemaVersion: z.literal(1),
    runId: z.number().int().positive(),
    runAttempt: z.number().int().positive(),
    headSha: z.string().min(1),
    total: z.number().int().nonnegative(),
    passed: z.number().int().nonnegative().optional(),
    failed: z.number().int().nonnegative().optional(),
    skipped: z.number().int().nonnegative().optional(),
    metadata: z.record(z.string(), z.unknown()).optional(),
  })
  .superRefine((summary, ctx) => {
    const outcomeTotal = (summary.passed ?? 0) + (summary.failed ?? 0) + (summary.skipped ?? 0)
    for (const key of ['passed', 'failed', 'skipped'] as const) {
      if (summary[key] !== undefined && summary[key] > summary.total)
        ctx.addIssue({ code: 'custom', path: [key], message: 'must not exceed total' })
    }
    if (outcomeTotal > summary.total)
      ctx.addIssue({ code: 'custom', path: ['total'], message: 'must cover the declared outcomes' })
  })

/** Reads exactly one small, configured JSON entry without exposing the provider archive to clients. */
export async function readTestResultsArtifact(response: Response, entry: string) {
  const reader = response.body?.getReader()
  if (!reader) throw new Error('Artifact archive has no readable body.')
  let compressedBytes = 0
  let entryCount = 0
  let outputBytes = 0
  let complete = false
  let failure: Error | undefined
  const chunks: Uint8Array[] = []
  const archive = new Unzip((file) => {
    entryCount += 1
    if (file.name !== entry || entryCount > 1) {
      failure = new Error('Artifact archive has an unexpected entry.')
      return
    }
    if ((file.originalSize ?? 0) > maxArtifactBytes) {
      failure = new Error('Artifact entry exceeds the configured size limit.')
      return
    }
    file.ondata = (error, data, final) => {
      if (error) {
        failure = error
        return
      }
      outputBytes += data.length
      if (outputBytes > maxArtifactBytes) {
        failure = new Error('Artifact entry exceeds the configured size limit.')
        file.terminate()
        return
      }
      chunks.push(data)
      if (final) complete = true
    }
    file.start()
  })
  archive.register(UnzipInflate)
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (value) {
        compressedBytes += value.length
        if (compressedBytes > maxArtifactBytes)
          throw new Error('Artifact archive exceeds the configured size limit.')
        archive.push(value, done)
      } else if (done) archive.push(new Uint8Array(), true)
      if (done) break
      if (failure) throw failure
    }
  } finally {
    reader.releaseLock()
  }
  if (failure) throw failure
  if (entryCount !== 1 || !complete)
    throw new Error('Artifact archive did not contain the configured summary.')
  return new TextDecoder('utf-8', { fatal: true }).decode(concat(chunks, outputBytes))
}

function concat(chunks: Uint8Array[], length: number): Uint8Array {
  const result = new Uint8Array(length)
  let offset = 0
  for (const chunk of chunks) {
    result.set(chunk, offset)
    offset += chunk.length
  }
  return result
}

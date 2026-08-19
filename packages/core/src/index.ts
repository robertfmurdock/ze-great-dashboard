import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { type BoardConfig, boardConfigSchema } from '@ze-great-dashboard/shared'
import { parse, stringify } from 'yaml'
import { z } from 'zod'

export const CORE_RUNTIME_VERSION = '1.0.0'
export const CANONICAL_ASSET_DOMAIN = 'https://public-assets.zegreatrob.com'

export const releaseMetadataSchema = z.object({
  dashboardVersion: z.string().min(1),
  clientAssetUrl: z.url(),
  serverRuntimeVersion: z.string().min(1),
  supportedProviders: z.array(z.string().min(1)).min(1),
  artifactChecksums: z.record(z.string(), z.string().regex(/^[a-f0-9]{64}$/)),
  runtimeCompatibility: z.object({ node: z.string().min(1) }),
})
export type ReleaseMetadata = z.infer<typeof releaseMetadataSchema>

export type ValidatedBoard = { config: BoardConfig; yaml: string; sha256: string }

export function clientAssetUrl(version: string, domain = CANONICAL_ASSET_DOMAIN): string {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(version))
    throw new Error(`Invalid dashboard version: ${version}`)
  return `${domain.replace(/\/+$/, '')}/dashboard/${version}`
}

export async function validateBoardConfig(path: string): Promise<ValidatedBoard> {
  const source = await readFile(resolve(path), 'utf8')
  const result = boardConfigSchema.safeParse(parse(source))
  if (!result.success)
    throw new Error(`Invalid board configuration:\n${z.prettifyError(result.error)}`)
  // YAML emitted from the parsed value makes equivalent input produce identical artifacts.
  const yaml = stringify(result.data, { sortMapEntries: true })
  return { config: result.data, yaml, sha256: sha256(yaml) }
}

export async function assembleRelease(input: {
  boardConfigPath: string
  outputDir: string
  version: string
  providers?: string[]
  assetDomain?: string
}): Promise<{ metadata: ReleaseMetadata; files: Record<string, string> }> {
  const board = await validateBoardConfig(input.boardConfigPath)
  const outputDir = resolve(input.outputDir)
  await mkdir(outputDir, { recursive: true })
  const boardPath = join(outputDir, 'board.yaml')
  await writeFile(boardPath, board.yaml)
  const metadata: ReleaseMetadata = {
    dashboardVersion: input.version,
    clientAssetUrl: clientAssetUrl(input.version, input.assetDomain),
    serverRuntimeVersion: CORE_RUNTIME_VERSION,
    supportedProviders: input.providers ?? ['aws-lambda'],
    artifactChecksums: { 'board.yaml': board.sha256 },
    runtimeCompatibility: { node: '>=22' },
  }
  const metadataText = `${JSON.stringify(metadata, null, 2)}\n`
  await writeFile(join(outputDir, 'release.json'), metadataText)
  const files = { 'board.yaml': board.sha256, 'release.json': sha256(metadataText) }
  const checksums = `${Object.entries(files)
    .map(([name, digest]) => `${digest}  ${name}`)
    .join('\n')}\n`
  await writeFile(join(outputDir, 'SHA256SUMS'), checksums)
  return { metadata, files }
}

export function assertRuntimeCompatibility(metadata: ReleaseMetadata, serverVersion: string): void {
  if (metadata.serverRuntimeVersion !== serverVersion)
    throw new Error(
      `Incompatible dashboard runtime: release ${metadata.serverRuntimeVersion}, server ${serverVersion}`,
    )
}

export function sha256(value: string | Uint8Array): string {
  return createHash('sha256').update(value).digest('hex')
}

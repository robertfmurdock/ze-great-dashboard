import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { parse, stringify } from 'yaml'
import { z } from 'zod'
import { boardConfigSchema } from './internal-board.ts'

export const CORE_RUNTIME_VERSION = '1.0.0'
const CANONICAL_ASSET_DOMAIN = 'https://d3bvpdr9syk35m.cloudfront.net'

export type ReleaseMetadata = {
  dashboardVersion: string
  clientAssetUrl: string
  serverRuntimeVersion: string
  supportedProviders: string[]
  artifactChecksums: Record<string, string>
  runtimeCompatibility: { node: string }
}

function clientAssetUrl(version: string, domain = CANONICAL_ASSET_DOMAIN): string {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(version))
    throw new Error(`Invalid dashboard version: ${version}`)
  return `${domain.replace(/\/+$/, '')}/dashboard/${version}`
}

async function validateBoardConfig(path: string): Promise<{ yaml: string; sha256: string }> {
  const source = await readFile(resolve(path), 'utf8')
  const result = boardConfigSchema.safeParse(parse(source))
  if (!result.success)
    throw new Error(`Invalid board configuration:\n${z.prettifyError(result.error)}`)
  const yaml = stringify(result.data, { sortMapEntries: true })
  return { yaml, sha256: sha256(yaml) }
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
  await writeFile(join(outputDir, 'board.yaml'), board.yaml)
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
  await writeFile(
    join(outputDir, 'SHA256SUMS'),
    `${Object.entries(files)
      .map(([name, digest]) => `${digest}  ${name}`)
      .join('\n')}\n`,
  )
  return { metadata, files }
}

export function sha256(value: string | Uint8Array): string {
  return createHash('sha256').update(value).digest('hex')
}

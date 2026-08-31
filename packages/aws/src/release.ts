import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import {
  boardSchemaFileName,
  boardSchemaModeline,
  readBoardSchemaModeline,
} from '@ze-great-dashboard/shared'
import { parse, stringify } from 'yaml'
import { z } from 'zod'
import { boardConfigSchema, credentialEnvironmentNames } from './internal-board.ts'

export const CORE_RUNTIME_VERSION = '1.0.0'
const CANONICAL_ASSET_DOMAIN = 'https://public-assets.zegreatrob.com'

export type ReleaseMetadata = {
  dashboardVersion: string
  assetPath: string
  serverRuntimeVersion: string
  supportedProviders: string[]
  artifactChecksums: Record<string, string>
  runtimeCompatibility: { node: string }
}

function legacyAssetPath(version: string, domain = CANONICAL_ASSET_DOMAIN): string {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(version))
    throw new Error(`Invalid dashboard version: ${version}`)
  return `${domain.replace(/\/+$/, '')}/dashboard/${version}`
}

function normalizeAssetPath(value: string): string {
  const assetPath = value.replace(/\/+$/, '')
  let url: URL
  try {
    url = new URL(assetPath)
  } catch {
    throw new Error('--asset-path must be an absolute HTTP(S) URL')
  }
  if (
    !['http:', 'https:'].includes(url.protocol) ||
    !url.hostname ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  )
    throw new Error(
      '--asset-path must be an absolute HTTP(S) URL without credentials, query, or fragment',
    )
  return assetPath
}

async function validateBoardConfig(
  path: string,
  expectedSchemaUrl: string,
): Promise<{
  yaml: string
  sha256: string
  usesCredentials: boolean
}> {
  const source = await readFile(resolve(path), 'utf8')
  const authoredSchemaUrl = readBoardSchemaModeline(source, expectedSchemaUrl)
  const result = boardConfigSchema.safeParse(parse(source))
  if (!result.success) {
    const stale =
      authoredSchemaUrl !== expectedSchemaUrl
        ? `\nStale schema modeline: expected ${expectedSchemaUrl}`
        : ''
    throw new Error(`Invalid board configuration:\n${z.prettifyError(result.error)}${stale}`)
  }
  const yaml = `${boardSchemaModeline(expectedSchemaUrl)}\n${stringify(result.data, { sortMapEntries: true })}`
  return {
    yaml,
    sha256: sha256(yaml),
    usesCredentials: Object.values(result.data.sources).some(
      (source) => credentialEnvironmentNames(source).length > 0,
    ),
  }
}

export async function assembleRelease(input: {
  boardConfigPath: string
  outputDir: string
  version: string
  providers?: string[]
  assetPath?: string
  /** @deprecated Use assetPath to select an arbitrary immutable client URL. */
  assetDomain?: string
  secretReference?: string
}): Promise<{ metadata: ReleaseMetadata; files: Record<string, string> }> {
  if (input.assetPath && input.assetDomain)
    throw new Error('--asset-path and --asset-domain cannot be used together')
  const assetPath = normalizeAssetPath(
    input.assetPath ?? legacyAssetPath(input.version, input.assetDomain),
  )
  const board = await validateBoardConfig(
    input.boardConfigPath,
    `${assetPath}/${boardSchemaFileName}`,
  )
  if (board.usesCredentials && !input.secretReference)
    throw new Error(
      'Board config uses token_env or github_app credentials; SecretReference must name a Secrets Manager credential-map or Parameter Store SecureString ARN',
    )
  const outputDir = resolve(input.outputDir)
  await mkdir(outputDir, { recursive: true })
  await writeFile(join(outputDir, 'board.yaml'), board.yaml)
  const metadata: ReleaseMetadata = {
    dashboardVersion: input.version,
    assetPath,
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

import { execFile } from 'node:child_process'
import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { strToU8, zipSync } from 'fflate'
import { parseDocument, Scalar } from 'yaml'
import type { ComputeMode } from './bootstrap.js'
import { assembleRelease, sha256 } from './release.ts'

export {
  type BootstrapConfig,
  type BootstrapConsistency,
  type BootstrapKind,
  type BootstrapPlan,
  type BootstrapTemplateInspection,
  bootstrapConsistency,
  bootstrapContractVersion,
  bootstrapPlan,
  bootstrapTemplate,
  bootstrapTemplatePath,
  bootstrapTemplateRevision,
  type CloudFormationParameterValue,
  type ComputeMode,
  computeMode,
  coreBootstrapOutputs,
  type DeployedBootstrapStack,
  deployedBootstrapStack,
  mergeBootstrapParameters,
  requireComputeMode,
  requiredBootstrapParameters,
  resolveComputeMode,
} from './bootstrap.js'
export {
  type BootstrapCheck,
  type BootstrapCheckDependencies,
  type BootstrapResourceDifference,
  type BootstrapResourceDrift,
  type BootstrapResourceDriftResult,
  type BootstrapStackCheck,
  checkBootstrap,
  formatBootstrapCheckText,
} from './bootstrap-check.js'
export {
  type BootstrapCheckStatus,
  type BootstrapInitInput,
  type BootstrapPreflight,
  type BootstrapPreflightCheck,
  bootstrapGuide,
  bootstrapPreflight,
  scaffoldBootstrapManifest,
} from './guided.js'
export {
  type BootstrapHandoff,
  type BootstrapPhase,
  type BootstrapProvider,
  type BootstrapVerification,
  bootstrapHandoff,
  type CommandRunner,
  githubOidcProvider,
  verifyBootstrap,
} from './handoff.js'

const run = promisify(execFile)

export type ReleaseMetadata = {
  computeMode: ComputeMode
  dashboardVersion: string
  clientAssetUrl: string
  serverRuntimeVersion: string
  supportedProviders: string[]
  artifactChecksums: Record<string, string>
  runtimeCompatibility: { node: string }
}

export type PackagedRelease = ReleaseMetadata & { artifactKey: string; image?: string }

export type LambdaPackageOptions = {
  boardConfigPath: string
  outputDir: string
  version: string
  assetDomain?: string
  /** ARN of the consumer-owned JSON credential-map secret, never a secret value. */
  secretReference?: string
}

export type EcsPackageOptions = Omit<LambdaPackageOptions, 'secretReference'> & {
  secretReference?: string
  imageReference?: string
}

function requireImageDigest(image: string): string {
  if (!/^[^\s@]+@sha256:[a-f0-9]{64}$/.test(image))
    throw new Error(
      'ECS imageReference must be an immutable registry digest (image@sha256:<64 hex>)',
    )
  return image
}

function deploymentTemplate(template: string, values: Record<string, string>): string {
  const document = parseDocument(template)
  if (document.errors.length)
    throw new Error(`Invalid CloudFormation template: ${document.errors[0]}`)
  const managedValue = (document.toJS() as { Metadata?: { PackageManagedParameters?: unknown } })
    .Metadata?.PackageManagedParameters
  if (!Array.isArray(managedValue))
    throw new Error('CloudFormation template has no PackageManagedParameters metadata')
  const managed = managedValue.filter((key): key is string => typeof key === 'string')
  if (managed.length !== managedValue.length)
    throw new Error('CloudFormation template has invalid PackageManagedParameters metadata')
  const missing = managed.filter((key) => !Object.hasOwn(values, key))
  const unknown = Object.keys(values).filter((key) => !managed.includes(key))
  if (missing.length || unknown.length)
    throw new Error(
      `Package-managed CloudFormation parameters are out of sync (missing: ${missing.join(', ') || 'none'}; unknown: ${unknown.join(', ') || 'none'})`,
    )
  for (const key of managed) {
    const path = ['Parameters', key]
    const parameter = document.getIn(path) as Record<string, unknown> | undefined
    if (!parameter || typeof parameter !== 'object')
      throw new Error(`CloudFormation template has no declaration for ${key}`)
    const current = document.getIn([...path, 'Default'], true)
    if (current !== undefined) {
      if (String(current) !== values[key])
        throw new Error(`Package-managed CloudFormation parameter ${key} has a conflicting default`)
    } else {
      const scalar = new Scalar(values[key])
      scalar.type = 'QUOTE_DOUBLE'
      document.setIn([...path, 'Default'], scalar)
    }
  }
  return document.toString({ lineWidth: 0 })
}

export async function packageLambda(options: LambdaPackageOptions): Promise<PackagedRelease> {
  const outputDir = resolve(options.outputDir)
  await mkdir(outputDir, { recursive: true })
  const runtimeDir = join(outputDir, 'lambda')
  await mkdir(runtimeDir, { recursive: true })
  const lambdaSource = fileURLToPath(new URL('../dist/lambda.mjs', import.meta.url))
  await cp(lambdaSource, join(runtimeDir, 'index.mjs'))
  const release = await assembleRelease({
    boardConfigPath: options.boardConfigPath,
    outputDir: runtimeDir,
    version: options.version,
    providers: ['aws-lambda'],
    assetDomain: options.assetDomain,
    secretReference: options.secretReference,
  })
  const runtimeMetadata = {
    ...release.metadata,
    computeMode: 'lambda' as const,
    artifactChecksums: {
      ...release.metadata.artifactChecksums,
      'index.mjs': sha256(await readFile(join(runtimeDir, 'index.mjs'))),
    },
  }
  await writeFile(join(runtimeDir, 'release.json'), `${JSON.stringify(runtimeMetadata, null, 2)}\n`)
  const sums = Object.entries(runtimeMetadata.artifactChecksums)
    .map(([name, digest]) => `${digest}  ${name}`)
    .join('\n')
  await writeFile(join(runtimeDir, 'SHA256SUMS'), `${sums}\n`)
  const lambdaPath = join(outputDir, 'lambda.zip')
  const archiveFiles = ['SHA256SUMS', 'board.yaml', 'index.mjs', 'release.json'].sort()
  const archive = Object.fromEntries(
    await Promise.all(
      archiveFiles.map(async (name) => [
        name,
        [
          strToU8(await readFile(join(runtimeDir, name), 'utf8')),
          { mtime: new Date(1980, 0, 1, 0, 0, 0), level: 9 },
        ],
      ]),
    ),
  )
  await writeFile(lambdaPath, zipSync(archive))
  await rm(runtimeDir, { recursive: true, force: true })
  const lambdaChecksum = sha256(await readFile(lambdaPath))
  const deploymentChecksum = sha256(JSON.stringify(runtimeMetadata))
  const packagedRelease = {
    ...runtimeMetadata,
    artifactChecksums: { ...runtimeMetadata.artifactChecksums, 'lambda.zip': lambdaChecksum },
    artifactKey: `lambda/${deploymentChecksum}.zip`,
  }
  await writeFile(join(outputDir, 'release.json'), `${JSON.stringify(packagedRelease, null, 2)}\n`)
  await writeFile(
    join(outputDir, 'template.yml'),
    deploymentTemplate(await cloudFormationTemplate('lambda'), {
      ComputeMode: 'lambda',
      LambdaArtifactKey: packagedRelease.artifactKey,
      DashboardVersion: packagedRelease.dashboardVersion,
    }),
  )
  return packagedRelease
}

/** Packages the published container reference and ECS CloudFormation handoff. */
export async function packageEcs(options: EcsPackageOptions): Promise<PackagedRelease> {
  const outputDir = resolve(options.outputDir)
  await mkdir(outputDir, { recursive: true })
  const imageReference = requireImageDigest(options.imageReference ?? '')
  const release = await assembleRelease({
    boardConfigPath: options.boardConfigPath,
    outputDir,
    version: options.version,
    providers: ['aws-ecs-fargate'],
    assetDomain: options.assetDomain,
    secretReference: options.secretReference,
  })
  const packagedRelease = {
    ...release.metadata,
    computeMode: 'ecs' as const,
    image: imageReference,
    artifactKey: `ecs/${sha256(JSON.stringify({ ...release.metadata, image: imageReference }))}`,
  }
  await writeFile(join(outputDir, 'release.json'), `${JSON.stringify(packagedRelease, null, 2)}\n`)
  await writeFile(
    join(outputDir, 'template.yml'),
    deploymentTemplate(await cloudFormationTemplate('ecs'), {
      ComputeMode: 'ecs',
      Image: imageReference,
      DashboardVersion: packagedRelease.dashboardVersion,
    }),
  )
  await writeFile(
    join(outputDir, 'SHA256SUMS'),
    `${sha256(await readFile(join(outputDir, 'release.json')))}  release.json\n`,
  )
  return packagedRelease
}

export type PublishClientAssetsOptions = {
  assetsDir: string
  assetsBucket: string
  assetsBaseUrl: string
  version: string
}

/** Publishes the versioned client half of a provider-managed release. */
export async function publishClientAssets(options: PublishClientAssetsOptions): Promise<string> {
  const assetsDir = resolve(options.assetsDir)
  await readFile(join(assetsDir, 'index.html'))
  const assetPath = `${options.assetsBaseUrl.replace(/\/+$/, '')}/dashboard/${options.version}`
  await run('aws', [
    's3',
    'sync',
    assetsDir,
    `s3://${options.assetsBucket}/dashboard/${options.version}/`,
    '--exclude',
    'index.html',
    '--cache-control',
    'public, max-age=31536000, immutable',
  ])
  await run('aws', [
    's3',
    'cp',
    join(assetsDir, 'index.html'),
    `s3://${options.assetsBucket}/dashboard/${options.version}/index.html`,
    '--cache-control',
    'public, max-age=60',
  ])
  return assetPath
}

export async function cloudFormationTemplate(mode: ComputeMode = 'lambda'): Promise<string> {
  return readFile(
    fileURLToPath(
      new URL(mode === 'ecs' ? '../template-ecs.yml' : '../template.yml', import.meta.url),
    ),
    'utf8',
  )
}

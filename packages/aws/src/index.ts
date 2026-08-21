import { execFile } from 'node:child_process'
import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { strToU8, zipSync } from 'fflate'
import { assembleRelease, sha256 } from './release.ts'

export {
  type BootstrapConfig,
  type BootstrapKind,
  bootstrapContractVersion,
  bootstrapTemplate,
  bootstrapTemplatePath,
  bootstrapTemplateRevision,
  type CloudFormationParameterValue,
  coreBootstrapOutputs,
  type DeployedBootstrapStack,
  deployedBootstrapStack,
  mergeBootstrapParameters,
  requiredBootstrapParameters,
} from './bootstrap.js'
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
  dashboardVersion: string
  clientAssetUrl: string
  serverRuntimeVersion: string
  supportedProviders: string[]
  artifactChecksums: Record<string, string>
  runtimeCompatibility: { node: string }
}

export type PackagedRelease = ReleaseMetadata & { artifactKey: string }

export type LambdaPackageOptions = {
  boardConfigPath: string
  outputDir: string
  version: string
  assetDomain?: string
}

function deploymentTemplate(template: string, values: Record<string, string>): string {
  const listed = template.match(/^ {2}PackageManagedParameters: \[([^\]]*)\]\s*$/m)?.[1]
  if (listed === undefined)
    throw new Error('CloudFormation template has no PackageManagedParameters metadata')
  const managed = listed
    .split(',')
    .map((key) => key.trim())
    .filter(Boolean)
  const missing = managed.filter((key) => !Object.hasOwn(values, key))
  const unknown = Object.keys(values).filter((key) => !managed.includes(key))
  if (missing.length || unknown.length)
    throw new Error(
      `Package-managed CloudFormation parameters are out of sync (missing: ${missing.join(', ') || 'none'}; unknown: ${unknown.join(', ') || 'none'})`,
    )
  return managed.reduce((rendered, key) => {
    const pattern = new RegExp(`^  ${key}: \\{[^\\n]+\\}\\s*$`, 'm')
    const declaration = rendered.match(pattern)?.[0]
    if (!declaration || /\bDefault:/.test(declaration))
      throw new Error(`Unable to set the CloudFormation default for ${key}`)
    return rendered.replace(
      pattern,
      declaration.replace(/\s*}\s*$/, `, Default: ${JSON.stringify(values[key])} }`),
    )
  }, template)
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
  })
  const runtimeMetadata = {
    ...release.metadata,
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
    deploymentTemplate(await cloudFormationTemplate(), {
      LambdaArtifactKey: packagedRelease.artifactKey,
      DashboardVersion: packagedRelease.dashboardVersion,
    }),
  )
  return packagedRelease
}

export type DeployLambdaOptions = {
  artifactDir: string
  assetsDir: string
  assetsBucket: string
  assetsBaseUrl: string
  functionName: string
  version: string
  dryRun?: boolean
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

/** Performs the AWS-specific half of a release using explicit deployment outputs. */
export async function deployLambda(options: DeployLambdaOptions): Promise<void> {
  const artifactDir = resolve(options.artifactDir)
  const assetsDir = resolve(options.assetsDir)
  await readFile(join(artifactDir, 'lambda.zip'))
  await readFile(join(assetsDir, 'index.html'))
  if (options.dryRun) return
  const assetPath = await publishClientAssets(options)
  await run('aws', [
    'lambda',
    'update-function-code',
    '--function-name',
    options.functionName,
    '--zip-file',
    `fileb://${join(artifactDir, 'lambda.zip')}`,
    '--no-cli-pager',
  ])
  await run('aws', ['lambda', 'wait', 'function-updated', '--function-name', options.functionName])
  await run('aws', [
    'lambda',
    'update-function-configuration',
    '--function-name',
    options.functionName,
    '--environment',
    `Variables={ASSET_PATH=${assetPath},BOARD_CONFIG_URL=./board.yaml,HOST=0.0.0.0}`,
    '--no-cli-pager',
  ])
  await run('aws', ['lambda', 'wait', 'function-updated', '--function-name', options.functionName])
}

export async function cloudFormationTemplate(): Promise<string> {
  return readFile(fileURLToPath(new URL('../template.yml', import.meta.url)), 'utf8')
}

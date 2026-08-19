import { execFile } from 'node:child_process'
import { cp, mkdir, readFile, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { assembleRelease, sha256 } from './release.ts'

const run = promisify(execFile)

export type ReleaseMetadata = {
  dashboardVersion: string
  clientAssetUrl: string
  serverRuntimeVersion: string
  supportedProviders: string[]
  artifactChecksums: Record<string, string>
  runtimeCompatibility: { node: string }
}

export type LambdaPackageOptions = {
  boardConfigPath: string
  outputDir: string
  version: string
  assetDomain?: string
}

export async function packageLambda(options: LambdaPackageOptions): Promise<ReleaseMetadata> {
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
  const clientSource = fileURLToPath(new URL('../client', import.meta.url))
  await cp(clientSource, join(outputDir, 'assets'), { recursive: true })
  await writeFile(join(runtimeDir, 'release.json'), `${JSON.stringify(runtimeMetadata, null, 2)}\n`)
  const sums = Object.entries(runtimeMetadata.artifactChecksums)
    .map(([name, digest]) => `${digest}  ${name}`)
    .join('\n')
  await writeFile(join(runtimeDir, 'SHA256SUMS'), `${sums}\n`)
  await run('zip', ['-X', '-q', '-r', join(outputDir, 'lambda.zip'), '.'], { cwd: runtimeDir })
  return runtimeMetadata
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

/** Performs the AWS-specific half of a release using explicit deployment outputs. */
export async function deployLambda(options: DeployLambdaOptions): Promise<void> {
  const artifactDir = resolve(options.artifactDir)
  const assetsDir = resolve(options.assetsDir)
  await readFile(join(artifactDir, 'lambda.zip'))
  await readFile(join(assetsDir, 'index.html'))
  if (options.dryRun) return
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

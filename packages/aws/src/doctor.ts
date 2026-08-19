import { execFile } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { promisify } from 'node:util'
import { parse } from 'yaml'
import { cloudFormationTemplate } from './index.ts'

const run = promisify(execFile)

export type DoctorCheck = { name: string; ok: boolean; detail: string }
export type DoctorDependencies = {
  execute(command: string, args: string[]): Promise<string>
  fetch(url: string): Promise<{ ok: boolean; status: number }>
  nodeVersion: string
  packageVersion: string
}

const actualDependencies: DoctorDependencies = {
  async execute(command, args) {
    return (await run(command, args)).stdout.trim()
  },
  async fetch(url) {
    return fetch(url)
  },
  nodeVersion: process.versions.node,
  packageVersion: '',
}

type ParameterValue = { ParameterKey: string; ParameterValue: string }

function readParameterValues(value: unknown): ParameterValue[] {
  if (!Array.isArray(value)) throw new Error('must contain a JSON parameter array')
  const parameters = value.map((entry) => {
    if (
      !entry ||
      typeof entry !== 'object' ||
      typeof entry.ParameterKey !== 'string' ||
      typeof entry.ParameterValue !== 'string'
    )
      throw new Error('entries must contain string ParameterKey and ParameterValue fields')
    return entry as ParameterValue
  })
  const keys = parameters.map(({ ParameterKey }) => ParameterKey)
  if (new Set(keys).size !== keys.length) throw new Error('contains duplicate parameters')
  return parameters
}

async function templateContract(parameters: ParameterValue[]) {
  const template = await cloudFormationTemplate()
  const parametersBlock = template.match(
    /^Parameters:\n[\s\S]*?(?=^[A-Za-z][A-Za-z0-9]*:\s*$)/m,
  )?.[0]
  const metadataBlock = template.match(/^Metadata:\n[\s\S]*?(?=^Parameters:\s*$)/m)?.[0]
  if (!parametersBlock) throw new Error('template has no Parameters block')
  const parsedParameters = parse(parametersBlock) as {
    Parameters?: Record<string, { Default?: unknown }>
  }
  const parsedMetadata = metadataBlock
    ? (parse(metadataBlock) as { Metadata?: { PackageManagedParameters?: unknown } })
    : {}
  const definitions = parsedParameters.Parameters ?? {}
  const managedValue = parsedMetadata.Metadata?.PackageManagedParameters ?? []
  if (!Array.isArray(managedValue) || !managedValue.every((key) => typeof key === 'string'))
    throw new Error('template has invalid PackageManagedParameters metadata')
  const managed = new Set(managedValue)
  const values = Object.fromEntries(
    parameters.map((item) => [item.ParameterKey, item.ParameterValue]),
  )
  const stale = Object.keys(values).filter((key) => !Object.hasOwn(definitions, key))
  const missing = Object.entries(definitions)
    .filter(
      ([key, definition]) =>
        !Object.hasOwn(definition, 'Default') && !managed.has(key) && !Object.hasOwn(values, key),
    )
    .map(([key]) => key)
  if (missing.length || stale.length)
    throw new Error(
      `out of sync with template (missing: ${missing.join(', ') || 'none'}; stale: ${stale.join(', ') || 'none'})`,
    )
  return { values, definitions }
}

function failureDetail(error: unknown): string {
  if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT')
    return 'not found on PATH'
  return error instanceof Error ? error.message : String(error)
}

export async function runDoctor(
  options: { parametersPath: string; region: string },
  dependencies: DoctorDependencies = actualDependencies,
): Promise<DoctorCheck[]> {
  const checks: DoctorCheck[] = []
  const check = async (name: string, action: () => Promise<string>) => {
    try {
      checks.push({ name, ok: true, detail: await action() })
    } catch (error) {
      checks.push({ name, ok: false, detail: failureDetail(error) })
    }
  }

  await check('Node.js', async () => {
    const major = Number(dependencies.nodeVersion.split('.')[0])
    if (!Number.isInteger(major) || major < 22)
      throw new Error(`v${dependencies.nodeVersion} is unsupported; Node.js 22+ is required`)
    return `v${dependencies.nodeVersion}`
  })
  for (const [name, command, args] of [
    ['npm', 'npm', ['--version']],
    ['AWS CLI', 'aws', ['--version']],
    ['jq', 'jq', ['--version']],
  ] as const)
    await check(name, () => dependencies.execute(command, [...args]))

  const awsAvailable = checks.find(({ name }) => name === 'AWS CLI')?.ok === true
  await check('AWS identity', async () => {
    if (!awsAvailable) throw new Error('skipped because the AWS CLI is unavailable')
    const identity = await dependencies.execute('aws', [
      'sts',
      'get-caller-identity',
      '--region',
      options.region,
      '--output',
      'json',
      '--no-cli-pager',
    ])
    const parsed = JSON.parse(identity) as { Arn?: unknown; Account?: unknown }
    if (typeof parsed.Arn !== 'string' || typeof parsed.Account !== 'string')
      throw new Error('AWS returned an invalid identity')
    return `${parsed.Arn} (${parsed.Account})`
  })

  let parameterData:
    | { values: Record<string, string>; definitions: Record<string, { Default?: unknown }> }
    | undefined
  await check('Parameters/template', async () => {
    const parameters = readParameterValues(
      JSON.parse(await readFile(options.parametersPath, 'utf8')),
    )
    parameterData = await templateContract(parameters)
    return `${options.parametersPath} is compatible`
  })

  await check('Artifact bucket', async () => {
    const bucket = parameterData?.values.LambdaArtifactBucket
    if (!bucket) throw new Error('skipped because parameters do not provide LambdaArtifactBucket')
    if (!awsAvailable) throw new Error('skipped because the AWS CLI is unavailable')
    const output = await dependencies.execute('aws', [
      's3api',
      'get-bucket-location',
      '--bucket',
      bucket,
      '--region',
      options.region,
      '--output',
      'json',
      '--no-cli-pager',
    ])
    const location = (JSON.parse(output) as { LocationConstraint?: string | null })
      .LocationConstraint
    const bucketRegion = location === null || location === undefined ? 'us-east-1' : location
    if (bucketRegion !== options.region)
      throw new Error(`bucket is in ${bucketRegion}, not ${options.region}`)
    return `${bucket} exists in ${bucketRegion}`
  })

  await check('Hosted client', async () => {
    const baseUrl = parameterData?.definitions.AssetBaseUrl?.Default
    if (typeof baseUrl !== 'string') throw new Error('template has no AssetBaseUrl default')
    if (!dependencies.packageVersion) throw new Error('installed package version is unavailable')
    const url = `${baseUrl.replace(/\/+$/, '')}/dashboard/${dependencies.packageVersion}/index.html`
    const response = await dependencies.fetch(url)
    if (!response.ok) throw new Error(`${url} returned HTTP ${response.status}`)
    return `${url} returned HTTP ${response.status}`
  })
  return checks
}

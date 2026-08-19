#!/usr/bin/env node
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { parse } from 'yaml'
import { cloudFormationTemplate, deployLambda, packageLambda } from './index.ts'

const args = process.argv.slice(2)
const option = (name: string, fallback?: string) => {
  const i = args.indexOf(name)
  return i >= 0 ? args[i + 1] : fallback
}

async function installedPackageVersion(): Promise<string> {
  const packageManifest = JSON.parse(
    await readFile(new URL('../package.json', import.meta.url), 'utf8'),
  ) as { version?: unknown }
  return typeof packageManifest.version === 'string' ? packageManifest.version : ''
}

const requiredOption = (name: string, fallback?: string): string => {
  const value = option(name, fallback)
  if (!value) throw new Error(`${name} is required`)
  return value
}

function parameter(key: string, value: string): { ParameterKey: string; ParameterValue: string } {
  return { ParameterKey: key, ParameterValue: value }
}

type CloudFormationParameter = { Default?: unknown }
type CloudFormationParameterValue = { ParameterKey: string; ParameterValue: string }
type TemplateParameterData = {
  definitions: Record<string, CloudFormationParameter>
  packageManaged: Set<string>
}

async function existingParameters(path: string): Promise<CloudFormationParameterValue[]> {
  try {
    const parsed = JSON.parse(await readFile(path, 'utf8')) as unknown
    if (!Array.isArray(parsed)) throw new Error(`${path} must contain a JSON parameter array`)
    const values = parsed.map((value) => {
      if (
        !value ||
        typeof value !== 'object' ||
        typeof value.ParameterKey !== 'string' ||
        typeof value.ParameterValue !== 'string'
      )
        throw new Error(
          `${path} entries must contain string ParameterKey and ParameterValue fields`,
        )
      return value as CloudFormationParameterValue
    })
    const keys = values.map(({ ParameterKey }) => ParameterKey)
    if (new Set(keys).size !== keys.length) throw new Error(`${path} contains duplicate parameters`)
    return values
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') return []
    throw error
  }
}

async function templateParameters(): Promise<TemplateParameterData> {
  const template = await cloudFormationTemplate()
  const block = template.match(/^Parameters:\n[\s\S]*?(?=^[A-Za-z][A-Za-z0-9]*:\s*$)/m)?.[0]
  if (!block) throw new Error('Unable to read Parameters from the CloudFormation template')
  const parsed = parse(block) as { Parameters?: Record<string, CloudFormationParameter> }
  if (!parsed.Parameters) throw new Error('CloudFormation template has no Parameters')
  const metadataBlock = template.match(/^Metadata:\n[\s\S]*?(?=^Parameters:\s*$)/m)?.[0]
  const metadata = metadataBlock
    ? ((parse(metadataBlock) as { Metadata?: { PackageManagedParameters?: unknown } }).Metadata ??
      {})
    : {}
  if (
    metadata.PackageManagedParameters !== undefined &&
    (!Array.isArray(metadata.PackageManagedParameters) ||
      !metadata.PackageManagedParameters.every((key) => typeof key === 'string'))
  )
    throw new Error('CloudFormation template has invalid PackageManagedParameters metadata')
  const packageManaged = new Set<string>(metadata.PackageManagedParameters ?? [])
  const unknownManaged = [...packageManaged].filter(
    (key) => !Object.hasOwn(parsed.Parameters ?? {}, key),
  )
  if (unknownManaged.length)
    throw new Error(
      `CloudFormation template has unknown package-managed parameters: ${unknownManaged.join(', ')}`,
    )
  return { definitions: parsed.Parameters, packageManaged }
}

try {
  if (args[0] === 'deploy') {
    const artifactDir = requiredOption('--artifact-dir')
    await deployLambda({
      artifactDir,
      assetsDir: option('--assets-dir', join(artifactDir, 'assets')) ?? join(artifactDir, 'assets'),
      assetsBucket: requiredOption('--assets-bucket'),
      assetsBaseUrl: requiredOption('--assets-base-url'),
      functionName: requiredOption('--function-name'),
      version: requiredOption('--version'),
      dryRun: args.includes('--dry-run'),
    })
    console.log(JSON.stringify({ deployed: true, version: requiredOption('--version') }))
  } else if (args[0] === 'parameters') {
    const output =
      option('--output', 'aws-dashboard-parameters.json') ?? 'aws-dashboard-parameters.json'
    const existing = await existingParameters(output)
    const existingValues = Object.fromEntries(
      existing.map(({ ParameterKey, ParameterValue }) => [ParameterKey, ParameterValue]),
    )
    const artifactBucket = option('--artifact-bucket', existingValues.LambdaArtifactBucket)
    if (!artifactBucket) throw new Error('--artifact-bucket is required')
    const { definitions, packageManaged } = await templateParameters()
    const templateKeys = Object.keys(definitions)
    const hasDefault = (key: string) => Object.hasOwn(definitions[key] ?? {}, 'Default')
    const hasValue = (key: string) =>
      key === 'LambdaArtifactBucket' || Object.hasOwn(existingValues, key)
    const missingRequired = templateKeys.filter(
      (key) => !hasDefault(key) && !packageManaged.has(key) && !hasValue(key),
    )
    const staleExisting = Object.keys(existingValues).filter(
      (key) => !Object.hasOwn(definitions, key),
    )
    if (missingRequired.length || staleExisting.length) {
      throw new Error(
        `Parameter values are out of sync with the CloudFormation template (missing: ${missingRequired.join(', ') || 'none'}; stale: ${staleExisting.join(', ') || 'none'})`,
      )
    }
    const includeDefaults = args.includes('--include-defaults')
    const parameters = templateKeys
      .filter(
        (key) =>
          !packageManaged.has(key) &&
          (includeDefaults || !hasDefault(key) || Object.hasOwn(existingValues, key)),
      )
      .map((key) => {
        const definition = definitions[key]
        const value =
          key === 'LambdaArtifactBucket'
            ? artifactBucket
            : (existingValues[key] ?? definition?.Default)
        if (value === undefined) throw new Error(`No value for CloudFormation parameter ${key}`)
        return parameter(key, String(value))
      })
    await writeFile(output, `${JSON.stringify(parameters, null, 2)}\n`)
    console.log(JSON.stringify({ output }))
  } else if (args[0] !== 'package')
    throw new Error('Usage: ze-great-dashboard-aws package|parameters|deploy [options]')
  else {
    const boardConfig = option('--board-config')
    const packageVersion = await installedPackageVersion()
    // Consumers should omit --version so the package and client release stay paired. The explicit
    // override exists for the provider's release workflow, which packages before publishing.
    const version = option('--version', process.env.DASHBOARD_VERSION ?? packageVersion)
    if (!boardConfig) throw new Error('--board-config is required')
    if (!version)
      throw new Error('Unable to determine the package version; pass --version explicitly')
    const metadata = await packageLambda({
      boardConfigPath: boardConfig,
      outputDir: option('--output', 'aws-release') ?? 'aws-release',
      version,
      assetDomain: option('--asset-domain'),
    })
    console.log(JSON.stringify(metadata))
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
}

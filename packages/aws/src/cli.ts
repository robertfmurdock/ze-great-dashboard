#!/usr/bin/env node
import { deployLambda, packageLambda } from './index.ts'

const args = process.argv.slice(2)
const option = (name: string, fallback?: string) => {
  const i = args.indexOf(name)
  return i >= 0 ? args[i + 1] : fallback
}

try {
  if (args[0] === 'deploy') {
    const required = (name: string): string => {
      const value = option(name)
      if (!value) throw new Error(`${name} is required`)
      return value
    }
    await deployLambda({
      artifactDir: required('--artifact-dir'),
      assetsDir: required('--assets-dir'),
      assetsBucket: required('--assets-bucket'),
      assetsBaseUrl: required('--assets-base-url'),
      functionName: required('--function-name'),
      version: required('--version'),
    })
    console.log(JSON.stringify({ deployed: true, version: required('--version') }))
  } else if (args[0] !== 'package')
    throw new Error('Usage: ze-great-dashboard-aws package|deploy [options]')
  else {
    const boardConfig = option('--board-config')
    const version = option('--version', process.env.DASHBOARD_VERSION)
    if (!boardConfig || !version) throw new Error('--board-config and --version are required')
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

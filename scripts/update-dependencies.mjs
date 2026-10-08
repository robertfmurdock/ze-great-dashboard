import { spawnSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const playwrightPackage = '@playwright/test'
const defaultRegistryUrl = 'https://mcr.microsoft.com'
const manifestAccept = 'application/vnd.docker.distribution.manifest.v2+json'

function exactVersion(specification) {
  const match = /\d+\.\d+\.\d+/.exec(specification)
  if (!match)
    throw new Error(
      `Could not determine a Playwright version from ${JSON.stringify(specification)}.`,
    )
  return match[0]
}

export async function playwrightImageIsPublished(
  version,
  { registryUrl = defaultRegistryUrl } = {},
) {
  const response = await fetch(
    `${registryUrl}/v2/playwright/manifests/v${encodeURIComponent(version)}-noble`,
    { headers: { Accept: manifestAccept } },
  )

  if (response.status === 404) return false
  if (!response.ok) {
    throw new Error(
      `Could not confirm the Playwright Docker image for ${version}: MCR returned HTTP ${response.status}.`,
    )
  }

  return true
}

export async function deferUnavailablePlaywrightUpgrade(before, after, imageIsPublished) {
  const previousSpecification = before.devDependencies?.[playwrightPackage]
  const proposedSpecification = after.devDependencies?.[playwrightPackage]

  if (
    !previousSpecification ||
    !proposedSpecification ||
    previousSpecification === proposedSpecification
  )
    return false

  const version = exactVersion(proposedSpecification)
  if (await imageIsPublished(version)) return false

  after.devDependencies[playwrightPackage] = previousSpecification
  return true
}

function run(command, arguments_, options = {}) {
  const result = spawnSync(command, arguments_, { stdio: 'inherit', ...options })
  if (result.error) throw result.error
  if (result.status !== 0) process.exit(result.status ?? 1)
}

async function main() {
  const packagePath = resolve('package.json')
  const before = JSON.parse(readFileSync(packagePath, 'utf8'))
  const ncu = resolve('node_modules/.bin/ncu')
  const environment = {
    ...process.env,
    XDG_CONFIG_HOME: resolve(tmpdir(), 'npm-check-updates'),
  }

  run(ncu, ['--workspaces', '--root', '--reject', 'npm', '--upgrade'], { env: environment })

  const after = JSON.parse(readFileSync(packagePath, 'utf8'))
  const proposedPlaywrightVersion = after.devDependencies?.[playwrightPackage]
  const deferred = await deferUnavailablePlaywrightUpgrade(
    before,
    after,
    playwrightImageIsPublished,
  )
  if (deferred) {
    writeFileSync(packagePath, `${JSON.stringify(after, null, 2)}\n`)
    console.log(
      `DEFER ${playwrightPackage}: MCR has not published v${exactVersion(proposedPlaywrightVersion)}-noble yet.`,
    )
  }

  run('npm', ['install', '--ignore-scripts'])
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main()

import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { strFromU8, unzipSync } from 'fflate'

const packageName = '@continuous-excellence/ze-great-dashboard-aws'
const requested = process.argv[2] ?? process.env.RELEASE_VERSION
const isTarball =
  requested?.endsWith('.tgz') || requested?.startsWith('.') || requested?.startsWith('/')
const version = (isTarball ? process.argv[3] : requested) ?? process.env.RELEASE_VERSION
if (!version || !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version)) {
  throw new Error(
    'Pass a version, or a tarball and version: npm run test:installed -- ./package.tgz 1.2.3',
  )
}

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const consumerRoot = await mkdtemp(join(tmpdir(), 'ze-great-dashboard-installed-'))
const npmCache = join(consumerRoot, 'npm-cache')
const npmCli = process.env.npm_execpath
const installSpec = isTarball ? resolve(requested) : `${packageName}@${version}`

function npm(args) {
  const command = npmCli ? process.execPath : 'npm'
  const commandArgs = npmCli ? [npmCli, ...args] : args
  return execFileSync(command, commandArgs, {
    cwd: consumerRoot,
    encoding: 'utf8',
    env: { ...process.env, npm_config_cache: npmCache },
    stdio: 'pipe',
  })
}

const wait = (milliseconds) => new Promise((resolveWait) => setTimeout(resolveWait, milliseconds))

try {
  await writeFile(
    join(consumerRoot, 'package.json'),
    `${JSON.stringify({ name: 'dashboard-consumer-smoke', private: true }, null, 2)}\n`,
  )
  await cp(join(repositoryRoot, 'boards/example.yaml'), join(consumerRoot, 'board.yaml'))

  let installError
  const installAttempts = isTarball ? 1 : 12
  for (let attempt = 1; attempt <= installAttempts; attempt += 1) {
    try {
      npm(['install', '--ignore-scripts', '--prefer-online', '--save-exact', installSpec])
      installError = undefined
      break
    } catch (error) {
      installError = error
      const output = error && typeof error === 'object' && 'stderr' in error ? error.stderr : error
      const retryable = /ETARGET|E404/.test(String(output))
      if (!retryable || attempt === installAttempts) break
      console.warn(
        `Registry version is not visible yet; retrying install (${attempt}/${installAttempts})`,
      )
      await wait(5000)
    }
  }
  if (installError) throw installError

  const installedManifest = JSON.parse(
    await readFile(join(consumerRoot, 'node_modules', packageName, 'package.json'), 'utf8'),
  )
  assert.equal(installedManifest.version, version)

  const cli = join(consumerRoot, 'node_modules', '.bin', 'ze-great-dashboard-aws')
  execFileSync(
    cli,
    [
      'parameters',
      '--artifact-bucket',
      'ze-great-dashboard-dogfood-artifacts',
      '--output',
      'aws-dashboard-parameters.json',
    ],
    { cwd: consumerRoot, stdio: 'pipe' },
  )
  execFileSync(
    cli,
    ['package', '--board-config', 'board.yaml', '--output', 'aws-dashboard-release'],
    { cwd: consumerRoot, stdio: 'pipe' },
  )

  const parameters = JSON.parse(
    await readFile(join(consumerRoot, 'aws-dashboard-parameters.json'), 'utf8'),
  )
  assert.deepEqual(parameters, [
    {
      ParameterKey: 'LambdaArtifactBucket',
      ParameterValue: 'ze-great-dashboard-dogfood-artifacts',
    },
  ])

  const releaseRoot = join(consumerRoot, 'aws-dashboard-release')
  const release = JSON.parse(await readFile(join(releaseRoot, 'release.json'), 'utf8'))
  assert.equal(release.dashboardVersion, version)
  assert.equal(release.clientAssetUrl, `https://public-assets.zegreatrob.com/dashboard/${version}`)
  assert.match(release.artifactKey, /^lambda\/[a-f0-9]{64}\.zip$/)
  const archive = unzipSync(await readFile(join(releaseRoot, 'lambda.zip')))
  assert.deepEqual(Object.keys(archive).sort(), [
    'SHA256SUMS',
    'board.yaml',
    'index.mjs',
    'release.json',
  ])
  assert.match(strFromU8(archive['board.yaml']), /boards:/)
  const template = await readFile(join(releaseRoot, 'template.yml'), 'utf8')
  assert.match(template, new RegExp(`DashboardVersion: \\{[^\\n]+Default: "${version}"`))
  assert.ok(template.includes(`Default: "${release.artifactKey}"`))

  execFileSync(
    cli,
    [
      'deploy',
      '--artifact-dir',
      'aws-dashboard-release',
      '--assets-bucket',
      'unused',
      '--assets-base-url',
      'https://unused.example',
      '--function-name',
      'unused',
      '--dry-run',
    ],
    { cwd: consumerRoot, stdio: 'pipe' },
  )

  if (!process.argv.includes('--skip-client')) {
    const assetResponse = await fetch(`${release.clientAssetUrl}/index.html`)
    assert.equal(
      assetResponse.status,
      200,
      `Published client returned HTTP ${assetResponse.status}`,
    )
  }
  console.log(`Installed consumer workflow passed for ${packageName}@${version}`)
} finally {
  await rm(consumerRoot, { recursive: true, force: true })
}

import { execFileSync } from 'node:child_process'
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { packageLayout } from './package-layout.mjs'

const root = resolve(fileURLToPath(new URL('..', import.meta.url)))
const releaseVersion = normalizeVersion(process.env.RELEASE_VERSION)
const dryRun = process.argv.includes('--dry-run')

const stagingRoot = process.env.PUBLISH_STAGING_DIR
  ? resolve(process.env.PUBLISH_STAGING_DIR)
  : await mkdtemp(join(tmpdir(), 'ze-great-dashboard-publish-'))

try {
  for (const packageSpec of packageLayout) {
    const sourceDirectory = join(root, packageSpec.directory)
    const destinationDirectory = join(stagingRoot, packageSpec.id)
    await copyPackage(sourceDirectory, destinationDirectory, packageSpec.publishFiles)
    const publishArgs = ['publish', '--access', 'public', '--provenance']
    if (dryRun) publishArgs.push('--dry-run')
    execFileSync('npm', publishArgs, {
      cwd: destinationDirectory,
      stdio: 'inherit',
      env: { ...process.env, NPM_CONFIG_IGNORE_SCRIPTS: 'true' },
    })
  }
} finally {
  if (!process.env.PUBLISH_STAGING_DIR) await rm(stagingRoot, { recursive: true, force: true })
}

function normalizeVersion(value) {
  const version = value?.replace(/^v/, '')
  if (!version || !/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(version))
    throw new Error(`RELEASE_VERSION must be a semantic version, received: ${value ?? '<missing>'}`)
  return version
}

async function copyPackage(sourceDirectory, destinationDirectory, files) {
  await copyFiles(sourceDirectory, destinationDirectory, files)
  await cp(join(root, 'LICENSE'), join(destinationDirectory, 'LICENSE'))
  const manifest = JSON.parse(await readFile(join(sourceDirectory, 'package.json'), 'utf8'))
  manifest.version = releaseVersion
  delete manifest.scripts
  await writeFile(
    join(destinationDirectory, 'package.json'),
    `${JSON.stringify(manifest, null, 2)}\n`,
  )
}

async function copyFiles(sourceDirectory, destinationDirectory, files) {
  for (const file of files) {
    await cp(join(sourceDirectory, file), join(destinationDirectory, file), { recursive: true })
  }
}

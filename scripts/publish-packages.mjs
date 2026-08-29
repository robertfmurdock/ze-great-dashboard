import { execFileSync, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { packageLayout } from './package-layout.mjs'

const root = resolve(fileURLToPath(new URL('..', import.meta.url)))
const releaseVersion = normalizeVersion(process.env.RELEASE_VERSION)
const args = process.argv.slice(2)
const packIndex = args.indexOf('--pack')
const publishIndex = args.indexOf('--publish-tarball')

if (publishIndex >= 0) {
  const tarball = resolve(requiredArgument(publishIndex, '--publish-tarball'))
  await publishTarball(tarball)
} else {
  const stagingRoot = process.env.PUBLISH_STAGING_DIR
    ? resolve(process.env.PUBLISH_STAGING_DIR)
    : await mkdtemp(join(tmpdir(), 'ze-great-dashboard-publish-'))
  try {
    for (const packageSpec of packageLayout)
      await stagePackage(packageSpec, join(stagingRoot, packageSpec.id))

    if (packIndex >= 0) {
      if (packageLayout.length !== 1) throw new Error('--pack requires exactly one public package')
      await packPackage(
        join(stagingRoot, packageLayout[0].id),
        requiredArgument(packIndex, '--pack'),
      )
    } else {
      for (const packageSpec of packageLayout) {
        const publishArgs = ['publish', '--access', 'public', '--provenance']
        if (args.includes('--dry-run')) publishArgs.push('--dry-run')
        execFileSync('npm', publishArgs, {
          cwd: join(stagingRoot, packageSpec.id),
          stdio: 'inherit',
          env: { ...process.env, NPM_CONFIG_IGNORE_SCRIPTS: 'true' },
        })
      }
    }
  } finally {
    if (!process.env.PUBLISH_STAGING_DIR) await rm(stagingRoot, { recursive: true, force: true })
  }
}

function requiredArgument(index, flag) {
  const value = args[index + 1]
  if (!value || value.startsWith('--')) throw new Error(`${flag} requires a path`)
  return value
}

function normalizeVersion(value) {
  const version = value?.replace(/^v/, '')
  if (!version || !/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(version))
    throw new Error(`RELEASE_VERSION must be a semantic version, received: ${value ?? '<missing>'}`)
  return version
}

async function stagePackage(packageSpec, destinationDirectory) {
  const sourceDirectory = join(root, packageSpec.directory)
  for (const file of packageSpec.publishFiles)
    await cp(join(sourceDirectory, file), join(destinationDirectory, file), { recursive: true })
  if (packageSpec.id === 'aws')
    await verifyBoardSchemaArtifacts(sourceDirectory, destinationDirectory)
  await cp(join(root, 'LICENSE'), join(destinationDirectory, 'LICENSE'))
  await cp(join(sourceDirectory, 'README.md'), join(destinationDirectory, 'README.md'))
  const manifest = JSON.parse(await readFile(join(sourceDirectory, 'package.json'), 'utf8'))
  manifest.version = releaseVersion
  delete manifest.scripts
  await writeFile(
    join(destinationDirectory, 'package.json'),
    `${JSON.stringify(manifest, null, 2)}\n`,
  )
}

async function verifyBoardSchemaArtifacts(sourceDirectory, destinationDirectory) {
  const rootSchema = await readFile(join(sourceDirectory, 'board-config.schema.json'))
  const clientSchema = await readFile(join(sourceDirectory, 'client', 'board-config.schema.json'))
  if (!rootSchema.equals(clientSchema))
    throw new Error('AWS package schema artifacts differ between the package root and client/')

  const stagedRootSchema = await readFile(join(destinationDirectory, 'board-config.schema.json'))
  const stagedClientSchema = await readFile(
    join(destinationDirectory, 'client', 'board-config.schema.json'),
  )
  if (!rootSchema.equals(stagedRootSchema) || !rootSchema.equals(stagedClientSchema))
    throw new Error('AWS package staging did not preserve both board schema artifacts')
}

async function packPackage(stagedDirectory, requestedPath) {
  const target = resolve(requestedPath)
  const packRoot = await mkdtemp(join(tmpdir(), 'ze-great-dashboard-pack-'))
  try {
    const output = execFileSync(
      'npm',
      ['pack', stagedDirectory, '--pack-destination', packRoot, '--json', '--ignore-scripts'],
      {
        cwd: root,
        encoding: 'utf8',
        env: { ...process.env, npm_config_cache: join(packRoot, 'npm-cache') },
      },
    )
    const result = JSON.parse(output)
    if (!Array.isArray(result) || typeof result[0]?.filename !== 'string')
      throw new Error('npm pack did not report a tarball filename')
    await cp(join(packRoot, result[0].filename), target)
    console.log(`${target} (${result[0].integrity})`)
  } finally {
    await rm(packRoot, { recursive: true, force: true })
  }
}

async function publishTarball(tarball) {
  const packageName = packageLayout[0]?.directory
    ? JSON.parse(await readFile(join(root, packageLayout[0].directory, 'package.json'), 'utf8'))
        .name
    : undefined
  if (!packageName) throw new Error('No public package is configured')
  if (releaseVersion.endsWith('-SNAPSHOT')) {
    execFileSync('npm', ['ping', '--registry', 'https://registry.npmjs.org'], {
      cwd: root,
      stdio: 'inherit',
    })
    execFileSync(
      'npm',
      ['publish', tarball, '--access', 'public', '--provenance', '--tag', 'snapshot', '--dry-run'],
      {
        cwd: root,
        stdio: 'inherit',
        env: { ...process.env, NPM_CONFIG_IGNORE_SCRIPTS: 'true' },
      },
    )
    return
  }
  const localIntegrity = `sha512-${createHash('sha512')
    .update(await readFile(tarball))
    .digest('base64')}`
  const lookup = spawnSync(
    'npm',
    ['view', `${packageName}@${releaseVersion}`, 'dist.integrity', '--json'],
    {
      cwd: root,
      encoding: 'utf8',
    },
  )
  if (lookup.status === 0) {
    const registryIntegrity = JSON.parse(lookup.stdout)
    if (registryIntegrity !== localIntegrity)
      throw new Error(
        `Immutable npm version collision for ${packageName}@${releaseVersion}: registry ${registryIntegrity}, local ${localIntegrity}`,
      )
    console.log(
      `${packageName}@${releaseVersion} is already published with matching integrity; skipping`,
    )
    return
  }
  const lookupError = `${lookup.stdout}\n${lookup.stderr}`
  if (!/E404|404 Not Found|is not in this registry/i.test(lookupError))
    throw new Error(`Unable to check npm registry integrity: ${lookupError.trim()}`)
  execFileSync('npm', ['publish', tarball, '--access', 'public', '--provenance'], {
    cwd: root,
    stdio: 'inherit',
    env: { ...process.env, NPM_CONFIG_IGNORE_SCRIPTS: 'true' },
  })
}

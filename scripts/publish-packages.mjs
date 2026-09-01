import { execFileSync, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { cp, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { packageLayout } from './package-layout.mjs'

const root = resolve(fileURLToPath(new URL('..', import.meta.url)))
const releaseVersion = normalizeVersion(process.env.RELEASE_VERSION)
const args = process.argv.slice(2)
const packPaths = optionValues('--pack')
const publishIndex = args.indexOf('--publish-tarball')
const publicPackages = await Promise.all(
  packageLayout.map(async (packageSpec) => {
    const manifest = JSON.parse(
      await readFile(join(root, packageSpec.directory, 'package.json'), 'utf8'),
    )
    if (typeof manifest.name !== 'string' || !manifest.name)
      throw new Error(`Public package ${packageSpec.id} has no package name`)
    return { id: packageSpec.id, name: manifest.name }
  }),
)

if (publishIndex >= 0) {
  const tarball = resolve(requiredArgument(publishIndex, '--publish-tarball'))
  await publishTarball(tarball)
} else {
  // The browser's displayed release is part of its immutable artifact, so rebuild it for the
  // exact npm release before staging the package.
  execFileSync('node', ['scripts/build-packages.mjs'], {
    cwd: root,
    stdio: 'inherit',
    env: { ...process.env, RELEASE_VERSION: releaseVersion },
  })
  const stagingRoot = process.env.PUBLISH_STAGING_DIR
    ? resolve(process.env.PUBLISH_STAGING_DIR)
    : await mkdtemp(join(tmpdir(), 'ze-great-dashboard-publish-'))
  try {
    for (const packageSpec of packageLayout)
      await stagePackage(packageSpec, join(stagingRoot, packageSpec.id))

    if (packPaths.length) {
      if (packPaths.length !== packageLayout.length)
        throw new Error(
          `--pack requires one path for each public package: ${packageLayout.map(({ id }) => id).join(', ')}`,
        )
      // npm pack is process-global enough on some local npm installations that concurrent calls
      // can produce malformed JSON output. The artifacts were already built together; pack them
      // deterministically one at a time.
      for (const [index, packageSpec] of packageLayout.entries())
        await packPackage(join(stagingRoot, packageSpec.id), packPaths[index])
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

function optionValues(flag) {
  return args.flatMap((argument, index) =>
    argument === flag ? [requiredArgument(index, flag)] : [],
  )
}

function normalizeVersion(value) {
  const version = value?.replace(/^v/, '')
  if (!version || !/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(version))
    throw new Error(`RELEASE_VERSION must be a semantic version, received: ${value ?? '<missing>'}`)
  return version
}

async function stagePackage(packageSpec, destinationDirectory) {
  const sourceDirectory = join(root, packageSpec.directory)
  // Callers may retain the staging root for inspection. Recreate each package directory so stale
  // artifacts cannot become part of a later tarball.
  await rm(destinationDirectory, { recursive: true, force: true })
  for (const publishedFile of packageSpec.publishFiles) {
    const { source, destination } =
      typeof publishedFile === 'string'
        ? { source: publishedFile, destination: publishedFile }
        : publishedFile
    await cp(join(sourceDirectory, source), join(destinationDirectory, destination), {
      recursive: true,
    })
  }
  await cp(join(root, 'LICENSE'), join(destinationDirectory, 'LICENSE'))
  await cp(join(sourceDirectory, 'README.md'), join(destinationDirectory, 'README.md'))
  const manifest = JSON.parse(await readFile(join(sourceDirectory, 'package.json'), 'utf8'))
  manifest.version = releaseVersion
  delete manifest.scripts
  if (packageSpec.id === 'client') {
    delete manifest.dependencies
    delete manifest.devDependencies
    delete manifest.exports
    manifest.files = ['client', 'README.md', 'LICENSE']
  }
  await writeFile(
    join(destinationDirectory, 'package.json'),
    `${JSON.stringify(manifest, null, 2)}\n`,
  )
}

async function packPackage(stagedDirectory, requestedPath) {
  const target = resolve(requestedPath)
  const packRoot = await mkdtemp(join(tmpdir(), 'ze-great-dashboard-pack-'))
  try {
    execFileSync(
      'npm',
      ['pack', stagedDirectory, '--pack-destination', packRoot, '--ignore-scripts'],
      {
        cwd: root,
        stdio: 'inherit',
        env: { ...process.env, npm_config_cache: join(packRoot, 'npm-cache') },
      },
    )
    const tarballs = (await readdir(packRoot)).filter((file) => file.endsWith('.tgz'))
    if (tarballs.length !== 1)
      throw new Error(`npm pack wrote ${tarballs.length} tarballs instead of one`)
    await cp(join(packRoot, tarballs[0]), target)
    console.log(
      `${target} (sha512-${createHash('sha512')
        .update(await readFile(target))
        .digest('base64')})`,
    )
  } finally {
    await rm(packRoot, { recursive: true, force: true })
  }
}

async function publishTarball(tarball) {
  const manifest = await tarballManifest(tarball)
  if (manifest.version !== releaseVersion)
    throw new Error(
      `Tarball version ${manifest.version} does not match RELEASE_VERSION ${releaseVersion}`,
    )
  if (!publicPackages.some(({ name }) => name === manifest.name))
    throw new Error(`Tarball package ${manifest.name} is not a configured public package`)
  const packageName = manifest.name
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

async function tarballManifest(tarball) {
  const packageRoot = await mkdtemp(join(tmpdir(), 'ze-great-dashboard-tarball-'))
  try {
    execFileSync('tar', ['-xzf', tarball, '-C', packageRoot, 'package/package.json'])
    const manifest = JSON.parse(await readFile(join(packageRoot, 'package/package.json'), 'utf8'))
    if (typeof manifest.name !== 'string' || !manifest.name || typeof manifest.version !== 'string')
      throw new Error('Tarball package.json must contain a name and version')
    return manifest
  } finally {
    await rm(packageRoot, { recursive: true, force: true })
  }
}

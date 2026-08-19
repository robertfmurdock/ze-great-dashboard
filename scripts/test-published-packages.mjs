import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { packageLayout } from './package-layout.mjs'

const root = resolve(new URL('..', import.meta.url).pathname)
const stagingRoot = join(root, '.publish-staging-test')
const npmCache = await mkdtemp(join(tmpdir(), 'ze-great-dashboard-npm-cache-'))
try {
  const output = execFileSync('node', ['scripts/publish-packages.mjs', '--dry-run'], {
    cwd: root,
    encoding: 'utf8',
    env: {
      ...process.env,
      RELEASE_VERSION: '9.8.7',
      npm_config_cache: npmCache,
      PUBLISH_STAGING_DIR: stagingRoot,
    },
  })
  assert.equal(packageLayout.length, 1)
  assert.ok(output.includes('@continuous-excellence/ze-great-dashboard-aws@9.8.7'))
  assert.doesNotMatch(
    output,
    /@continuous-excellence\/ze-great-dashboard@|@ze-great-dashboard\/(?:shared|core)/,
  )
  assert.doesNotMatch(output, /\.ts\s/)

  assert.deepEqual(await readdir(stagingRoot), ['aws'])
  const manifest = JSON.parse(await readFile(join(stagingRoot, 'aws', 'package.json'), 'utf8'))
  assert.equal(manifest.license, 'MIT')
  assert.match(await readFile(join(stagingRoot, 'aws', 'LICENSE'), 'utf8'), /MIT License/)
  assert.deepEqual(Object.keys(manifest.dependencies).sort(), ['yaml', 'zod'])
  const publishedFiles = []
  async function collect(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name)
      if (entry.isDirectory()) await collect(path)
      else publishedFiles.push(path)
    }
  }
  await collect(join(stagingRoot, 'aws'))
  assert.ok(publishedFiles.every((file) => !file.endsWith('.ts') || file.endsWith('.d.ts')))
  for (const file of publishedFiles.filter(
    (file) => file.endsWith('.js') || file.endsWith('.d.ts'),
  )) {
    const contents = await readFile(file, 'utf8')
    assert.doesNotMatch(
      contents,
      /@continuous-excellence\/ze-great-dashboard@|@ze-great-dashboard\/(?:shared|core)/,
    )
    assert.doesNotMatch(contents, /from ['"].*\.ts['"]|import\(['"].*\.ts['"]\)/)
  }
  const publicApi = await import(pathToFileURL(join(stagingRoot, 'aws', 'dist', 'index.js')).href)
  const artifactRoot = await mkdtemp(join(tmpdir(), 'ze-great-dashboard-published-smoke-'))
  try {
    const metadata = await publicApi.packageLambda({
      boardConfigPath: join(root, 'boards/example.yaml'),
      outputDir: artifactRoot,
      version: '9.8.7',
    })
    assert.equal(metadata.dashboardVersion, '9.8.7')
    await publicApi.deployLambda({
      artifactDir: artifactRoot,
      assetsDir: join(artifactRoot, 'assets'),
      assetsBucket: 'unused',
      assetsBaseUrl: 'https://unused.example',
      functionName: 'unused',
      version: '9.8.7',
      dryRun: true,
    })
    assert.ok((await readdir(artifactRoot)).includes('lambda.zip'))
  } finally {
    await rm(artifactRoot, { recursive: true, force: true })
  }
} finally {
  await rm(stagingRoot, { recursive: true, force: true })
  await rm(npmCache, { recursive: true, force: true })
}
console.log('Published package staging and smoke test passed')

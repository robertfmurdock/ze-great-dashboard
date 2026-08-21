import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { chmod, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
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
  assert.match(
    await readFile(join(stagingRoot, 'aws', 'bootstrap', 'core-v1.yml'), 'utf8'),
    /BootstrapContractVersion/,
  )
  const stagedReadme = await readFile(join(stagingRoot, 'aws', 'README.md'), 'utf8')
  const rootReadme = await readFile(join(root, 'README.md'), 'utf8')
  assert.notEqual(stagedReadme, rootReadme)
  assert.match(
    stagedReadme,
    /npm install --save-exact @continuous-excellence\/ze-great-dashboard-aws@/,
  )
  assert.match(stagedReadme, /board\.yaml/)
  assert.match(stagedReadme, /ze-great-dashboard-aws package/)
  assert.match(stagedReadme, /aws s3 cp aws-dashboard-release\/lambda\.zip/)
  assert.match(stagedReadme, /aws cloudformation deploy/)
  assert.match(stagedReadme, /AWS bootstrap guide/)
  assert.match(stagedReadme, /protected API Gateway, ALB, or/)
  assert.match(stagedReadme, /never in board YAML, `aws-dashboard-parameters\.json`, or/)
  assert.deepEqual(Object.keys(manifest.dependencies).sort(), ['fflate', 'yaml', 'zod'])
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
    const parametersPath = join(artifactRoot, 'aws-dashboard-parameters.json')
    const releasePath = join(artifactRoot, 'release')
    const cli = join(stagingRoot, 'aws', 'dist', 'cli.js')
    const bootstrapTemplate = execFileSync(
      process.execPath,
      [cli, 'bootstrap', 'template', '--kind', 'core'],
      {
        cwd: root,
        encoding: 'utf8',
      },
    )
    assert.equal(
      JSON.parse(bootstrapTemplate).template,
      join(stagingRoot, 'aws', 'bootstrap', 'core-v1.yml'),
    )
    execFileSync(
      process.execPath,
      [cli, 'parameters', '--artifact-bucket', 'consumer-artifacts', '--output', parametersPath],
      { cwd: root, stdio: 'pipe' },
    )
    execFileSync(
      process.execPath,
      [
        cli,
        'package',
        '--board-config',
        join(root, 'boards/example.yaml'),
        '--output',
        releasePath,
      ],
      { cwd: root, stdio: 'pipe' },
    )
    const parameters = JSON.parse(await readFile(parametersPath, 'utf8'))
    assert.deepEqual(parameters, [
      { ParameterKey: 'LambdaArtifactBucket', ParameterValue: 'consumer-artifacts' },
    ])
    const metadata = JSON.parse(await readFile(join(releasePath, 'release.json'), 'utf8'))
    assert.equal(metadata.dashboardVersion, '9.8.7')
    assert.match(metadata.artifactKey, /^lambda\/[a-f0-9]{64}\.zip$/)
    await publicApi.deployLambda({
      artifactDir: releasePath,
      assetsDir: join(stagingRoot, 'aws', 'client'),
      assetsBucket: 'unused',
      assetsBaseUrl: 'https://unused.example',
      functionName: 'unused',
      version: '9.8.7',
      dryRun: true,
    })
    assert.ok((await readdir(releasePath)).includes('lambda.zip'))
    assert.ok((await readdir(releasePath)).includes('template.yml'))
  } finally {
    await rm(artifactRoot, { recursive: true, force: true })
  }

  const registryTestRoot = await mkdtemp(join(tmpdir(), 'ze-great-dashboard-registry-test-'))
  try {
    const tarball = join(registryTestRoot, 'package.tgz')
    const fakeNpm = join(registryTestRoot, 'npm')
    await writeFile(tarball, 'exact tarball bytes')
    await writeFile(
      fakeNpm,
      `#!/usr/bin/env node
if (process.argv[2] === 'view') console.log(JSON.stringify(process.env.FAKE_REGISTRY_INTEGRITY))
else throw new Error('publish must not be called when the version exists')
`,
    )
    await chmod(fakeNpm, 0o755)
    const integrity = `sha512-${createHash('sha512')
      .update(await readFile(tarball))
      .digest('base64')}`
    const publishEnvironment = {
      ...process.env,
      PATH: `${registryTestRoot}:${process.env.PATH}`,
      RELEASE_VERSION: '9.8.7',
    }
    const rerun = execFileSync(
      process.execPath,
      ['scripts/publish-packages.mjs', '--publish-tarball', tarball],
      {
        cwd: root,
        encoding: 'utf8',
        env: { ...publishEnvironment, FAKE_REGISTRY_INTEGRITY: integrity },
      },
    )
    assert.match(rerun, /matching integrity; skipping/)
    assert.throws(
      () =>
        execFileSync(
          process.execPath,
          ['scripts/publish-packages.mjs', '--publish-tarball', tarball],
          {
            cwd: root,
            stdio: 'pipe',
            env: {
              ...publishEnvironment,
              FAKE_REGISTRY_INTEGRITY: 'sha512-different-immutable-bytes',
            },
          },
        ),
      (error) => String(error.stderr).includes('Immutable npm version collision'),
    )
  } finally {
    await rm(registryTestRoot, { recursive: true, force: true })
  }
} finally {
  await rm(stagingRoot, { recursive: true, force: true })
  await rm(npmCache, { recursive: true, force: true })
}
console.log('Published package staging and smoke test passed')

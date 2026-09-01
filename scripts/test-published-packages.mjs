import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { chmod, mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
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
  assert.equal(packageLayout.length, 2)
  assert.deepEqual(
    packageLayout.map(({ id }) => id),
    ['client', 'aws'],
  )
  assert.ok(output.includes('@continuous-excellence/ze-great-dashboard-client@9.8.7'))
  assert.ok(output.includes('@continuous-excellence/ze-great-dashboard-aws@9.8.7'))
  assert.doesNotMatch(
    output,
    /@continuous-excellence\/ze-great-dashboard@|@ze-great-dashboard\/(?:shared|core)/,
  )
  assert.doesNotMatch(output, /\.ts\s/)

  assert.deepEqual((await readdir(stagingRoot)).sort(), ['aws', 'client'])
  const clientManifest = JSON.parse(
    await readFile(join(stagingRoot, 'client', 'package.json'), 'utf8'),
  )
  assert.equal(clientManifest.name, '@continuous-excellence/ze-great-dashboard-client')
  assert.equal(clientManifest.version, '9.8.7')
  assert.equal(clientManifest.dependencies, undefined)
  assert.equal(clientManifest.devDependencies, undefined)
  assert.deepEqual(clientManifest.files, ['client', 'README.md', 'LICENSE'])
  assert.match(
    await readFile(join(stagingRoot, 'client', 'README.md'), 'utf8'),
    /not an importable/,
  )
  assert.match(
    await readFile(join(stagingRoot, 'client', 'client', 'index.html'), 'utf8'),
    /__ASSET_PATH__/,
  )
  assert.ok(await stat(join(stagingRoot, 'client', 'client', 'board-config.schema.json')))
  const clientBundle = (await readdir(join(stagingRoot, 'client', 'client', 'assets'))).find(
    (name) => name.endsWith('.js'),
  )
  assert.ok(clientBundle)
  assert.match(
    await readFile(join(stagingRoot, 'client', 'client', 'assets', clientBundle), 'utf8'),
    /9\.8\.7/,
  )
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
    /npm install --save-exact @continuous-excellence\/ze-great-dashboard-aws/,
  )
  assert.match(stagedReadme, /board\.yaml/)
  assert.match(stagedReadme, /ze-great-dashboard-aws package/)
  assert.match(stagedReadme, /AWS bootstrap guide/)
  assert.match(stagedReadme, /docs\/aws-setup\.md/)
  assert.match(stagedReadme, /private AWS Lambda/)
  assert.match(stagedReadme, /consumer-owned gateway/)
  assert.match(stagedReadme, /resolves configured `token_env` names only at\s+Lambda cold start/)
  assert.deepEqual(Object.keys(manifest.dependencies).sort(), ['fflate', 'yaml', 'zod'])
  assert.equal(manifest.dependencies['@continuous-excellence/ze-great-dashboard-client'], undefined)
  const publishedFiles = []
  async function collect(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name)
      if (entry.isDirectory()) await collect(path)
      else publishedFiles.push(path)
    }
  }
  await collect(join(stagingRoot, 'aws'))
  assert.deepEqual(
    publishedFiles.filter(
      (file) => file.includes('/aws/client/') || file.endsWith('board-config.schema.json'),
    ),
    [],
  )
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
    assert.throws(
      () =>
        execFileSync(process.execPath, [cli, 'bootstrap', 'status', '--kind', 'core'], {
          cwd: root,
          stdio: 'pipe',
        }),
      (error) =>
        String(error.stderr).includes(
          'bootstrap init|upgrade|preflight|plan|check|guide|handoff|verify',
        ) && !String(error.stderr).includes('parameters|status|change-set'),
    )
    execFileSync(
      process.execPath,
      [cli, 'parameters', '--artifact-bucket', 'consumer-artifacts', '--output', parametersPath],
      { cwd: root, stdio: 'pipe' },
    )
    const parameters = JSON.parse(await readFile(parametersPath, 'utf8'))
    parameters.push({
      ParameterKey: 'SecretReference',
      ParameterValue: 'arn:aws:secretsmanager:us-east-1:123456789012:secret:dashboard',
    })
    await writeFile(parametersPath, `${JSON.stringify(parameters, null, 2)}\n`)
    execFileSync(
      process.execPath,
      [
        cli,
        'package',
        '--board-config',
        join(root, 'boards/example.yaml'),
        '--parameters',
        parametersPath,
        '--output',
        releasePath,
      ],
      { cwd: root, stdio: 'pipe' },
    )
    assert.deepEqual(parameters, [
      { ParameterKey: 'LambdaArtifactBucket', ParameterValue: 'consumer-artifacts' },
      {
        ParameterKey: 'SecretReference',
        ParameterValue: 'arn:aws:secretsmanager:us-east-1:123456789012:secret:dashboard',
      },
    ])
    const metadata = JSON.parse(await readFile(join(releasePath, 'release.json'), 'utf8'))
    assert.equal(metadata.dashboardVersion, '9.8.7')
    assert.match(metadata.artifactKey, /^lambda\/[a-f0-9]{64}\.zip$/)
    const releaseParameters = JSON.parse(
      await readFile(join(releasePath, 'parameters.json'), 'utf8'),
    )
    assert.equal(releaseParameters.length, 10)
    assert.equal(releaseParameters[2].ParameterValue, metadata.artifactKey)
    assert.equal(releaseParameters[3].ParameterValue, metadata.assetPath)
    const deployment = JSON.parse(await readFile(join(releasePath, 'deployment.json'), 'utf8'))
    assert.equal(deployment.parameters, 'parameters.json')
    assert.ok(deployment.commands.deploy.includes(`file://${releasePath}/parameters.json`))
    assert.ok((await readdir(releasePath)).includes('lambda.zip'))
    assert.ok((await readdir(releasePath)).includes('template.yml'))
  } finally {
    await rm(artifactRoot, { recursive: true, force: true })
  }

  const registryTestRoot = await mkdtemp(join(tmpdir(), 'ze-great-dashboard-registry-test-'))
  try {
    const clientTarball = join(registryTestRoot, 'client.tgz')
    const awsTarball = join(registryTestRoot, 'aws.tgz')
    const snapshotClientTarball = join(registryTestRoot, 'snapshot-client.tgz')
    const snapshotAwsTarball = join(registryTestRoot, 'snapshot-aws.tgz')
    const fakeNpm = join(registryTestRoot, 'npm')
    execFileSync(
      process.execPath,
      ['scripts/publish-packages.mjs', '--pack', clientTarball, '--pack', awsTarball],
      { cwd: root, env: { ...process.env, RELEASE_VERSION: '9.8.7' }, stdio: 'pipe' },
    )
    execFileSync(
      process.execPath,
      [
        'scripts/publish-packages.mjs',
        '--pack',
        snapshotClientTarball,
        '--pack',
        snapshotAwsTarball,
      ],
      { cwd: root, env: { ...process.env, RELEASE_VERSION: '9.8.7-SNAPSHOT' }, stdio: 'pipe' },
    )
    const mismatchedTarballRoot = join(registryTestRoot, 'mismatched-package')
    await mkdir(join(mismatchedTarballRoot, 'package'), { recursive: true })
    await writeFile(
      join(mismatchedTarballRoot, 'package', 'package.json'),
      '{"name":"@continuous-excellence/ze-great-dashboard-client","version":"9.8.6"}\n',
    )
    const mismatchedTarball = join(registryTestRoot, 'mismatched.tgz')
    execFileSync('tar', ['-czf', mismatchedTarball, '-C', mismatchedTarballRoot, 'package'])
    const extractedClient = join(registryTestRoot, 'extracted-client')
    await mkdir(extractedClient)
    execFileSync('tar', ['-xzf', clientTarball, '-C', extractedClient])
    assert.equal(
      await readFile(join(extractedClient, 'package', 'client', 'index.html'), 'utf8'),
      await readFile(join(stagingRoot, 'client', 'client', 'index.html'), 'utf8'),
    )
    await writeFile(
      fakeNpm,
      `#!/usr/bin/env node
if (process.argv[2] === 'view') console.log(JSON.stringify(process.env.FAKE_REGISTRY_INTEGRITY))
else throw new Error('publish must not be called when the version exists')
`,
    )
    await chmod(fakeNpm, 0o755)
    const integrity = async (tarball) =>
      `sha512-${createHash('sha512')
        .update(await readFile(tarball))
        .digest('base64')}`
    const publishEnvironment = {
      ...process.env,
      PATH: `${registryTestRoot}:${process.env.PATH}`,
      RELEASE_VERSION: '9.8.7',
    }
    assert.throws(
      () =>
        execFileSync(
          process.execPath,
          ['scripts/publish-packages.mjs', '--publish-tarball', mismatchedTarball],
          { cwd: root, stdio: 'pipe', env: publishEnvironment },
        ),
      (error) => String(error.stderr).includes('does not match RELEASE_VERSION'),
    )
    for (const tarball of [clientTarball, awsTarball]) {
      const rerun = execFileSync(
        process.execPath,
        ['scripts/publish-packages.mjs', '--publish-tarball', tarball],
        {
          cwd: root,
          encoding: 'utf8',
          env: { ...publishEnvironment, FAKE_REGISTRY_INTEGRITY: await integrity(tarball) },
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
    }

    const snapshotLog = join(registryTestRoot, 'snapshot-npm.log')
    await writeFile(
      fakeNpm,
      `#!/usr/bin/env node
const { writeFileSync } = require('node:fs')
if (process.argv[2] === 'ping') process.exit(0)
if (process.argv[2] === 'publish') {
  writeFileSync(process.env.FAKE_NPM_LOG, process.argv.slice(2).join('\\n'))
  process.exit(0)
}
throw new Error('unexpected npm command: ' + process.argv.slice(2).join(' '))
`,
    )
    await chmod(fakeNpm, 0o755)
    execFileSync(
      process.execPath,
      ['scripts/publish-packages.mjs', '--publish-tarball', snapshotClientTarball],
      {
        cwd: root,
        env: {
          ...publishEnvironment,
          RELEASE_VERSION: '9.8.7-SNAPSHOT',
          FAKE_NPM_LOG: snapshotLog,
        },
        stdio: 'pipe',
      },
    )
    const snapshotNpmArgs = await readFile(snapshotLog, 'utf8')
    assert.match(snapshotNpmArgs, /publish/)
    assert.match(snapshotNpmArgs, /--tag\nsnapshot/)
    assert.match(snapshotNpmArgs, /--dry-run/)
  } finally {
    await rm(registryTestRoot, { recursive: true, force: true })
  }
} finally {
  await rm(stagingRoot, { recursive: true, force: true })
  await rm(npmCache, { recursive: true, force: true })
}
console.log('Published package staging and smoke test passed')

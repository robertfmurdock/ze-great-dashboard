import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { packageLayout } from './package-layout.mjs'

const root = new URL('..', import.meta.url)
const rootPath = fileURLToPath(root)
const packageFiles = packageLayout.map((packageSpec) => `${packageSpec.directory}/package.json`)
const before = await Promise.all(
  packageFiles.map(async (file) => [file, await readFile(new URL(file, root), 'utf8')]),
)
const npmCache = await mkdtemp(join(tmpdir(), 'ze-great-dashboard-npm-cache-'))
let output
try {
  output = execFileSync('node', ['scripts/publish-packages.mjs', '--dry-run'], {
    cwd: rootPath,
    encoding: 'utf8',
    env: { ...process.env, RELEASE_VERSION: '9.8.7', npm_config_cache: npmCache },
  })
} finally {
  await rm(npmCache, { recursive: true, force: true })
}

for (const [file, contents] of before) {
  assert.equal(await readFile(new URL(file, root), 'utf8'), contents, `${file} was modified`)
}
for (const [, contents] of before) {
  const packageName = JSON.parse(contents).name
  assert.ok(output.includes(`${packageName}@9.8.7`), `${packageName} was not staged at 9.8.7`)
}
assert.doesNotMatch(output, /\.ts\s/)
console.log('Published package staging dry run passed')

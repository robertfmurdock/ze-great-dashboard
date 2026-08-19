import { execFileSync } from 'node:child_process'
import { cp, mkdir, rm } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'
import { internalPackageLayout } from './package-layout.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const directories = Object.fromEntries(
  internalPackageLayout.map((packageSpec) => [packageSpec.id, join(root, packageSpec.directory)]),
)
const tsc = join(root, 'node_modules/.bin/tsc')

await Promise.all(
  internalPackageLayout.map((packageSpec) =>
    rm(join(directories[packageSpec.id], 'dist'), { recursive: true, force: true }),
  ),
)
await rm(join(directories.aws, 'client'), { recursive: true, force: true })

await build({
  entryPoints: [join(directories.shared, 'src/index.ts')],
  bundle: true,
  format: 'esm',
  platform: 'node',
  target: 'node22',
  external: ['zod'],
  outfile: join(directories.shared, 'dist/index.js'),
})
declarations('shared')

await mkdir(join(directories.core, 'dist'), { recursive: true })
for (const [entry, outfile] of [
  ['index.ts', 'index.js'],
  ['cli.ts', 'cli.js'],
]) {
  await build({
    entryPoints: [join(directories.core, 'src', entry)],
    bundle: true,
    format: 'esm',
    platform: 'node',
    target: 'node22',
    external: ['@ze-great-dashboard/shared', 'yaml', 'zod'],
    outfile: join(directories.core, 'dist', outfile),
  })
}
declarations('core')

execFileSync('npm', ['run', 'build', '--workspace', '@ze-great-dashboard/client'], {
  cwd: root,
  stdio: 'inherit',
})
await cp(join(root, 'packages/client/dist'), join(directories.aws, 'client'), { recursive: true })

await build({
  entryPoints: [join(root, 'packages/server/src/lambda.ts')],
  bundle: true,
  format: 'esm',
  platform: 'node',
  target: 'node22',
  outfile: join(directories.aws, 'dist/lambda.mjs'),
  banner: {
    js: "import{createRequire}from'node:module';const require=createRequire(import.meta.url);",
  },
})

for (const [entry, outfile] of [
  ['index.ts', 'index.js'],
  ['cli.ts', 'cli.js'],
]) {
  await build({
    entryPoints: [join(directories.aws, 'src', entry)],
    bundle: true,
    format: 'esm',
    platform: 'node',
    target: 'node22',
    external: [
      'node:child_process',
      'node:fs/promises',
      'node:path',
      'node:url',
      'node:util',
      'yaml',
      'zod',
    ],
    outfile: join(directories.aws, 'dist', outfile),
  })
}
declarations('aws')

function declarations(packageId) {
  execFileSync(tsc, ['-p', join(directories[packageId], 'tsconfig.build.json')], {
    cwd: root,
    stdio: 'inherit',
  })
}

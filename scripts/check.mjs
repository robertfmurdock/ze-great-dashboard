import { checkEvidencePaths } from './check-evidence.mjs'
import { runCheck } from './check-runner.mjs'

const npm = process.env.npm_execpath ? [process.execPath, process.env.npm_execpath] : ['npm']
const npmRun = (script) => [...npm, 'run', script]
const evidence = checkEvidencePaths()

// This is intentionally a fixed graph: check is release evidence, not a configurable task runner.
const stages = [
  { id: 'lint', command: npmRun('lint') },
  { id: 'typecheck', command: npmRun('typecheck') },
  {
    id: 'build-packages',
    command: npmRun('build:packages'),
    // The published-package smoke test consumes this exact versioned immutable client.
    environment: { RELEASE_VERSION: '9.8.7' },
  },
  { id: 'container-endpoint', command: [process.execPath, 'scripts/container-endpoint.mjs'] },
  {
    id: 'node-tests',
    command: [
      process.execPath,
      '--test',
      '--test-reporter=junit',
      `--test-reporter-destination=${evidence.nodeJUnit}`,
      'scripts/auth0-functional-env.test.mjs',
      'scripts/check.test.mjs',
    ],
  },
  {
    id: 'vitest',
    command: [
      process.execPath,
      'node_modules/vitest/vitest.mjs',
      'run',
      '--reporter=junit',
      `--outputFile=${evidence.vitestJUnit}`,
    ],
    dependsOn: ['build-packages'],
  },
  {
    id: 'browser',
    command: npmRun('test:browser:no-build'),
    dependsOn: ['build-packages'],
    environment: { CHECK_RESULTS_DIR: evidence.directory },
  },
  {
    id: 'validate-example-board',
    command: [
      process.execPath,
      'packages/core/dist/cli.js',
      'validate',
      '--board-config',
      'boards/example.yaml',
    ],
    dependsOn: ['build-packages'],
  },
  {
    id: 'published-packages',
    command: npmRun('test:published:no-build'),
    dependsOn: ['build-packages'],
  },
]

process.exitCode = await runCheck(stages, { reportDirectory: evidence.directory })

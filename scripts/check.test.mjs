import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { mint } from '@continuous-excellence/testmints-js/vitest'
import { describe, test } from 'vitest'

import { checkEvidencePaths, playwrightEvidenceOptions } from './check-evidence.mjs'

const runnerUrl = new URL('./check-runner.mjs', import.meta.url).href
const nodeCommand = (source) => [process.execPath, '--input-type=module', '--eval', source]

describe('report configuration', () => {
  test(
    'uses a stable report layout for aggregate checks',
    mint({
      setup: () => '/tmp/dashboard-check-evidence',
      exercise: checkEvidencePaths,
      verify: (evidence, root) => {
        assert.equal(evidence.directory, join(root, 'check-results'))
        assert.equal(evidence.vitestJUnit, join(evidence.directory, 'vitest.xml'))
        assert.equal(evidence.playwrightJUnit, join(evidence.directory, 'playwright.xml'))
        assert.equal(evidence.playwrightArtifacts, join(evidence.directory, 'playwright-artifacts'))
        assert.equal(evidence.summaryMarkdown, join(evidence.directory, 'summary.md'))
      },
    }),
  )

  test(
    'gives the browser aggregate report paths',
    mint({
      setup: () => checkEvidencePaths('/tmp/dashboard-check-evidence'),
      exercise: ({ directory }) => playwrightEvidenceOptions(directory),
      verify: (options, evidence) =>
        assert.deepEqual(options, {
          junitOutputFile: evidence.playwrightJUnit,
          arguments: ['--reporter=junit', `--output=${evidence.playwrightArtifacts}`],
        }),
    }),
  )

  test(
    'omits browser reporting overrides for standalone runs',
    mint({
      setup: () => ({ directory: undefined }),
      exercise: ({ directory }) => playwrightEvidenceOptions(directory),
      verify: (options) => assert.equal(options, undefined),
    }),
  )
})

describe('stage validation', () => {
  for (const [name, stages, expected] of [
    [
      'duplicate ids',
      [
        { id: 'same', command: nodeCommand('process.exit(0)') },
        { id: 'same', command: nodeCommand('process.exit(0)') },
      ],
      /Duplicate check stage id/,
    ],
    [
      'unknown prerequisites',
      [{ id: 'known', command: nodeCommand('process.exit(0)'), dependsOn: ['missing'] }],
      /depends on unknown stage missing/,
    ],
    [
      'cycles',
      [
        { id: 'first', command: nodeCommand('process.exit(0)'), dependsOn: ['second'] },
        { id: 'second', command: nodeCommand('process.exit(0)'), dependsOn: ['first'] },
      ],
      /contains a cycle/,
    ],
  ]) {
    test(
      `rejects ${name} before a child can start`,
      mint({
        setup: () => stages,
        exercise: (stages) => run(stages),
        verify: (result) => {
          assert.equal(result.code, 1)
          assert.match(result.stderr, expected)
          assert.doesNotMatch(result.stdout, /START/)
        },
      }),
    )
  }
})

describe('stage scheduling', () => {
  test(
    'starts independent work together and honors prerequisites',
    mint({
      setup: async ({ scope }) => {
        const release = await releaseFixture(scope)
        return {
          release,
          stages: [
            { id: 'first', command: waitingCommand(release) },
            { id: 'second', command: nodeCommand('process.exit(0)') },
            { id: 'after-first', command: nodeCommand('process.exit(0)'), dependsOn: ['first'] },
          ],
        }
      },
      exercise: ({ stages, release }) => runUntilRelease(stages, release, `PASS ${stages[1].id} `),
      verify: ({ code, stdout }) => {
        assert.equal(code, 0)
        assert.match(
          stdout,
          /START first[\s\S]*START second[\s\S]*PASS second[\s\S]*PASS first[\s\S]*START after-first/,
        )
      },
    }),
  )

  test(
    'blocks dependents but lets unrelated active work finish after a failure',
    mint({
      setup: async ({ scope }) => {
        const release = await releaseFixture(scope)
        return {
          release,
          stages: [
            { id: 'fails', command: nodeCommand("console.log('broken'); process.exit(2)") },
            { id: 'independent', command: waitingCommand(release) },
            { id: 'blocked', command: nodeCommand('process.exit(0)'), dependsOn: ['fails'] },
          ],
        }
      },
      exercise: ({ stages, release }) => runUntilRelease(stages, release, `FAIL ${stages[0].id} `),
      verify: (result, { stages: [failure, independent, dependent] }) => {
        assert.equal(result.code, 1)
        assert.match(result.stdout, new RegExp(`^FAIL ${failure.id} .*exit 2$`, 'm'))
        assert.match(
          result.stdout,
          new RegExp(
            `START ${independent.id}[\\s\\S]*FAIL ${failure.id}[\\s\\S]*PASS ${independent.id}`,
          ),
        )
        assert.ok(result.stdout.includes(`BLOCKED ${dependent.id} (a prerequisite failed)`))
        assert.ok(!result.stdout.includes(`START ${dependent.id}\n`))
      },
    }),
  )

  test(
    'reports spawn errors and signal-terminated children as failures',
    mint({
      setup: () => [
        { id: 'missing', command: ['definitely-not-a-dashboard-command'] },
        { id: 'signaled', command: nodeCommand("process.kill(process.pid, 'SIGTERM')") },
      ],
      exercise: (stages) => run(stages),
      verify: (result) => {
        assert.equal(result.code, 1)
        assert.match(result.stdout, /FAIL missing .*could not start/)
        assert.match(result.stdout, /FAIL signaled .*terminated by SIGTERM/)
      },
    }),
  )
})

describe('check evidence', () => {
  test(
    'buffers child output and prints a declaration-order ledger',
    mint({
      setup: async ({ scope }) => {
        const release = await releaseFixture(scope)
        return {
          release,
          stages: [
            { id: 'slow-pass', command: waitingCommand(release, 'successful child output') },
            {
              id: 'failure',
              command: nodeCommand(
                "console.log('failure stdout'); console.error('failure stderr'); process.exit(7)",
              ),
            },
          ],
        }
      },
      exercise: ({ stages, release }) => runUntilRelease(stages, release, `FAIL ${stages[1].id} `),
      verify: (result) => {
        assert.equal(result.code, 1)
        assert.doesNotMatch(result.stdout, /successful child output|failure stdout|failure stderr/)
        assert.match(
          result.stderr,
          /--- FAIL failure output ---\nfailure stdout\nfailure stderr\n--- END FAIL failure output ---/,
        )
        const [progress, ledger] = result.stdout.split('CHECK LEDGER')
        assert.match(progress, /FAIL failure[\s\S]*PASS slow-pass/)
        assert.match(ledger, /PASSED slow-pass[^\n]*\nFAILED failure/)
      },
    }),
  )

  test(
    'replaces stale evidence and records passing stage results',
    mint({
      setup: async ({ scope }) => {
        const reportDirectory = await evidenceFixture(scope)
        const stale = join(reportDirectory, 'stale.txt')
        await writeFile(stale, 'old evidence')
        return {
          reportDirectory,
          stale,
          stages: [{ id: 'passes', command: nodeCommand('process.exit(0)') }],
        }
      },
      exercise: ({ stages, reportDirectory }) => run(stages, { reportDirectory }),
      verify: (result, { reportDirectory: directory, stale, stages }) => {
        assert.equal(result.code, 0)
        assert.equal(existsSync(stale), false)
        const summary = JSON.parse(readFileSync(join(directory, 'summary.json'), 'utf8'))
        assert.equal(summary.version, 1)
        assert.equal(typeof summary.totalDurationMs, 'number')
        assert.deepEqual(
          summary.stages.map(({ id, status }) => ({ id, status })),
          [{ id: stages[0].id, status: 'passed' }],
        )
        assert.equal(typeof summary.stages[0].durationMs, 'number')
        assert.match(readFileSync(join(directory, 'summary.md'), 'utf8'), /\| passes \| passed \|/)
      },
    }),
  )

  test(
    'records failed and blocked stages without copying child output into the evidence',
    mint({
      setup: async ({ scope }) => {
        const reportDirectory = await evidenceFixture(scope)
        const childOutput = 'not in evidence'
        const stages = [
          {
            id: 'fails',
            command: nodeCommand(`console.log(${JSON.stringify(childOutput)}); process.exit(2)`),
          },
          { id: 'blocked', command: nodeCommand('process.exit(0)'), dependsOn: ['fails'] },
        ]
        return { reportDirectory, childOutput, stages }
      },
      exercise: ({ stages, reportDirectory }) => run(stages, { reportDirectory }),
      verify: (result, { reportDirectory: directory, childOutput, stages }) => {
        assert.equal(result.code, 1)
        const summary = JSON.parse(readFileSync(join(directory, 'summary.json'), 'utf8'))
        assert.deepEqual(
          summary.stages.map(({ id, status, detail, reason }) => ({ id, status, detail, reason })),
          [
            { id: stages[0].id, status: 'failed', detail: 'exit 2', reason: undefined },
            {
              id: stages[1].id,
              status: 'blocked',
              detail: undefined,
              reason: 'a prerequisite failed',
            },
          ],
        )
        assert.equal(typeof summary.stages[0].durationMs, 'number')
        assert.ok(!readFileSync(join(directory, 'summary.md'), 'utf8').includes(childOutput))
      },
    }),
  )
})

describe('interruption', () => {
  for (const [signal, exitCode] of [
    ['SIGINT', 130],
    ['SIGTERM', 143],
  ]) {
    test(
      `${signal} reaches active children, drains cleanup, and exits nonzero`,
      mint({
        setup: async ({ scope }) => {
          const directory = await evidenceFixture(scope)
          const started = join(directory, 'started')
          const cleaned = join(directory, 'cleaned')
          const childSource = `
      import { writeFileSync } from 'node:fs'
      process.on(${JSON.stringify(signal)}, () => {
        writeFileSync(${JSON.stringify(cleaned)}, 'cleaned')
        setTimeout(() => process.exit(0), 30)
      })
      writeFileSync(${JSON.stringify(started)}, 'started')
      setInterval(() => {}, 1000)
    `
          const processResult = start([{ id: 'long-running', command: nodeCommand(childSource) }], {
            reportDirectory: join(directory, 'evidence'),
          })
          scope.defer('check subprocess', async () => {
            if (processResult.child.exitCode === null && processResult.child.signalCode === null) {
              processResult.child.kill()
            }
            await processResult.done
          })
          await waitForFixtureStart(processResult, started)
          return { processResult, cleaned, directory }
        },
        exercise: ({ processResult }) => {
          processResult.child.kill(signal)
          return processResult.done
        },
        verify: (result, { cleaned, directory }) => {
          assert.equal(result.code, exitCode)
          assert.equal(readFileSync(cleaned, 'utf8'), 'cleaned')
          assert.match(
            result.stdout,
            new RegExp(`BLOCKED .*interrupted by ${signal}|FAIL long-running`),
          )
          assert.match(result.stdout, /CHECK LEDGER/)
          const summary = JSON.parse(
            readFileSync(join(directory, 'evidence', 'summary.json'), 'utf8'),
          )
          assert.equal(summary.interruptedBy, signal)
        },
      }),
    )
  }
})

async function evidenceFixture(scope) {
  const directory = await mkdtemp(join(tmpdir(), 'dashboard-check-evidence-'))
  scope.defer('check evidence directory', () => rm(directory, { recursive: true, force: true }))
  return directory
}

async function releaseFixture(scope) {
  return join(await evidenceFixture(scope), 'release')
}

function waitingCommand(release, output) {
  return nodeCommand(`
    import { existsSync } from 'node:fs'
    import { setTimeout } from 'node:timers/promises'
    const deadline = performance.now() + 5000
    while (!existsSync(${JSON.stringify(release)})) {
      if (performance.now() >= deadline) throw new Error('Timed out waiting for stage release.')
      await setTimeout(10)
    }
    ${output === undefined ? '' : `console.log(${JSON.stringify(output)})`}
  `)
}

function runUntilRelease(stages, release, progress) {
  return start(stages, {
    onProgress: (stdout) => {
      if (stdout.includes(progress) && !existsSync(release)) writeFileSync(release, '')
    },
  }).done
}

function run(stages, options) {
  return start(stages, options).done
}

function start(stages, options = {}) {
  const reportDirectory =
    options.reportDirectory ?? join(tmpdir(), `dashboard-check-test-${randomUUID()}`)
  const removeReportDirectory = options.reportDirectory === undefined
  const source = `import { runCheck } from ${JSON.stringify(runnerUrl)}; process.exitCode = await runCheck(JSON.parse(process.argv[1]), { reportDirectory: process.argv[2] })`
  const child = spawn(
    process.execPath,
    ['--input-type=module', '--eval', source, JSON.stringify(stages), reportDirectory],
    {
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  )
  let stdout = ''
  let stderr = ''
  child.stdout.on('data', (chunk) => {
    stdout += chunk
    options.onProgress?.(stdout)
  })
  child.stderr.on('data', (chunk) => (stderr += chunk))
  const done = new Promise((resolve, reject) => {
    child.once('error', reject)
    child.once('close', (code, signal) =>
      resolve({ code: code ?? (signal ? 1 : 0), stdout, stderr }),
    )
  })
  return {
    child,
    done: removeReportDirectory
      ? done.finally(() => rm(reportDirectory, { recursive: true, force: true }))
      : done,
  }
}

async function waitForFixtureStart({ child, done }, started) {
  const deadline = performance.now() + 10_000
  while (!existsSync(started)) {
    if (child.exitCode !== null || child.signalCode !== null) {
      const { code, stderr } = await done
      throw new Error(
        `Check runner exited with code ${code} before the fixture was ready.\n${stderr}`,
      )
    }
    if (performance.now() > deadline)
      throw new Error('Timed out waiting for the signal fixture to become ready.')
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
}

import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { pathToFileURL } from 'node:url'

import { checkEvidence, checkEvidencePaths, playwrightEvidenceOptions } from './check-evidence.mjs'

const runnerUrl = pathToFileURL(new URL('./check-runner.mjs', import.meta.url).pathname).href
const nodeCommand = (source) => [process.execPath, '--input-type=module', '--eval', source]

test('uses one stable report layout and only gives browser JUnit arguments to aggregate checks', () => {
  const evidence = checkEvidencePaths('/tmp/dashboard-check-evidence')
  assert.equal(evidence.directory, '/tmp/dashboard-check-evidence/check-results')
  assert.equal(evidence.nodeJUnit, '/tmp/dashboard-check-evidence/check-results/node.xml')
  assert.equal(evidence.vitestJUnit, '/tmp/dashboard-check-evidence/check-results/vitest.xml')
  assert.equal(
    evidence.playwrightJUnit,
    '/tmp/dashboard-check-evidence/check-results/playwright.xml',
  )
  assert.equal(
    evidence.playwrightArtifacts,
    '/tmp/dashboard-check-evidence/check-results/playwright-artifacts',
  )
  assert.equal(playwrightEvidenceOptions(undefined), undefined)
  assert.deepEqual(playwrightEvidenceOptions(evidence.directory), {
    junitOutputFile: evidence.playwrightJUnit,
    arguments: ['--reporter=junit', `--output=${evidence.playwrightArtifacts}`],
  })
  assert.equal(checkEvidence.summaryMarkdown, 'summary.md')
})

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
  test(`rejects ${name} before a child can start`, async () => {
    const result = await run(stages)
    assert.equal(result.code, 1)
    assert.match(result.stderr, expected)
    assert.doesNotMatch(result.stdout, /START/)
  })
}

test('starts independent work together and honors prerequisites', async () => {
  const delay = 'await new Promise((resolve) => setTimeout(resolve, 100))'
  const result = await run([
    { id: 'first', command: nodeCommand(delay) },
    { id: 'second', command: nodeCommand(delay) },
    { id: 'after-first', command: nodeCommand('process.exit(0)'), dependsOn: ['first'] },
  ])
  assert.equal(result.code, 0)
  assert.ok(result.stdout.indexOf('START first') < result.stdout.indexOf('PASS first'))
  assert.ok(result.stdout.indexOf('START second') < result.stdout.indexOf('PASS first'))
  assert.ok(result.stdout.indexOf('START after-first') > result.stdout.indexOf('PASS first'))
})

test('buffers child output and prints a declaration-order ledger', async () => {
  const result = await run([
    {
      id: 'slow-pass',
      command: nodeCommand(
        "console.log('successful child output'); await new Promise((resolve) => setTimeout(resolve, 80))",
      ),
    },
    {
      id: 'failure',
      command: nodeCommand(
        "console.log('failure stdout'); console.error('failure stderr'); process.exit(7)",
      ),
    },
  ])
  assert.equal(result.code, 1)
  assert.doesNotMatch(result.stdout, /successful child output|failure stdout|failure stderr/)
  assert.match(
    result.stderr,
    /--- FAIL failure output ---\nfailure stdout\nfailure stderr\n--- END FAIL failure output ---/,
  )
  const ledger = result.stdout.slice(result.stdout.indexOf('CHECK LEDGER'))
  assert.ok(ledger.indexOf('PASSED slow-pass') < ledger.indexOf('FAILED failure'))
})

test('replaces stale evidence and records passing stage results', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'dashboard-check-evidence-'))
  try {
    await writeFile(join(directory, 'stale.txt'), 'old evidence')
    const result = await run([{ id: 'passes', command: nodeCommand('process.exit(0)') }], {
      reportDirectory: directory,
    })
    assert.equal(result.code, 0)
    assert.equal(existsSync(join(directory, 'stale.txt')), false)
    const summary = JSON.parse(readFileSync(join(directory, 'summary.json'), 'utf8'))
    assert.equal(summary.version, 1)
    assert.equal(typeof summary.totalDurationMs, 'number')
    assert.deepEqual(
      summary.stages.map(({ id, status }) => ({ id, status })),
      [{ id: 'passes', status: 'passed' }],
    )
    assert.equal(typeof summary.stages[0].durationMs, 'number')
    assert.match(readFileSync(join(directory, 'summary.md'), 'utf8'), /\| passes \| passed \|/)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test('blocks dependents but lets unrelated active work finish after a failure', async () => {
  const result = await run([
    { id: 'fails', command: nodeCommand("console.log('broken'); process.exit(2)") },
    {
      id: 'independent',
      command: nodeCommand('await new Promise((resolve) => setTimeout(resolve, 80))'),
    },
    { id: 'blocked', command: nodeCommand('process.exit(0)'), dependsOn: ['fails'] },
  ])
  assert.equal(result.code, 1)
  assert.match(result.stdout, /FAIL fails .*exit 2/)
  assert.match(result.stdout, /PASS independent/)
  assert.match(result.stdout, /BLOCKED blocked \(a prerequisite failed\)/)
})

test('records failed and blocked stages without copying child output into the evidence', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'dashboard-check-evidence-'))
  try {
    const result = await run(
      [
        { id: 'fails', command: nodeCommand("console.log('not in evidence'); process.exit(2)") },
        { id: 'blocked', command: nodeCommand('process.exit(0)'), dependsOn: ['fails'] },
      ],
      { reportDirectory: directory },
    )
    assert.equal(result.code, 1)
    const summary = JSON.parse(readFileSync(join(directory, 'summary.json'), 'utf8'))
    assert.deepEqual(
      summary.stages.map(({ id, status, detail, reason }) => ({ id, status, detail, reason })),
      [
        { id: 'fails', status: 'failed', detail: 'exit 2', reason: undefined },
        { id: 'blocked', status: 'blocked', detail: undefined, reason: 'a prerequisite failed' },
      ],
    )
    assert.equal(typeof summary.stages[0].durationMs, 'number')
    assert.doesNotMatch(readFileSync(join(directory, 'summary.md'), 'utf8'), /not in evidence/)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test('reports spawn errors and signal-terminated children as failures', async () => {
  const result = await run([
    { id: 'missing', command: ['definitely-not-a-dashboard-command'] },
    { id: 'signaled', command: nodeCommand("process.kill(process.pid, 'SIGTERM')") },
  ])
  assert.equal(result.code, 1)
  assert.match(result.stdout, /FAIL missing .*could not start/)
  assert.match(result.stdout, /FAIL signaled .*terminated by SIGTERM/)
})

for (const signal of ['SIGINT', 'SIGTERM']) {
  test(`${signal} reaches active children, drains cleanup, and exits nonzero`, async () => {
    const directory = await mkdtemp(join(tmpdir(), 'dashboard-check-signal-'))
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
    try {
      const processResult = start([{ id: 'long-running', command: nodeCommand(childSource) }], {
        reportDirectory: join(directory, 'evidence'),
      })
      await waitFor(() => existsSync(started))
      processResult.child.kill(signal)
      const result = await processResult.done
      assert.equal(result.code, signal === 'SIGINT' ? 130 : 143)
      assert.equal(readFileSync(cleaned, 'utf8'), 'cleaned')
      assert.match(
        result.stdout,
        new RegExp(`BLOCKED .*interrupted by ${signal}|FAIL long-running`),
      )
      assert.match(result.stdout, /CHECK LEDGER/)
      const summary = JSON.parse(readFileSync(join(directory, 'evidence', 'summary.json'), 'utf8'))
      assert.equal(summary.interruptedBy, signal)
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })
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
  child.stdout.on('data', (chunk) => (stdout += chunk))
  child.stderr.on('data', (chunk) => (stderr += chunk))
  const done = new Promise((resolve, reject) => {
    child.once('error', reject)
    child.once('exit', (code, signal) =>
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

async function waitFor(predicate) {
  const deadline = Date.now() + 2_000
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error('Timed out waiting for fixture process to start.')
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
}

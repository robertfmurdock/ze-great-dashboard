import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { pathToFileURL } from 'node:url'

const runnerUrl = pathToFileURL(new URL('./check-runner.mjs', import.meta.url).pathname).href
const nodeCommand = (source) => [process.execPath, '--input-type=module', '--eval', source]

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
      writeFileSync(${JSON.stringify(started)}, 'started')
      process.on(${JSON.stringify(signal)}, () => {
        writeFileSync(${JSON.stringify(cleaned)}, 'cleaned')
        setTimeout(() => process.exit(0), 30)
      })
      setInterval(() => {}, 1000)
    `
    try {
      const processResult = start([{ id: 'long-running', command: nodeCommand(childSource) }])
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
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })
}

function run(stages) {
  return start(stages).done
}

function start(stages) {
  const source = `import { runCheck } from ${JSON.stringify(runnerUrl)}; process.exitCode = await runCheck(JSON.parse(process.argv[1]))`
  const child = spawn(
    process.execPath,
    ['--input-type=module', '--eval', source, JSON.stringify(stages)],
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
  return { child, done }
}

async function waitFor(predicate) {
  const deadline = Date.now() + 2_000
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error('Timed out waiting for fixture process to start.')
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
}

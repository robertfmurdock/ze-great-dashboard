import { spawn } from 'node:child_process'
import { createWriteStream } from 'node:fs'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const signals = { SIGINT: 130, SIGTERM: 143 }

/**
 * Run a small, fixed dependency graph without letting concurrent child output interleave.
 * This is exported solely so the subprocess contract tests can exercise the same process boundary.
 */
export async function runCheck(stages, { cwd = process.cwd(), environment = process.env } = {}) {
  validateGraph(stages)
  const startedAt = performance.now()
  const logDirectory = await mkdtemp(join(tmpdir(), 'dashboard-check-'))
  const state = new Map(stages.map((stage) => [stage.id, { status: 'pending' }]))
  const active = new Map()
  let interruptedBy
  let wake

  const notify = () => {
    const current = wake
    wake = undefined
    current?.()
  }
  const interrupt = (signal) => {
    if (interruptedBy) return
    interruptedBy = signal
    for (const { child } of active.values()) child.kill(signal)
    notify()
  }
  for (const signal of Object.keys(signals)) process.once(signal, interrupt)

  try {
    while (active.size > 0 || [...state.values()].some(({ status }) => status === 'pending')) {
      let changed = false
      for (const stage of stages) {
        const result = state.get(stage.id)
        if (result.status !== 'pending') continue
        const dependencies = stage.dependsOn ?? []
        if (interruptedBy) {
          result.status = 'blocked'
          result.reason = `interrupted by ${interruptedBy}`
          console.log(`BLOCKED ${stage.id} (${result.reason})`)
          changed = true
        } else if (
          dependencies.some((id) => ['failed', 'blocked'].includes(state.get(id).status))
        ) {
          result.status = 'blocked'
          result.reason = 'a prerequisite failed'
          console.log(`BLOCKED ${stage.id} (${result.reason})`)
          changed = true
        } else if (dependencies.every((id) => state.get(id).status === 'passed')) {
          start(stage)
          changed = true
        }
      }
      if (active.size === 0 && !changed) break
      if (!changed) await new Promise((resolve) => (wake = resolve))
    }
  } finally {
    for (const signal of Object.keys(signals)) process.removeListener(signal, interrupt)
    printLedger(stages, state, startedAt)
    for (const stage of stages) {
      const result = state.get(stage.id)
      if (result.status === 'failed' && result.logPath) {
        const output = await readFile(result.logPath, 'utf8')
        console.error(`\n--- FAIL ${stage.id} output ---`)
        process.stderr.write(output || '(no child output)\n')
        if (!output.endsWith('\n')) process.stderr.write('\n')
        console.error(`--- END FAIL ${stage.id} output ---`)
      }
    }
    await rm(logDirectory, { recursive: true, force: true })
  }

  if (interruptedBy) return signals[interruptedBy]
  return [...state.values()].every(({ status }) => status === 'passed') ? 0 : 1

  function start(stage) {
    const result = state.get(stage.id)
    result.status = 'running'
    result.startedAt = performance.now()
    result.logPath = join(logDirectory, `${stages.indexOf(stage)}-${stage.id}.log`)
    console.log(`START ${stage.id}`)
    const log = createWriteStream(result.logPath, { flags: 'a', mode: 0o600 })
    let settled = false
    let child
    const finish = (outcome, detail) => {
      if (settled) return
      settled = true
      log.end(() => {
        result.status = outcome
        result.detail = detail
        result.duration = performance.now() - result.startedAt
        active.delete(stage.id)
        const label = outcome === 'passed' ? 'PASS' : 'FAIL'
        console.log(
          `${label} ${stage.id} (${formatDuration(result.duration)})${detail ? `: ${detail}` : ''}`,
        )
        notify()
      })
    }
    try {
      child = spawn(stage.command[0], stage.command.slice(1), {
        cwd,
        env: { ...environment, ...stage.environment },
        shell: false,
        stdio: ['ignore', 'pipe', 'pipe'],
      })
      active.set(stage.id, { child })
      child.stdout.pipe(log, { end: false })
      child.stderr.pipe(log, { end: false })
      child.once('error', (error) => finish('failed', `could not start: ${error.message}`))
      child.once('close', (code, signal) => {
        if (interruptedBy) finish('failed', `interrupted by ${interruptedBy}`)
        else if (signal) finish('failed', `terminated by ${signal}`)
        else if (code === 0) finish('passed')
        else finish('failed', `exit ${code}`)
      })
    } catch (error) {
      finish('failed', `could not start: ${error.message}`)
    }
  }
}

export function validateGraph(stages) {
  if (!Array.isArray(stages) || stages.length === 0)
    throw new Error('Check graph must contain stages.')
  const ids = new Set()
  for (const stage of stages) {
    if (!stage || typeof stage.id !== 'string' || stage.id.length === 0) {
      throw new Error('Every check stage needs a nonempty id.')
    }
    if (ids.has(stage.id)) throw new Error(`Duplicate check stage id: ${stage.id}`)
    ids.add(stage.id)
    if (
      !Array.isArray(stage.command) ||
      stage.command.length === 0 ||
      stage.command.some((arg) => typeof arg !== 'string' || arg.length === 0)
    ) {
      throw new Error(`Check stage ${stage.id} needs a nonempty command argument vector.`)
    }
    const dependencies = stage.dependsOn ?? []
    if (!Array.isArray(dependencies) || new Set(dependencies).size !== dependencies.length) {
      throw new Error(`Check stage ${stage.id} has duplicate or invalid dependencies.`)
    }
    if (
      stage.environment !== undefined &&
      (typeof stage.environment !== 'object' ||
        stage.environment === null ||
        Object.values(stage.environment).some((value) => typeof value !== 'string'))
    ) {
      throw new Error(`Check stage ${stage.id} has an invalid environment.`)
    }
  }
  for (const stage of stages)
    for (const dependency of stage.dependsOn ?? []) {
      if (!ids.has(dependency))
        throw new Error(`Check stage ${stage.id} depends on unknown stage ${dependency}.`)
    }
  const visiting = new Set()
  const visited = new Set()
  const byId = new Map(stages.map((stage) => [stage.id, stage]))
  const visit = (id) => {
    if (visiting.has(id)) throw new Error(`Check graph contains a cycle at ${id}.`)
    if (visited.has(id)) return
    visiting.add(id)
    for (const dependency of byId.get(id).dependsOn ?? []) visit(dependency)
    visiting.delete(id)
    visited.add(id)
  }
  for (const stage of stages) visit(stage.id)
}

function printLedger(stages, state, startedAt) {
  console.log('\nCHECK LEDGER')
  for (const stage of stages) {
    const result = state.get(stage.id)
    const duration = result.duration ? ` (${formatDuration(result.duration)})` : ''
    const detail = result.detail || result.reason ? `: ${result.detail ?? result.reason}` : ''
    console.log(`${result.status.toUpperCase()} ${stage.id}${duration}${detail}`)
  }
  console.log(`TOTAL (${formatDuration(performance.now() - startedAt)})`)
}

function formatDuration(milliseconds) {
  return `${(milliseconds / 1000).toFixed(1)}s`
}

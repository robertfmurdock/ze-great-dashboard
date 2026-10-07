import { spawnSync } from 'node:child_process'
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const directory = fileURLToPath(new URL('.', import.meta.url))
const results = resolve(process.env.TESTMINTS_STUDY_ROOT ?? directory, 'results')
const args = process.argv.slice(2)
const usage = `Usage: node experiments/testmints-two-call-boundary-comprehension/run-participant.mjs
  --run-id <anonymous-id> --model "GPT-6.1 Sol" --reasoning medium|high
  --workspace <path> --events-file <agent-event-ndjson> --explanation-file <path> [--codex-json] -- <agent command>`
const value = (flag) => {
  const found = args.indexOf(flag)
  const result = found === -1 ? undefined : args[found + 1]
  if (!result) throw new Error(`${flag} is required\n${usage}`)
  return result
}
const separator = args.indexOf('--')
if (separator === -1 || separator === args.length - 1) throw new Error(usage)
const runId = value('--run-id')
const model = value('--model')
const reasoning = value('--reasoning')
if (model !== 'GPT-6.1 Sol' || !['medium', 'high'].includes(reasoning))
  throw new Error('Invalid profile')
const workspace = resolve(value('--workspace'))
const eventsFile = resolve(value('--events-file'))
const explanationFile = resolve(value('--explanation-file'))
const telemetryFile = resolve(results, 'telemetry', `${runId}.json`)
const codexJson = args.includes('--codex-json')

try {
  await stat(eventsFile)
  throw new Error('Refusing an existing events file; telemetry must start empty')
} catch (error) {
  if (!(error && typeof error === 'object' && error.code === 'ENOENT')) throw error
}
try {
  await stat(telemetryFile)
  throw new Error(`Immutable telemetry already exists: ${telemetryFile}`)
} catch (error) {
  if (!(error && typeof error === 'object' && error.code === 'ENOENT')) throw error
}

const startedAt = new Date().toISOString()
const startedMonotonicNs = process.hrtime.bigint().toString()
const command = args.slice(separator + 1)
const execution = spawnSync(command[0], command.slice(1), {
  cwd: workspace,
  env: { ...process.env, EXPERIMENT_AGENT_EVENTS_FILE: eventsFile },
  encoding: codexJson ? 'utf8' : undefined,
  stdio: codexJson ? 'pipe' : 'inherit',
})
const endedAt = new Date().toISOString()
const endedMonotonicNs = process.hrtime.bigint().toString()
if (execution.error) throw execution.error
if (codexJson) {
  process.stdout.write(execution.stderr ?? '')
  await writeFile(eventsFile, execution.stdout ?? '', { flag: 'wx' })
}

const lines = (await readFile(eventsFile, 'utf8')).trim().split('\n').filter(Boolean)
const events = lines.map((line, index) => {
  try {
    return JSON.parse(line)
  } catch {
    throw new Error(`Invalid event ${index + 1}`)
  }
})
if (!events.every((event) => event && typeof event.type === 'string'))
  throw new Error('Every instrumented event requires a type')
const commandItems = codexJson
  ? events
      .filter(
        (event) => event.type === 'item.completed' && event.item?.type === 'command_execution',
      )
      .map((event) => event.item)
  : events.filter((event) => event.type === 'tool-call')
if (!codexJson && !events.every((event) => typeof event.monotonicNs === 'string'))
  throw new Error('Every non-Codex event requires monotonicNs')
const toolCallCount = commandItems.length
const testCommandCount = codexJson
  ? commandItems.filter((item) =>
      /(?:npm\s+(?:run\s+)?(?:check|test)|vitest\b)/.test(item.command ?? ''),
    ).length
  : events.filter((event) => event.type === 'test-command').length
let explanation
try {
  explanation = await readFile(explanationFile, 'utf8')
} catch (error) {
  if (!codexJson || error?.code !== 'ENOENT') throw error
  explanation = [...events]
    .reverse()
    .find((event) => event.type === 'item.completed' && event.item?.type === 'agent_message')
    ?.item?.text
}
if (!explanation.trim()) throw new Error('Final explanation is required')
const telemetry = {
  schemaVersion: 1,
  runId,
  model,
  reasoning,
  workspace,
  startedAt,
  endedAt,
  startedMonotonicNs,
  endedMonotonicNs,
  toolCallCount,
  testCommandCount,
  finalExplanation: explanation,
  completionStatus: execution.status === 0 ? 'completed' : 'failed',
  agentExitCode: execution.status,
  events,
  telemetrySource: codexJson ? 'codex-exec-jsonl' : 'agent-event-ndjson',
}
await mkdir(dirname(telemetryFile), { recursive: true })
await writeFile(telemetryFile, `${JSON.stringify(telemetry, null, 2)}\n`, { flag: 'wx' })
console.log(`Wrote immutable telemetry: ${telemetryFile}`)
process.exitCode = execution.status ?? 1

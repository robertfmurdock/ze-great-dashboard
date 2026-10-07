import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { cp, mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { dirname, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const experiment = fileURLToPath(new URL('.', import.meta.url))
const templates = resolve(experiment, 'templates')
const stateRoot = process.env.TESTMINTS_STUDY_ROOT
  ? resolve(process.env.TESTMINTS_STUDY_ROOT)
  : experiment
const workspaces = resolve(
  process.env.TESTMINTS_WORKSPACES_ROOT ?? resolve(stateRoot, '.workspaces'),
)
const results = resolve(stateRoot, 'results')
const seed = 'testmints-two-call-boundary-comprehension-2026-10-06'
const args = process.argv.slice(2)
const npmCache = process.env.TESTMINTS_NPM_CACHE ?? '/tmp/testmints-two-call-boundary-npm-cache'
const usage = `Usage:
  node experiments/testmints-two-call-boundary-comprehension/create-task.mjs --condition native|testmints --directory <empty-directory> [--install]
  node experiments/testmints-two-call-boundary-comprehension/create-task.mjs --preflight
  node experiments/testmints-two-call-boundary-comprehension/create-task.mjs --prepare [--install]
  node experiments/testmints-two-call-boundary-comprehension/create-task.mjs --complete --run-id <anonymous-id>
  node experiments/testmints-two-call-boundary-comprehension/create-task.mjs --review-packets
  node experiments/testmints-two-call-boundary-comprehension/create-task.mjs --score-reviews --reviewer one|two --scores-file <path>
  node experiments/testmints-two-call-boundary-comprehension/create-task.mjs --adjudicate --scores-file <path>
  node experiments/testmints-two-call-boundary-comprehension/create-task.mjs --report`
const value = (flag, required = false) => {
  const index = args.indexOf(flag)
  const result = index === -1 ? undefined : args[index + 1]
  if (required && !result) throw new Error(`${flag} is required\n${usage}`)
  return result
}
if (args.includes('--help')) {
  console.log(usage)
  process.exit(0)
}

function npm(directory, command, quiet = false) {
  const result = spawnSync('npm', command, {
    cwd: directory,
    encoding: 'utf8',
    env: { ...process.env, npm_config_cache: npmCache },
  })
  if (result.error) throw result.error
  if (!quiet) process.stdout.write(`${result.stdout ?? ''}${result.stderr ?? ''}`)
  return { pass: result.status === 0, output: `${result.stdout ?? ''}${result.stderr ?? ''}` }
}
async function exists(path) {
  try {
    await stat(path)
    return true
  } catch (error) {
    if (error?.code === 'ENOENT') return false
    throw error
  }
}
async function createTask(destination, condition, install) {
  if (!['native', 'testmints'].includes(condition))
    throw new Error('--condition must be native or testmints')
  if (await exists(destination)) throw new Error(`Refusing to overwrite ${destination}`)
  await mkdir(dirname(destination), { recursive: true })
  await cp(resolve(templates, 'common'), destination, { recursive: true })
  await cp(resolve(templates, condition), destination, { recursive: true })
  await writeFile(
    resolve(destination, 'TASK.md'),
    await readFile(resolve(experiment, 'TASK.md'), 'utf8'),
  )
  if (install) {
    const result = npm(destination, ['install', '--ignore-scripts'])
    if (!result.pass) throw new Error('npm install failed')
  }
  await assertIsolation(destination, condition)
}
async function listFiles(directory, prefix = '') {
  const output = []
  for (const entry of await readdir(resolve(directory, prefix), { withFileTypes: true })) {
    if (entry.name === 'node_modules') continue
    const child = relative(directory, resolve(directory, prefix, entry.name))
    if (entry.isDirectory()) output.push(...(await listFiles(directory, child)))
    else output.push(child)
  }
  return output
}
async function assertIsolation(directory, condition) {
  const files = await listFiles(directory)
  if (files.some((file) => file.includes('.coordinator-hidden') || file.includes('/templates/')))
    throw new Error('Generated workspace leaks coordinator material')
  const test = await readFile(resolve(directory, 'test/pipeline-refresh.test.ts'), 'utf8')
  if (test.includes('mintTest(') !== (condition === 'testmints'))
    throw new Error('Generated workspace has alternate representation')
}
async function verify(directory) {
  const hidden = resolve(directory, 'test/.coordinator-hidden.test.ts')
  await writeFile(hidden, hiddenVerifier)
  try {
    return npm(directory, ['run', 'check'], true)
  } finally {
    await rm(hidden, { force: true })
  }
}
async function preflight() {
  const root = resolve(workspaces, 'preflight')
  await rm(root, { recursive: true, force: true })
  const records = []
  try {
    for (const condition of ['native', 'testmints']) {
      const baseline = resolve(root, condition, 'baseline')
      await createTask(baseline, condition, true)
      const visible = npm(baseline, ['run', 'check'], true)
      const hidden = await verify(baseline)
      const visibleName = 'reports a provider failure without replacing the existing observation'
      const visibleTests = (await listFiles(resolve(baseline, 'test'))).filter((file) =>
        file.endsWith('.test.ts'),
      )
      if (
        visible.pass ||
        !visible.output.includes(visibleName) ||
        visibleTests.length !== 1 ||
        hidden.pass
      )
        throw new Error(`${condition} baseline did not fail only its supplied regression boundary`)
      const intended = resolve(root, condition, 'intended')
      await createTask(intended, condition, true)
      const source = resolve(intended, 'src/pipeline-refresh.ts')
      const original = await readFile(source, 'utf8')
      const corrected = original.replace('        cachedObservation = undefined\n', '')
      if (corrected === original) throw new Error('Intended correction did not apply')
      await writeFile(source, corrected)
      const fixedVisible = npm(intended, ['run', 'check'], true)
      const fixedHidden = await verify(intended)
      if (!fixedVisible.pass || !fixedHidden.pass)
        throw new Error(`${condition} production-only correction failed`)
      records.push({
        condition,
        baselineVisibleFailsOnlySuppliedRegression: true,
        baselineHiddenFails: true,
        productionOnlyCorrectionPassesVisibleAndHidden: true,
      })
    }
  } finally {
    await rm(root, { recursive: true, force: true })
  }
  await mkdir(results, { recursive: true })
  await writeFile(
    resolve(results, 'preflight.json'),
    `${JSON.stringify({ ranAt: new Date().toISOString(), records }, null, 2)}\n`,
  )
  console.log('Preflight passed for both conditions.')
}
function assignments() {
  let state = 0
  for (const char of seed) state = (state * 31 + char.charCodeAt(0)) >>> 0
  const cells = ['medium', 'high'].flatMap((reasoning) =>
    ['native', 'testmints'].flatMap((condition) =>
      Array.from({ length: 4 }, () => ({ condition, reasoning })),
    ),
  )
  for (let index = cells.length - 1; index > 0; index -= 1) {
    state = (1664525 * state + 1013904223) >>> 0
    const swap = Math.floor((state / 2 ** 32) * (index + 1))
    ;[cells[index], cells[swap]] = [cells[swap], cells[index]]
  }
  return cells.map((cell, index) => ({
    id: `run-${String(index + 1).padStart(2, '0')}`,
    ...cell,
    model: 'GPT-6.1 Sol',
    status: 'prepared',
  }))
}
async function hash(path) {
  return createHash('sha256')
    .update(await readFile(path))
    .digest('hex')
}
async function prepare(install) {
  if (
    (await exists(resolve(results, 'manifest.json'))) ||
    ((await exists(workspaces)) && (await readdir(workspaces)).length)
  )
    throw new Error('Study state exists; preserve it as evidence.')
  if (!(await exists(resolve(experiment, 'run-participant.mjs'))))
    throw new Error('Cannot dispatch without the instrumented participant runner')
  const manifest = {
    schemaVersion: 2,
    study: 'testmints-two-call-boundary-comprehension',
    randomizationSeed: seed,
    createdAt: new Date().toISOString(),
    handoffPrompt:
      'Implement TASK.md, run npm run check, and answer the requested boundary question.',
    toolPolicy:
      'Assigned workspace only; coordinator files, alternate representation, and hidden verifier are unavailable.',
    assignments: assignments(),
  }
  await mkdir(results, { recursive: true })
  for (const assignment of manifest.assignments) {
    const workspace = resolve(workspaces, assignment.id)
    await createTask(workspace, assignment.condition, install)
    const baseline = resolve(results, 'baselines', assignment.id)
    await cp(workspace, baseline, {
      recursive: true,
      filter: (entry) => !entry.includes('/node_modules'),
    })
    assignment.visibleTestSha256 = await hash(resolve(workspace, 'test/pipeline-refresh.test.ts'))
  }
  await writeFile(resolve(results, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`)
  console.log('Prepared 16 isolated workspaces with immutable visible-test hashes.')
}
async function telemetry(runId, assignment) {
  const path = resolve(results, 'telemetry', `${runId}.json`)
  if (!(await exists(path)))
    throw new Error(
      `No captured telemetry for ${runId}; do not launch or record an uninstrumented run`,
    )
  const data = JSON.parse(await readFile(path, 'utf8'))
  if (
    data.runId !== runId ||
    data.model !== assignment.model ||
    data.reasoning !== assignment.reasoning ||
    !['completed', 'failed'].includes(data.completionStatus)
  )
    throw new Error('Telemetry profile or status is invalid')
  if (
    !Number.isInteger(data.toolCallCount) ||
    !Number.isInteger(data.testCommandCount) ||
    !Array.isArray(data.events) ||
    !data.finalExplanation?.trim()
  )
    throw new Error('Telemetry is incomplete')
  if (
    !data.startedAt ||
    !data.endedAt ||
    BigInt(data.endedMonotonicNs) < BigInt(data.startedMonotonicNs)
  )
    throw new Error('Telemetry clocks are invalid')
  return data
}
async function complete() {
  const runId = value('--run-id', true)
  const manifest = JSON.parse(await readFile(resolve(results, 'manifest.json'), 'utf8'))
  const assignment = manifest.assignments.find((item) => item.id === runId)
  if (!assignment) throw new Error(`Unknown run ${runId}`)
  const recordPath = resolve(results, `${runId}.json`)
  if (await exists(recordPath)) throw new Error(`Immutable run record exists: ${runId}`)
  const workspace = resolve(workspaces, runId)
  await assertIsolation(workspace, assignment.condition)
  const visibleTestUnchanged =
    (await hash(resolve(workspace, 'test/pipeline-refresh.test.ts'))) ===
    assignment.visibleTestSha256
  if (!visibleTestUnchanged)
    throw new Error(`Visible test hash changed for ${runId}; this run is not valid study evidence`)
  const visible = npm(workspace, ['run', 'check'], true)
  const hidden = await verify(workspace)
  const captured = await telemetry(runId, assignment)
  const elapsedMilliseconds =
    Number(BigInt(captured.endedMonotonicNs) - BigInt(captured.startedMonotonicNs)) / 1e6
  const record = {
    ...assignment,
    telemetry: captured,
    visibleCheck: visible.pass ? 'pass' : 'fail',
    hiddenContract: hidden.pass ? 'pass' : 'fail',
    visibleTestUnchanged,
    elapsedMilliseconds,
    review: { reviewerOne: null, reviewerTwo: null, adjudication: null, resolved: null },
    recordedAt: new Date().toISOString(),
  }
  await writeFile(recordPath, `${JSON.stringify(record, null, 2)}\n`, { flag: 'wx' })
  console.log(`Recorded ${runId}.`)
}
const rubric = [
  'The first public refresh establishes the state precondition.',
  'The second public refresh is the subject of the test.',
  'Cached evidence remains unchanged after the failure.',
  'Failure neither publishes evidence nor leaks the lease.',
]
async function records() {
  if (!(await exists(results))) return []
  return Promise.all(
    (await readdir(results))
      .filter((file) => /^run-\d\d\.json$/.test(file))
      .sort()
      .map(async (file) => JSON.parse(await readFile(resolve(results, file), 'utf8'))),
  )
}
function redacted(explanation) {
  return explanation
    .replaceAll(/Testmints/gi, 'test')
    .replaceAll(/native Vitest/gi, 'test')
    .replaceAll(/Vitest/gi, 'test')
}
async function reviewPackets() {
  const packet = {
    rubric,
    records: (await records()).map((record) => ({
      runId: record.id,
      explanation: redacted(record.telemetry.finalExplanation),
    })),
  }
  await writeFile(resolve(results, 'review-packets.json'), `${JSON.stringify(packet, null, 2)}\n`)
  console.log(`Prepared ${packet.records.length} condition/profile-blind packets.`)
}
function validScore(score) {
  return (
    Array.isArray(score) && score.length === 4 && score.every((entry) => entry === 0 || entry === 1)
  )
}
async function scoreReviews() {
  const reviewer = value('--reviewer', true)
  if (!['one', 'two'].includes(reviewer)) throw new Error('--reviewer must be one or two')
  const scores = JSON.parse(await readFile(resolve(value('--scores-file', true)), 'utf8'))
  for (const record of await records()) {
    if (!validScore(scores[record.id])) throw new Error(`Invalid score for ${record.id}`)
    record.review[reviewer === 'one' ? 'reviewerOne' : 'reviewerTwo'] = scores[record.id]
    await writeFile(resolve(results, `${record.id}.json`), `${JSON.stringify(record, null, 2)}\n`)
  }
  console.log(`Recorded reviewer ${reviewer}.`)
}
async function adjudicate() {
  const scores = JSON.parse(await readFile(resolve(value('--scores-file', true)), 'utf8'))
  const log = []
  for (const record of await records()) {
    const { reviewerOne, reviewerTwo } = record.review
    if (!validScore(reviewerOne) || !validScore(reviewerTwo))
      throw new Error(`Both reviewer scores required: ${record.id}`)
    if (JSON.stringify(reviewerOne) === JSON.stringify(reviewerTwo))
      record.review.resolved = reviewerOne
    else {
      if (!validScore(scores[record.id]))
        throw new Error(`Adjudication score required: ${record.id}`)
      record.review.adjudication = {
        score: scores[record.id],
        recordedAt: new Date().toISOString(),
      }
      record.review.resolved = scores[record.id]
      log.push({ runId: record.id, reviewerOne, reviewerTwo, adjudicated: scores[record.id] })
    }
    await writeFile(resolve(results, `${record.id}.json`), `${JSON.stringify(record, null, 2)}\n`)
  }
  await writeFile(resolve(results, 'adjudications.json'), `${JSON.stringify(log, null, 2)}\n`)
  console.log(`Resolved reviews; ${log.length} adjudications recorded.`)
}
const median = (numbers) => {
  const sorted = [...numbers].sort((a, b) => a - b)
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2
}
const total = (values) => values.reduce((sum, value) => sum + value, 0)
async function report() {
  const all = await records()
  if (all.length !== 16 || all.some((record) => !record.review.resolved))
    throw new Error('All 16 recorded runs and resolved reviews are required before reporting')
  const cells = ['native', 'testmints'].flatMap((condition) =>
    ['medium', 'high'].map((reasoning) => {
      const runs = all.filter(
        (record) => record.condition === condition && record.reasoning === reasoning,
      )
      return {
        condition,
        reasoning,
        runs: runs.map((record) => ({
          id: record.id,
          visibleCheck: record.visibleCheck,
          hiddenContract: record.hiddenContract,
          elapsedMilliseconds: record.elapsedMilliseconds,
          toolInvocations: record.telemetry.toolCallCount,
          testInvocations: record.telemetry.testCommandCount,
          explanationScore: total(record.review.resolved),
        })),
      }
    }),
  )
  const aggregate = (condition) => all.filter((record) => record.condition === condition)
  const native = aggregate('native')
  const testmints = aggregate('testmints')
  const passes = (runs) => runs.filter((record) => record.hiddenContract === 'pass').length
  const noReasoningLoss = ['medium', 'high'].every(
    (reasoning) =>
      passes(testmints.filter((record) => record.reasoning === reasoning)) >=
      passes(native.filter((record) => record.reasoning === reasoning)),
  )
  const endpointNoWeaker = testmints.every(
    (record) => record.visibleCheck === 'pass' && record.visibleTestUnchanged,
  )
  const nativeMedian = median(native.map((record) => record.elapsedMilliseconds))
  const testmintsMedian = median(testmints.map((record) => record.elapsedMilliseconds))
  const promising =
    passes(testmints) >= passes(native) + 2 &&
    noReasoningLoss &&
    endpointNoWeaker &&
    testmintsMedian <= nativeMedian * 1.2
  const output = {
    generatedAt: new Date().toISOString(),
    primaryOutcome: 'hidden public-contract pass',
    rawCells: cells,
    summary: {
      nativeHiddenPasses: passes(native),
      testmintsHiddenPasses: passes(testmints),
      nativeMedianElapsedMilliseconds: nativeMedian,
      testmintsMedianElapsedMilliseconds: testmintsMedian,
      noReasoningCellLoss: noReasoningLoss,
      noWeakerHiddenEndpointEvidence: endpointNoWeaker,
      decision: promising ? 'directionally-promising' : 'not-directionally-promising',
    },
  }
  await writeFile(resolve(results, 'report.json'), `${JSON.stringify(output, null, 2)}\n`)
  console.log(output.summary.decision)
}
const hiddenVerifier = `import { expect, it } from 'vitest'
import { createLeaseTracker, createPipelineRefreshService, type PipelineObservation } from '../src/pipeline-refresh.ts'

it('coordinator acceptance: preserves the established observation through the second call failure', async () => {
  const observation: PipelineObservation = { pipelineId: 'release', status: 'failed', sourceRunId: '409', observedAt: '2026-11-14T09:30:00.000Z' }
  let reads = 0; const published: PipelineObservation[] = []; const leases = createLeaseTracker()
  const service = createPipelineRefreshService({ read: async () => { reads += 1; if (reads === 1) return observation; throw new Error('socket reset') } }, { publish: (next) => published.push(next) }, leases)
  await expect(service.refresh()).resolves.toEqual({ state: 'ok', observation })
  const before = JSON.stringify(service.cachedObservation())
  await expect(service.refresh()).resolves.toEqual({ state: 'error', error: 'provider-unavailable' })
  expect(JSON.stringify(service.cachedObservation())).toBe(before)
  expect(published).toEqual([observation])
  expect(leases.active).toBe(0)
})
`
if (args.includes('--preflight')) await preflight()
else if (args.includes('--prepare')) await prepare(args.includes('--install'))
else if (args.includes('--complete')) await complete()
else if (args.includes('--review-packets')) await reviewPackets()
else if (args.includes('--score-reviews')) await scoreReviews()
else if (args.includes('--adjudicate')) await adjudicate()
else if (args.includes('--report')) await report()
else
  await createTask(
    resolve(value('--directory', true)),
    value('--condition', true),
    args.includes('--install'),
  )

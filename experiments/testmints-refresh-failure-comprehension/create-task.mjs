import { spawnSync } from 'node:child_process'
import { cp, mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { dirname, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const experimentDirectory = fileURLToPath(new URL('.', import.meta.url))
const templatesDirectory = resolve(experimentDirectory, 'templates')
const workspacesDirectory = resolve(experimentDirectory, '.workspaces')
const resultsDirectory = resolve(experimentDirectory, 'results')
const seed = 'testmints-refresh-failure-comprehension-2026-10-06'
const handoffPrompt =
  'Implement TASK.md, preserve existing evidence, run npm run check, then provide one paragraph explaining the protected behavior.'
const toolPolicy =
  'Assigned workspace only; shell and local package tools permitted; no coordinator files, alternate template, or hidden acceptance test.'
const usage = `Usage:
  node experiments/testmints-refresh-failure-comprehension/create-task.mjs \\
    --condition native|testmints --directory <empty-directory> [--install]
  node experiments/testmints-refresh-failure-comprehension/create-task.mjs --verify --directory <task-directory>
  node experiments/testmints-refresh-failure-comprehension/create-task.mjs --preflight
  node experiments/testmints-refresh-failure-comprehension/create-task.mjs --prepare [--install]
  node experiments/testmints-refresh-failure-comprehension/create-task.mjs --complete --run-id <anonymous-id> \\
    --agent-check pass|fail --tool-invocations <count> --test-invocations <count> \\
    --started-at <ISO-8601> --ended-at <ISO-8601> --explanation-file <path>
  node experiments/testmints-refresh-failure-comprehension/create-task.mjs --review-packets
  node experiments/testmints-refresh-failure-comprehension/create-task.mjs --score-reviews --reviewer one|two --scores-file <path>
  node experiments/testmints-refresh-failure-comprehension/create-task.mjs --resolve-reviews`
const arguments_ = process.argv.slice(2)
const npmCache = process.env.TESTMINTS_NPM_CACHE ?? '/tmp/testmints-refresh-failure-npm-cache'

if (arguments_.includes('--help')) {
  console.log(usage)
  process.exit(0)
}

const valueAfter = (flag, required = false) => {
  const index = arguments_.indexOf(flag)
  const value = index === -1 ? undefined : arguments_[index + 1]
  if (required && !value) throw new Error(`${flag} is required\n\n${usage}`)
  return value
}

function runNpm(directory, npmArguments) {
  const result = spawnSync('npm', npmArguments, {
    cwd: directory,
    stdio: 'inherit',
    env: { ...process.env, npm_config_cache: npmCache },
  })
  if (result.error) throw result.error
  if (result.status !== 0)
    throw new Error(`npm ${npmArguments.join(' ')} failed with ${result.status}`)
}

function runCheck(directory) {
  const result = spawnSync('npm', ['run', 'check'], {
    cwd: directory,
    stdio: 'inherit',
    env: { ...process.env, npm_config_cache: npmCache },
  })
  if (result.error) throw result.error
  return result.status === 0
}

async function createTask(destination, condition, install) {
  if (!['native', 'testmints'].includes(condition))
    throw new Error(`--condition must be native or testmints\n\n${usage}`)
  if (await exists(destination))
    throw new Error(`Refusing to overwrite existing path: ${destination}`)
  await mkdir(dirname(destination), { recursive: true })
  await cp(resolve(templatesDirectory, 'common'), destination, { recursive: true })
  await cp(resolve(templatesDirectory, condition), destination, { recursive: true })
  await writeFile(
    resolve(destination, 'TASK.md'),
    await readFile(resolve(experimentDirectory, 'TASK.md'), 'utf8'),
  )
  if (install) runNpm(destination, ['install', '--ignore-scripts'])
  await assertConditionIsolation(destination, condition)
  console.log(`Created ${condition} task workspace at ${destination}`)
}

async function verify(destination) {
  if (!(await exists(resolve(destination, 'package.json'))))
    throw new Error(`No task package.json found in ${destination}`)
  const hiddenTest = resolve(destination, 'test', '.coordinator-hidden.test.ts')
  await writeFile(hiddenTest, hiddenVerifier)
  try {
    return runCheck(destination)
  } finally {
    await rm(hiddenTest, { force: true })
  }
}

async function preflight() {
  const preflightDirectory = resolve(workspacesDirectory, 'preflight')
  await rm(preflightDirectory, { recursive: true, force: true })
  const results = []
  try {
    for (const condition of ['native', 'testmints']) {
      const baseline = resolve(preflightDirectory, condition, 'baseline')
      await createTask(baseline, condition, true)
      const visibleBaselinePasses = runCheck(baseline)
      const hiddenBaselinePasses = await verify(baseline)
      if (!visibleBaselinePasses || hiddenBaselinePasses)
        throw new Error(`${condition} did not establish the expected baseline boundary`)

      const intended = resolve(preflightDirectory, condition, 'intended-change')
      await createTask(intended, condition, true)
      await applyIntendedChange(intended)
      const intendedVisiblePasses = runCheck(intended)
      const intendedHiddenPasses = await verify(intended)
      if (!intendedVisiblePasses || !intendedHiddenPasses)
        throw new Error(`${condition} intended change did not satisfy both evidence boundaries`)
      results.push({
        condition,
        visibleBaselinePasses,
        hiddenBaselineFails: !hiddenBaselinePasses,
        intendedChangePassesVisibleAndHidden: intendedVisiblePasses && intendedHiddenPasses,
      })
    }
  } finally {
    await rm(preflightDirectory, { recursive: true, force: true })
  }
  await mkdir(resultsDirectory, { recursive: true })
  await writeFile(
    resolve(resultsDirectory, 'preflight.json'),
    `${JSON.stringify({ ranAt: new Date().toISOString(), results }, null, 2)}\n`,
  )
  console.log('Preflight passed for native and Testmints conditions.')
}

async function applyIntendedChange(directory) {
  const productionPath = resolve(directory, 'src', 'pipeline-refresh.ts')
  const production = await readFile(productionPath, 'utf8')
  const changedProduction = production.replace('        cachedObservation = undefined\n', '')
  if (changedProduction === production)
    throw new Error('Could not apply intended production change')
  await writeFile(productionPath, changedProduction)
  const testPath = resolve(directory, 'test', 'pipeline-refresh.test.ts')
  const test = await readFile(testPath, 'utf8')
  const changedTest = test.replace(
    'expect(JSON.stringify(service.cachedObservation())).toBeUndefined()',
    'expect(JSON.stringify(service.cachedObservation())).toBe(cachedBeforeFailure)',
  )
  if (changedTest === test) throw new Error('Could not apply intended test change')
  await writeFile(testPath, changedTest)
}

function assignments() {
  let state = 0
  for (const character of seed) state = (state * 31 + character.charCodeAt(0)) >>> 0
  const random = () => {
    state = (1664525 * state + 1013904223) >>> 0
    return state / 2 ** 32
  }
  const cells = [
    ...Array.from({ length: 4 }, () => ({ condition: 'native', reasoning: 'medium' })),
    ...Array.from({ length: 4 }, () => ({ condition: 'testmints', reasoning: 'medium' })),
    ...Array.from({ length: 4 }, () => ({ condition: 'native', reasoning: 'high' })),
    ...Array.from({ length: 4 }, () => ({ condition: 'testmints', reasoning: 'high' })),
  ]
  for (let index = cells.length - 1; index > 0; index -= 1) {
    const replacement = Math.floor(random() * (index + 1))
    ;[cells[index], cells[replacement]] = [cells[replacement], cells[index]]
  }
  return cells.map((cell, index) => ({
    id: `run-${String(index + 1).padStart(2, '0')}`,
    ...cell,
    model: 'GPT-6.1 Sol',
    toolPolicy,
    status: 'prepared',
  }))
}

async function prepare(install) {
  const manifestPath = resolve(resultsDirectory, 'manifest.json')
  if ((await exists(manifestPath)) || !(await directoryIsEmpty(workspacesDirectory)))
    throw new Error(
      'Study state already exists; retain it as evidence or remove it explicitly before preparing again.',
    )
  const manifest = {
    schemaVersion: 1,
    study: 'testmints-refresh-failure-boundary-comprehension',
    randomizationSeed: seed,
    createdAt: new Date().toISOString(),
    handoffPrompt,
    model: 'GPT-6.1 Sol',
    toolPolicy,
    assignments: assignments(),
  }
  await mkdir(resultsDirectory, { recursive: true })
  for (const assignment of manifest.assignments) {
    const workspace = resolve(workspacesDirectory, assignment.id)
    await createTask(workspace, assignment.condition, install)
    await snapshotWorkspace(workspace, resolve(resultsDirectory, 'baselines', assignment.id))
  }
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)
  console.log(`Prepared ${manifest.assignments.length} isolated study workspaces.`)
}

async function snapshotWorkspace(source, destination) {
  await mkdir(dirname(destination), { recursive: true })
  await cp(source, destination, {
    recursive: true,
    filter: (entry) => !entry.includes('/node_modules'),
  })
}

async function completeRun() {
  const runId = valueAfter('--run-id', true)
  const agentCheck = valueAfter('--agent-check', true)
  if (!['pass', 'fail'].includes(agentCheck)) throw new Error('--agent-check must be pass or fail')
  const manifest = JSON.parse(await readFile(resolve(resultsDirectory, 'manifest.json'), 'utf8'))
  const assignment = manifest.assignments.find((candidate) => candidate.id === runId)
  if (!assignment) throw new Error(`Unknown run id: ${runId}`)
  const workspace = resolve(workspacesDirectory, runId)
  const record = {
    ...assignment,
    startedAt: valueAfter('--started-at', true),
    endedAt: valueAfter('--ended-at', true),
    agentCheck,
    coordinatorHiddenAcceptance: (await verify(workspace)) ? 'pass' : 'fail',
    toolInvocations: countArgument('--tool-invocations'),
    testInvocations: countArgument('--test-invocations'),
    changedLines: await countChangedLines(resolve(resultsDirectory, 'baselines', runId), workspace),
    taskOutput: await readFile(valueAfter('--explanation-file', true), 'utf8'),
    coordinatorIntervention: valueAfter('--intervention') ?? 'none',
    review: { reviewerOne: null, reviewerTwo: null, resolved: null },
    recordedAt: new Date().toISOString(),
  }
  await writeFile(
    resolve(resultsDirectory, `${runId}.json`),
    `${JSON.stringify(record, null, 2)}\n`,
  )
  console.log(`Recorded ${runId}.`)
}

function countArgument(flag) {
  const value = Number(valueAfter(flag, true))
  if (!Number.isInteger(value) || value < 0)
    throw new Error(`${flag} must be a non-negative integer`)
  return value
}

async function countChangedLines(baseline, workspace) {
  const files = new Set([...(await listFiles(baseline)), ...(await listFiles(workspace))])
  let total = 0
  for (const file of files) {
    const before = await readOptional(resolve(baseline, file))
    const after = await readOptional(resolve(workspace, file))
    if (before !== after)
      total += Math.max(before?.split('\n').length ?? 0, after?.split('\n').length ?? 0)
  }
  return total
}

async function listFiles(directory, prefix = '') {
  const files = []
  for (const entry of await readdir(resolve(directory, prefix), { withFileTypes: true })) {
    if (entry.name === 'node_modules') continue
    const path = relative(directory, resolve(directory, prefix, entry.name))
    if (entry.isDirectory()) files.push(...(await listFiles(directory, path)))
    else files.push(path)
  }
  return files
}

async function readOptional(path) {
  try {
    return await readFile(path, 'utf8')
  } catch (error) {
    if (error && typeof error === 'object' && error.code === 'ENOENT') return undefined
    throw error
  }
}

async function reviewPackets() {
  const records = []
  for (const entry of (await readdir(resultsDirectory))
    .filter((entry) => /^run-\d\d\.json$/.test(entry))
    .sort()) {
    const record = JSON.parse(await readFile(resolve(resultsDirectory, entry), 'utf8'))
    records.push({ runId: record.id, explanation: redactReviewerPacket(record.taskOutput) })
  }
  await writeFile(
    resolve(resultsDirectory, 'review-packets.json'),
    `${JSON.stringify({ rubric: reviewRubric, records }, null, 2)}\n`,
  )
  console.log(`Prepared ${records.length} blinded reviewer packets.`)
}

function redactReviewerPacket(explanation) {
  return explanation
    .replaceAll(/Testmints/gi, 'test')
    .replaceAll(/native Vitest/gi, 'test')
    .replaceAll(/Vitest/gi, 'test')
}

async function scoreReviews() {
  const reviewer = valueAfter('--reviewer', true)
  if (!['one', 'two'].includes(reviewer)) throw new Error('--reviewer must be one or two')
  const scores = JSON.parse(await readFile(valueAfter('--scores-file', true), 'utf8'))
  for (const record of await runRecords()) {
    const score = scores[record.id]
    if (
      !Array.isArray(score) ||
      score.length !== 4 ||
      !score.every((value) => value === 0 || value === 1)
    )
      throw new Error(`Invalid reviewer score for ${record.id}`)
    record.review[reviewer === 'one' ? 'reviewerOne' : 'reviewerTwo'] = score
    await writeFile(
      resolve(resultsDirectory, `${record.id}.json`),
      `${JSON.stringify(record, null, 2)}\n`,
    )
  }
  console.log(`Recorded reviewer ${reviewer} scores.`)
}

async function resolveReviews() {
  const disagreements = []
  for (const record of await runRecords()) {
    const { reviewerOne, reviewerTwo } = record.review
    if (reviewerOne === null || reviewerTwo === null)
      throw new Error(`Both reviewer scores are required for ${record.id}`)
    if (JSON.stringify(reviewerOne) === JSON.stringify(reviewerTwo))
      record.review.resolved = reviewerOne
    else disagreements.push(record.id)
    await writeFile(
      resolve(resultsDirectory, `${record.id}.json`),
      `${JSON.stringify(record, null, 2)}\n`,
    )
  }
  await writeFile(
    resolve(resultsDirectory, 'review-disagreements.json'),
    `${JSON.stringify(disagreements)}\n`,
  )
  console.log(`Resolved reviews; ${disagreements.length} disagreements require adjudication.`)
}

async function runRecords() {
  return Promise.all(
    (await readdir(resultsDirectory))
      .filter((entry) => /^run-\d\d\.json$/.test(entry))
      .sort()
      .map(async (entry) => JSON.parse(await readFile(resolve(resultsDirectory, entry), 'utf8'))),
  )
}

const reviewRubric = [
  'Identifies the successful first refresh as setup that primes the cache.',
  'Identifies the failed second refresh as the subject under test.',
  'Explains that the prior cached observation remains unchanged after provider failure.',
  'Explains that failure publishes nothing and releases the lease.',
]

async function assertConditionIsolation(directory, condition) {
  const test = await readFile(resolve(directory, 'test', 'pipeline-refresh.test.ts'), 'utf8')
  if (test.includes('mintTest(') !== (condition === 'testmints'))
    throw new Error(`${condition} workspace contains the alternate test representation`)
  if (await exists(resolve(directory, 'test', '.coordinator-hidden.test.ts')))
    throw new Error(`${condition} workspace contains the coordinator verifier`)
  for (const file of await listFiles(directory))
    if ((await readFile(resolve(directory, file), 'utf8')).includes('coordinator acceptance:'))
      throw new Error(`${condition} workspace contains verifier content`)
}

async function exists(path) {
  try {
    await stat(path)
    return true
  } catch (error) {
    if (error && typeof error === 'object' && error.code === 'ENOENT') return false
    throw error
  }
}

async function directoryIsEmpty(path) {
  return !(await exists(path)) || (await readdir(path)).length === 0
}

const hiddenVerifier = `import { expect, it } from 'vitest'
import { createLeaseTracker, createPipelineRefreshService, type PipelineObservation } from '../src/pipeline-refresh.ts'

it('coordinator acceptance: retains a byte-for-byte cached observation after a failed second refresh', async () => {
  const observation: PipelineObservation = { pipelineId: 'deploy', status: 'passed', sourceRunId: '101', observedAt: '2026-10-06T12:00:00.000Z' }
  let reads = 0
  const published: PipelineObservation[] = []
  const leases = createLeaseTracker()
  const service = createPipelineRefreshService(
    { read: async () => { reads += 1; if (reads === 1) return observation; throw new Error('transport failed') } },
    { publish: (next) => published.push(next) }, leases,
  )

  await expect(service.refresh()).resolves.toEqual({ state: 'ok', observation })
  const cachedBeforeFailure = JSON.stringify(service.cachedObservation())
  await expect(service.refresh()).resolves.toEqual({ state: 'error', error: 'provider-unavailable' })

  expect(JSON.stringify(service.cachedObservation())).toBe(cachedBeforeFailure)
  expect(published).toEqual([observation])
  expect(leases.active).toBe(0)
})
`

if (arguments_.includes('--preflight')) await preflight()
else if (arguments_.includes('--prepare')) await prepare(arguments_.includes('--install'))
else if (arguments_.includes('--complete')) await completeRun()
else if (arguments_.includes('--review-packets')) await reviewPackets()
else if (arguments_.includes('--score-reviews')) await scoreReviews()
else if (arguments_.includes('--resolve-reviews')) await resolveReviews()
else if (arguments_.includes('--verify'))
  process.exitCode = (await verify(resolve(valueAfter('--directory', true)))) ? 0 : 1
else
  await createTask(
    resolve(valueAfter('--directory', true)),
    valueAfter('--condition'),
    arguments_.includes('--install'),
  )

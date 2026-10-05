import { execFileSync } from 'node:child_process'
import { cp, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const experimentDirectory = fileURLToPath(new URL('.', import.meta.url))
const templatesDirectory = resolve(experimentDirectory, 'templates')
const usage = `Usage:
  node experiments/testmints-agent-comprehension/create-task.mjs \\
    --condition native|testmints --directory <empty-directory> [--install]

  node experiments/testmints-agent-comprehension/create-task.mjs \\
    --verify --directory <task-directory>`

const arguments_ = process.argv.slice(2)
if (arguments_.includes('--help')) {
  console.log(usage)
  process.exit(0)
}

const valueAfter = (flag) => {
  const index = arguments_.indexOf(flag)
  return index === -1 ? undefined : arguments_[index + 1]
}
const directory = valueAfter('--directory')
if (!directory) throw new Error(`--directory is required\n\n${usage}`)
const taskDirectory = resolve(directory)

async function createTask(destination, condition, install) {
  if (condition !== 'native' && condition !== 'testmints')
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
  if (install)
    execFileSync('npm', ['install', '--ignore-scripts'], {
      cwd: destination,
      stdio: 'inherit',
      // Some machines retain root-owned npm caches from older npm releases. The task must remain
      // independently installable, so keep this disposable install cache out of that machine state.
      env: {
        ...process.env,
        npm_config_cache:
          process.env.TESTMINTS_NPM_CACHE ?? '/tmp/testmints-agent-comprehension-npm-cache',
      },
    })
  console.log(`Created ${condition} task workspace at ${destination}`)
}

async function verify(destination) {
  if (!(await exists(resolve(destination, 'package.json'))))
    throw new Error(`No task package.json found in ${destination}`)
  const hiddenTest = resolve(destination, 'test', '.coordinator-hidden.test.ts')
  await writeFile(hiddenTest, hiddenVerifier)
  try {
    execFileSync('npm', ['run', 'check'], { cwd: destination, stdio: 'inherit' })
  } finally {
    await rm(hiddenTest, { force: true })
  }
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

const hiddenVerifier = `import { describe, expect, it } from 'vitest'
import { createPipelineApp } from '../src/pipeline-app.ts'

describe('coordinator acceptance: source update time', () => {
  it('publishes a provider update timestamp only when the provider supplied one', async () => {
    const present = await createPipelineApp({
      id: '101', status: 'passed', url: 'https://source.example.test/runs/101',
      updatedAt: '2026-10-05T12:02:00.000Z',
    }).request('/api/panel/controlled/pipeline')
    const absent = await createPipelineApp({
      id: '102', status: 'passed', url: 'https://source.example.test/runs/102',
    }).request('/api/panel/controlled/pipeline')

    expect(present.status).toBe(200)
    expect((await present.json()).signal).toMatchObject({
      sourceUpdatedAt: '2026-10-05T12:02:00.000Z',
    })
    expect((await absent.json()).signal).not.toHaveProperty('sourceUpdatedAt')
  })
})
`

if (arguments_.includes('--verify')) await verify(taskDirectory)
else await createTask(taskDirectory, valueAfter('--condition'), arguments_.includes('--install'))

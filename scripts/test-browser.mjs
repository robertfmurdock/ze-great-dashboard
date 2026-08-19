import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const require = createRequire(import.meta.url)
const useDocker = process.env.PLAYWRIGHT_DOCKER === '1'
const playwrightVersion = useDocker ? require('@playwright/test/package.json').version : undefined
const composeArgs = ['compose', '-f', 'compose.playwright.yml']
const npmCli = process.env.npm_execpath
const npmCommand = npmCli ? process.execPath : 'npm'
const npmArgs = npmCli
  ? [npmCli, 'run', 'test:browser', '--workspace', '@ze-great-dashboard/client']
  : ['run', 'test:browser', '--workspace', '@ze-great-dashboard/client']

let activeChild
let interruptedBy

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    interruptedBy ??= signal
    activeChild?.kill(signal)
  })
}

function run(command, args, env = process.env) {
  return new Promise((resolveRun, rejectRun) => {
    const child = spawn(command, args, { cwd: root, env, stdio: 'inherit' })
    activeChild = child
    child.once('error', rejectRun)
    child.once('exit', (code, signal) => {
      if (activeChild === child) activeChild = undefined
      resolveRun(code ?? (signal ? 1 : 0))
    })
  })
}

let exitCode = 0
let composeAttempted = false

try {
  let testEnvironment = process.env

  if (useDocker) {
    const composeEnvironment = { ...process.env, PLAYWRIGHT_VERSION: playwrightVersion }
    composeAttempted = true
    exitCode = await run(
      'docker',
      [...composeArgs, 'up', '--detach', '--wait', '--wait-timeout', '60'],
      composeEnvironment,
    )
    if (exitCode === 0) {
      testEnvironment = {
        ...process.env,
        PW_TEST_CONNECT_WS_ENDPOINT: 'ws://127.0.0.1:3000/',
      }
    }
  }

  if (exitCode === 0 && !interruptedBy) {
    exitCode = await run(npmCommand, npmArgs, testEnvironment)
  }
} catch (error) {
  console.error(error)
  exitCode = 1
} finally {
  if (composeAttempted) {
    try {
      const downExitCode = await run('docker', [...composeArgs, 'down'], {
        ...process.env,
        PLAYWRIGHT_VERSION: playwrightVersion,
      })
      if (exitCode === 0) exitCode = downExitCode
    } catch (error) {
      console.error(error)
      if (exitCode === 0) exitCode = 1
    }
  }
}

if (interruptedBy) {
  exitCode = interruptedBy === 'SIGINT' ? 130 : 143
}
process.exitCode = exitCode

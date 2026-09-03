import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const require = createRequire(import.meta.url)
// Docker gives local checks the same Playwright server and browser version as CI. Native browsers
// remain an explicit escape hatch for environments that manage them deliberately.
const useDocker = process.env.PLAYWRIGHT_DOCKER !== '0'
const noBuild = process.argv.includes('--no-build')
const playwrightArguments = process.argv.slice(2).filter((argument) => argument !== '--no-build')
const playwrightVersion = require('@playwright/test/package.json').version
const dockerBrowserOrigin = 'http://host.docker.internal:4173'
const composeArgs = ['compose', '-f', 'compose.playwright.yml']
const npmCli = process.env.npm_execpath
const npmCommand = npmCli ? process.execPath : 'npm'
// The standalone command builds; the aggregate test command opts into reuse after test:unit.
const clientScript = noBuild ? 'test:browser:no-build' : 'test:browser'
const npmArgs = npmCli
  ? [
      npmCli,
      'run',
      clientScript,
      '--workspace',
      '@continuous-excellence/ze-great-dashboard-client',
      ...(playwrightArguments.length > 0 ? ['--', ...playwrightArguments] : []),
    ]
  : [
      'run',
      clientScript,
      '--workspace',
      '@continuous-excellence/ze-great-dashboard-client',
      ...(playwrightArguments.length > 0 ? ['--', ...playwrightArguments] : []),
    ]

let activeChild
let interruptedBy

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    interruptedBy ??= signal
    activeChild?.kill(signal)
  })
}

function run(command, args, { captureOutput = false, env = process.env } = {}) {
  return new Promise((resolveRun, rejectRun) => {
    const child = spawn(command, args, {
      cwd: root,
      env,
      stdio: captureOutput ? ['ignore', 'pipe', 'inherit'] : 'inherit',
    })
    let output = ''
    activeChild = child
    if (captureOutput) {
      child.stdout.on('data', (chunk) => {
        output += chunk
      })
    }
    child.once('error', rejectRun)
    child.once('exit', (code, signal) => {
      if (activeChild === child) activeChild = undefined
      resolveRun({ exitCode: code ?? (signal ? 1 : 0), output })
    })
  })
}

function websocketEndpoint(portOutput) {
  const match = /^127\.0\.0\.1:(\d{1,5})\s*$/.exec(portOutput)
  const port = Number(match?.[1])
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error(
      `Docker Compose returned a non-loopback Playwright endpoint: ${JSON.stringify(portOutput.trim())}`,
    )
  }
  return `ws://127.0.0.1:${port}/`
}

function browserTestEnvironment(environment) {
  if (environment.NO_COLOR === undefined) return environment

  // Playwright forces color in its worker processes. Node warns when that conflicts with the
  // caller's NO_COLOR preference, so remove the conflicting variable and explicitly preserve
  // plain reporter output.
  const { NO_COLOR: _noColor, ...withoutNoColor } = environment
  return { ...withoutNoColor, DEBUG_COLORS: '0' }
}

let exitCode = 0
let composeAttempted = false

try {
  let testEnvironment = process.env

  if (useDocker) {
    const composeEnvironment = { ...process.env, PLAYWRIGHT_VERSION: playwrightVersion }
    composeAttempted = true
    exitCode = (
      await run('docker', [...composeArgs, 'up', '--detach', '--wait', '--wait-timeout', '60'], {
        env: composeEnvironment,
      })
    ).exitCode
    if (exitCode === 0) {
      const port = await run('docker', [...composeArgs, 'port', 'playwright', '3000'], {
        captureOutput: true,
        env: composeEnvironment,
      })
      exitCode = port.exitCode
      if (exitCode === 0) {
        testEnvironment = {
          ...process.env,
          PW_TEST_CONNECT_WS_ENDPOINT: websocketEndpoint(port.output),
          PW_TEST_ORIGIN: dockerBrowserOrigin,
        }
      }
    }
  }

  if (exitCode === 0 && !interruptedBy) {
    exitCode = (await run(npmCommand, npmArgs, { env: browserTestEnvironment(testEnvironment) }))
      .exitCode
  }
} catch (error) {
  console.error(error)
  exitCode = 1
} finally {
  if (composeAttempted) {
    try {
      const downExitCode = (
        await run('docker', [...composeArgs, 'down'], {
          env: { ...process.env, PLAYWRIGHT_VERSION: playwrightVersion },
        })
      ).exitCode
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

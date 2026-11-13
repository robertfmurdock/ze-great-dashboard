import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { resolveAuth0FunctionalEnvironment } from './auth0-functional-env.mjs'
import { requestAuth0Tokens } from './auth0-functional-provider.mjs'
import { startBrowserFixture } from './browser-fixture.mjs'
import { playwrightEvidenceOptions } from './check-evidence.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const require = createRequire(import.meta.url)
// Docker gives local checks the same Playwright server and browser version as CI. Native browsers
// remain an explicit escape hatch for environments that manage them deliberately.
const useDocker = process.env.PLAYWRIGHT_DOCKER !== '0'
const noBuild = process.argv.includes('--no-build')
const playwrightArguments = process.argv.slice(2).filter((argument) => argument !== '--no-build')
const checkResultsDirectory = process.env.CHECK_RESULTS_DIR
const playwrightVersion = require('@playwright/test/package.json').version
const composeProject = `ze-great-dashboard-browser-${process.pid}`
const composeNetwork = `${composeProject}_default`
const composeArgs = ['compose', '--project-name', composeProject, '-f', 'compose.playwright.yml']
const npmCli = process.env.npm_execpath
const npmCommand = npmCli ? process.execPath : 'npm'
const evidenceOptions = playwrightEvidenceOptions(checkResultsDirectory)
if (evidenceOptions) {
  playwrightArguments.push(...evidenceOptions.arguments)
  process.env.PLAYWRIGHT_JUNIT_OUTPUT_FILE = evidenceOptions.junitOutputFile
}

const playwrightCli = require.resolve('@playwright/test/cli')

let activeChild
let interruptedBy
const interruption = new AbortController()

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    interruptedBy ??= signal
    if (interruption.signal.aborted) return
    interruption.abort()
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
let dashboardFixture

try {
  let testEnvironment = process.env

  // Ordinary developer and PR checks retain the existing browser suite. Trusted main resolves
  // the encrypted credentials and treats any retrieval or minting failure as release-breaking.
  const auth0 =
    process.env.AUTH0_FUNCTIONAL_SKIP === 'true'
      ? { available: false, reason: 'disabled for this ref' }
      : await resolveAuth0FunctionalEnvironment()
  let auth0Bootstrap
  let sensitiveValues = []
  if (auth0.available) {
    const tokens = await requestAuth0Tokens(auth0.credentials)
    auth0Bootstrap = JSON.stringify(tokens.allowedToken)
    sensitiveValues = [...auth0.credentials.secretValues, tokens.allowedToken.accessToken]
  } else if (!process.env.AUTH0_FUNCTIONAL_SKIP && auth0.reason) {
    console.log(`SKIP Auth0 token browser acceptance: ${auth0.reason}`)
  }

  if (!noBuild && !interruptedBy) {
    exitCode = (await run(npmCommand, [...(npmCli ? [npmCli] : []), 'run', 'build'])).exitCode
  }

  if (exitCode === 0 && !interruptedBy && useDocker) {
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
        }
      }
    }
  }

  if (exitCode === 0 && !interruptedBy) {
    dashboardFixture = await startBrowserFixture({
      auth0: Boolean(auth0Bootstrap),
      sensitiveValues,
      network: useDocker ? composeNetwork : undefined,
      signal: interruption.signal,
    })
    testEnvironment = {
      ...testEnvironment,
      PW_TEST_ORIGIN: dashboardFixture.browserOrigin,
      PW_TEST_HTTP_ORIGIN: dashboardFixture.httpOrigin,
      PW_TEST_ASSET_ORIGIN: dashboardFixture.assetOrigin,
      PW_TEST_FIXTURE_BEARER: dashboardFixture.fixtureBearer,
      PW_TEST_HOSTS: JSON.stringify(dashboardFixture.hostnames),
      PW_TEST_NATIVE_BROWSER: useDocker ? '0' : '1',
      PW_AUTH0_BROWSER_ORIGIN: dashboardFixture.auth0Origin,
      PW_AUTH0_OIDC_BOOTSTRAP: auth0Bootstrap,
    }
  }

  if (exitCode === 0 && !interruptedBy) {
    exitCode = (
      await run(process.execPath, [playwrightCli, 'test', ...playwrightArguments], {
        env: browserTestEnvironment(testEnvironment),
      })
    ).exitCode
  }
} catch (error) {
  console.error(error)
  exitCode = 1
} finally {
  try {
    await dashboardFixture?.close()
  } catch (error) {
    console.error(error)
    exitCode ||= 1
  }
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

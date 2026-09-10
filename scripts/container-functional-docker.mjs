import { spawn } from 'node:child_process'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { functionalAuth0 } from './auth0-functional-config.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')

export function createFunctionalContainer({ assetOrigin, sensitiveValues }) {
  const image = `ze-great-dashboard:container-functional-${process.pid}`
  const project = `dashboard-functional-${process.pid}`
  let activeChild
  let composeEnvironment
  let cleaned = false

  const interrupt = (signal) => {
    activeChild?.kill(signal)
    void cleanup().finally(() => process.exit(128 + (signal === 'SIGINT' ? 2 : 15)))
  }
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, interrupt)

  async function start() {
    await docker(
      [
        'build',
        '--tag',
        image,
        '--build-arg',
        `ASSET_PATH=${assetOrigin}`,
        '--build-arg',
        'SERVER_RELEASE=container-functional',
        '.',
      ],
      process.env,
      { inherit: true },
    )
    composeEnvironment = {
      ...process.env,
      ASSET_PATH: assetOrigin,
      BOARD_CONFIG_URL: `${assetOrigin}/board.yaml`,
      DASHBOARD_IMAGE: image,
      FUNCTIONAL_BOARD: functionalAuth0.board,
    }
    try {
      await dockerCompose(['up', '--detach', '--wait'])
    } catch (error) {
      const diagnostic = await dockerCompose(['logs', '--no-color', 'server'], {
        allowFailure: true,
      })
      if (diagnostic.trim()) console.error(`Container startup diagnostics:\n${redact(diagnostic)}`)
      throw error
    }
    return composeOrigin(await dockerCompose(['port', 'server', '3000']))
  }

  async function cleanup() {
    if (cleaned) return
    cleaned = true
    for (const signal of ['SIGINT', 'SIGTERM']) process.removeListener(signal, interrupt)
    if (composeEnvironment)
      await dockerCompose(['down', '--remove-orphans'], { allowFailure: true })
    await docker(['image', 'rm', image], process.env, { allowFailure: true })
  }

  function dockerCompose(command, options) {
    return docker(
      [
        'compose',
        '-p',
        project,
        '-f',
        'docker-compose.yml',
        '-f',
        'docker-compose.container-functional.yml',
        ...command,
      ],
      composeEnvironment,
      options,
    )
  }

  function docker(command, environment, { allowFailure = false, inherit = false } = {}) {
    return new Promise((resolveRun, reject) => {
      activeChild = spawn('docker', command, {
        cwd: root,
        env: environment,
        stdio: inherit ? 'inherit' : ['ignore', 'pipe', 'pipe'],
      })
      let output = ''
      activeChild.stdout?.on('data', (chunk) => {
        output += chunk
      })
      activeChild.stderr?.on('data', (chunk) => {
        output += chunk
      })
      activeChild.once('error', reject)
      activeChild.once('exit', (code) => {
        activeChild = undefined
        if (code === 0 || allowFailure) return resolveRun(output)
        reject(new Error(`Docker command failed.${output ? `\n${redact(output)}` : ''}`))
      })
    })
  }

  function redact(output) {
    return sensitiveValues
      .filter(Boolean)
      .reduce((text, value) => text.replaceAll(value, '[redacted]'), output)
      .trim()
      .slice(-4000)
  }

  return { start, cleanup }
}

function composeOrigin(output) {
  const match = /(?:127\.0\.0\.1|0\.0\.0\.0|\[::1\]):(\d+)\s*$/.exec(output.trim())
  if (!match) throw new Error('Docker Compose did not report the dashboard server port.')
  return `http://127.0.0.1:${match[1]}`
}

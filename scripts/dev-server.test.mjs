import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { fileURLToPath } from 'node:url'

import { mint } from '@continuous-excellence/testmints-js/vitest'
import { test } from 'vitest'

const root = fileURLToPath(new URL('../', import.meta.url))

test(
  'the server dev watcher exits when startup reports an invalid board configuration',
  mint({
    setup: () => ({
      ...process.env,
      ASSET_PATH: 'http://127.0.0.1:9/__ASSET_PATH__',
      BOARD_CONFIG_URL: 'boards/not-a-board.yaml',
    }),
    exercise: async (environment) => {
      const child = spawn('npm', ['run', 'dev:server'], {
        cwd: root,
        env: environment,
        detached: true,
        stdio: ['ignore', 'pipe', 'pipe'],
      })
      let output = ''
      child.stdout.on('data', (chunk) => (output += chunk))
      child.stderr.on('data', (chunk) => (output += chunk))

      const timeout = setTimeout(() => {
        if (child.pid === undefined) return
        try {
          process.kill(-child.pid, 'SIGKILL')
        } catch (error) {
          if (error.code !== 'ESRCH') throw error
        }
      }, 30_000)
      const [code, signal] = await once(child, 'close').finally(() => clearTimeout(timeout))

      return { code, signal, output }
    },
    verify: ({ code, signal, output }, environment) => {
      assert.equal(
        code,
        1,
        `Expected the watcher to exit with code 1 (signal: ${signal}).
${output}`,
      )
      assert.match(output, /server.startup_failed/)
      assert.match(output, /ENOENT/s)
      assert.ok(output.includes(environment.BOARD_CONFIG_URL))
    },
  }),
)

import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../', import.meta.url))

test('the server dev watcher exits when startup reports an invalid board configuration', async () => {
  const child = spawn('npm', ['run', 'dev:server'], {
    cwd: root,
    env: {
      ...process.env,
      ASSET_PATH: 'http://127.0.0.1:9/__ASSET_PATH__',
      BOARD_CONFIG_URL: 'boards/not-a-board.yaml',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let output = ''
  child.stdout.on('data', (chunk) => (output += chunk))
  child.stderr.on('data', (chunk) => (output += chunk))

  const timeout = setTimeout(() => child.kill('SIGKILL'), 5_000)
  const [code] = await once(child, 'close')
  clearTimeout(timeout)

  assert.equal(code, 1)
  assert.match(output, /server.startup_failed/)
  assert.match(output, /ENOENT.*boards\/not-a-board\.yaml/s)
})

import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'

const require = createRequire(import.meta.url)
const tsxCli = join(dirname(require.resolve('tsx/package.json')), 'dist/cli.mjs')
const boardConfigUrl = process.env.BOARD_CONFIG_URL
const watchArguments = ['watch']

if (!boardConfigUrl?.startsWith('http://') && !boardConfigUrl?.startsWith('https://'))
  watchArguments.push('--include', boardConfigUrl || '../../boards/example.yaml')
watchArguments.push('src/node-server.ts')

const watcher = spawn(process.execPath, [tsxCli, ...watchArguments], {
  stdio: ['inherit', 'pipe', 'pipe'],
})

let startupFailed = false
watcher.stdout.on('data', (chunk) => {
  process.stdout.write(chunk)
  if (String(chunk).includes('"event":"server.startup_failed"')) startupFailed = true
})
watcher.stderr.on('data', (chunk) => {
  process.stderr.write(chunk)
  // `tsx watch` otherwise stays alive after its child emits this startup stack. Let that original
  // error reach the terminal first, then make the failed boot terminal for the root dev command.
  if (startupFailed) watcher.kill('SIGTERM')
})

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => watcher.kill(signal))
}

watcher.once('error', (error) => {
  console.error(error)
  process.exitCode = 1
})
watcher.once('close', (code, signal) => {
  if (startupFailed) process.exitCode = 1
  else if (code !== 0) process.exitCode = code ?? (signal ? 1 : 0)
})

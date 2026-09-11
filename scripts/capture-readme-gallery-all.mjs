import { spawn } from 'node:child_process'
import { resolve } from 'node:path'

const root = resolve(new URL('..', import.meta.url).pathname)
const scenarios = ['status', 'attention', 'warning', 'blocked']

for (const scenario of scenarios) {
  await new Promise((resolveCapture, rejectCapture) => {
    const child = spawn(process.execPath, ['scripts/capture-readme-gallery.mjs', scenario], {
      cwd: root,
      env: process.env,
      stdio: 'inherit',
    })
    child.once('error', rejectCapture)
    child.once('exit', (code, signal) => {
      if (code === 0) resolveCapture()
      else rejectCapture(new Error(`${scenario} capture exited with ${signal ?? `code ${code}`}`))
    })
  })
}

import { spawn } from 'node:child_process'
import { mkdir, rm } from 'node:fs/promises'
import { resolve } from 'node:path'
import { setTimeout as wait } from 'node:timers/promises'
import { chromium } from '@playwright/test'

const root = resolve(new URL('..', import.meta.url).pathname)
const frames = resolve(root, 'scripts/readme-demo-frames')
const output = resolve(root, 'docs/assets/readme-demo.gif')
const clientPort = 5174
const serverPort = 3001

await rm(frames, { recursive: true, force: true })
await mkdir(frames, { recursive: true })

const client = spawn(
  'npm',
  [
    'run',
    'dev',
    '--workspace',
    '@ze-great-dashboard/client',
    '--',
    '--host',
    '127.0.0.1',
    '--port',
    String(clientPort),
  ],
  {
    cwd: root,
    env: process.env,
    stdio: ['ignore', 'pipe', 'pipe'],
  },
)
const server = spawn('npm', ['run', 'dev', '--workspace', '@ze-great-dashboard/server'], {
  cwd: root,
  env: {
    ...process.env,
    ASSET_PATH: `http://127.0.0.1:${clientPort}/__ASSET_PATH__`,
    BOARD_CONFIG_URL: resolve(root, 'boards/animation-showcase.yaml'),
    BOARD: 'animation-showcase',
    PORT: String(serverPort),
    HOST: '127.0.0.1',
    TEMPLATE_WAIT_MS: '20000',
  },
  stdio: ['ignore', 'pipe', 'pipe'],
})

let serverOutput = ''
client.stdout.on('data', (chunk) => {
  serverOutput += chunk
})
client.stderr.on('data', (chunk) => {
  serverOutput += chunk
})
server.stdout.on('data', (chunk) => {
  serverOutput += chunk
})
server.stderr.on('data', (chunk) => {
  serverOutput += chunk
})

const browser = await chromium.launch()
try {
  await waitForServer(`http://127.0.0.1:${serverPort}/health`)
  const page = await browser.newPage({
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 1,
    reducedMotion: 'no-preference',
  })

  await page.goto(`http://127.0.0.1:${serverPort}/`, { waitUntil: 'networkidle' })
  await page.locator('[data-running-field]').first().waitFor()
  await wait(750)

  const frameCount = 60
  for (let frame = 0; frame < frameCount; frame += 1) {
    await page.screenshot({ path: resolve(frames, `frame-${String(frame).padStart(3, '0')}.png`) })
    await wait(100)
  }
} catch (error) {
  console.error(serverOutput)
  throw error
} finally {
  await browser.close()
  client.kill('SIGTERM')
  server.kill('SIGTERM')
}

const ffmpeg = spawn(
  'ffmpeg',
  [
    '-y',
    '-framerate',
    '10',
    '-i',
    resolve(frames, 'frame-%03d.png'),
    '-vf',
    'fps=10,scale=960:-1:flags=lanczos,split[s0][s1];[s0]palettegen=stats_mode=diff:max_colors=128[p];[s1][p]paletteuse=dither=sierra2_4a',
    '-loop',
    '0',
    output,
  ],
  { cwd: root, stdio: 'inherit' },
)

await new Promise((resolvePromise, reject) => {
  ffmpeg.once('error', reject)
  ffmpeg.once('exit', (code) => {
    if (code === 0) resolvePromise()
    else reject(new Error(`ffmpeg exited with code ${code}`))
  })
})

await rm(frames, { recursive: true, force: true })
console.log(`Wrote ${output}`)

async function waitForServer(url) {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    try {
      const response = await fetch(url)
      if (response.ok) return
    } catch {
      // The Vite and application servers start independently.
    }
    await wait(250)
  }
  throw new Error(`Timed out waiting for ${url}`)
}

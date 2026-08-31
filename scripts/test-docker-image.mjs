import { execFileSync } from 'node:child_process'

const image = `ze-great-dashboard:check-${process.pid}`
let container

try {
  execFileSync(
    'docker',
    [
      'build',
      '--tag',
      image,
      '--build-arg',
      'ASSET_PATH=https://public-assets.zegreatrob.com/dashboard/0.1.13',
      '.',
    ],
    {
      stdio: 'inherit',
    },
  )
  container = execFileSync(
    'docker',
    [
      'run',
      '--detach',
      '--rm',
      '--health-interval=1s',
      '--health-start-period=0s',
      '--health-retries=1',
      image,
    ],
    { encoding: 'utf8' },
  ).trim()

  for (let attempt = 1; attempt <= 300; attempt += 1) {
    const status = execFileSync(
      'docker',
      ['inspect', '--format', '{{.State.Health.Status}}', container],
      { encoding: 'utf8' },
    ).trim()
    if (status === 'healthy') {
      console.log(`Docker image healthcheck passed on attempt ${attempt}`)
      break
    }
    if (status === 'unhealthy' || attempt === 300) {
      const health = execFileSync(
        'docker',
        ['inspect', '--format', '{{json .State.Health}}', container],
        {
          encoding: 'utf8',
        },
      ).trim()
      throw new Error(`Docker image healthcheck failed: ${health}`)
    }
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
} finally {
  if (container) execFileSync('docker', ['rm', '--force', container], { stdio: 'ignore' })
  execFileSync('docker', ['image', 'rm', image], { stdio: 'ignore' })
}

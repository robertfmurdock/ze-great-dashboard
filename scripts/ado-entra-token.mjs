import { spawn } from 'node:child_process'
import { mkdir, rename, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'

const tokenFile = resolve(process.env.ADO_ENTRA_TOKEN_FILE ?? '.dashboard-entra/ado-token.json')

try {
  const result = await runAz()
  const accessToken = typeof result.accessToken === 'string' ? result.accessToken : undefined
  const expiresAt = parseExpiry(result)
  if (!accessToken || !expiresAt || expiresAt <= Date.now()) throw new Error('invalid token')

  await mkdir(dirname(tokenFile), { recursive: true, mode: 0o700 })
  const temporaryFile = `${tokenFile}.next`
  await writeFile(
    temporaryFile,
    JSON.stringify({ accessToken, expiresAt: new Date(expiresAt).toISOString() }),
    { mode: 0o600 },
  )
  await rename(temporaryFile, tokenFile)
  console.log(`Azure DevOps delegated token is ready until ${new Date(expiresAt).toISOString()}.`)
} catch {
  console.error('Unable to obtain an Azure DevOps delegated token. Run az login and try again.')
  process.exitCode = 1
}

function runAz() {
  return new Promise((resolvePromise, reject) => {
    const az = spawn(
      'az',
      [
        'account',
        'get-access-token',
        '--scope',
        'https://app.vssps.visualstudio.com/.default',
        '--output',
        'json',
      ],
      { stdio: ['ignore', 'pipe', 'ignore'] },
    )
    let output = ''
    az.stdout.setEncoding('utf8')
    az.stdout.on('data', (chunk) => {
      output += chunk
    })
    az.once('error', reject)
    az.once('exit', (code) => {
      if (code !== 0) return reject(new Error('az failed'))
      try {
        resolvePromise(JSON.parse(output))
      } catch {
        reject(new Error('invalid az output'))
      }
    })
  })
}

function parseExpiry(result) {
  if (typeof result.expires_on === 'number') return result.expires_on * 1_000
  if (typeof result.expiresOn === 'string') return Date.parse(result.expiresOn)
  if (typeof result.expires_on === 'string') {
    const epochSeconds = Number(result.expires_on)
    return Number.isFinite(epochSeconds) ? epochSeconds * 1_000 : Date.parse(result.expires_on)
  }
  return undefined
}

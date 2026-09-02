import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'

const rootPackage = JSON.parse(readFileSync('package.json', 'utf8'))
const allowedFiles = new Set([
  'package.json',
  'package-lock.json',
  ...rootPackage.workspaces.map((workspace) => `${workspace}/package.json`),
])
function gitFileList(args) {
  const result = spawnSync('git', args, { encoding: 'utf8' })

  if (result.status !== 0) {
    process.stderr.write(result.stderr)
    process.exit(result.status ?? 1)
  }

  return result.stdout.split('\0').filter(Boolean)
}

const changedFiles = [
  ...gitFileList(['diff', '--name-only', '-z']),
  ...gitFileList(['ls-files', '--others', '--exclude-standard', '-z']),
]
const unexpectedFiles = changedFiles.filter(Boolean).filter((file) => !allowedFiles.has(file))

if (unexpectedFiles.length > 0) {
  process.stderr.write(
    `The dependency updater modified unexpected files:\n${unexpectedFiles.map((file) => `- ${file}`).join('\n')}\n`,
  )
  process.exit(1)
}

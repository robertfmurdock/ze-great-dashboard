import { spawnSync } from 'node:child_process'
import { nodeTestFiles } from './node-test-files.mjs'

const result = spawnSync(process.execPath, ['--test', ...nodeTestFiles], { stdio: 'inherit' })
if (result.error) throw result.error
process.exitCode = result.status ?? 1

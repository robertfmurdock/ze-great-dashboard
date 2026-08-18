#!/usr/bin/env node
import { assembleRelease, validateBoardConfig } from './index.ts'

const args = process.argv.slice(2)
const command = args[0]
const option = (name: string, fallback?: string) => {
  const index = args.indexOf(name)
  return index >= 0 ? args[index + 1] : fallback
}

try {
  const boardConfig = option('--board-config')
  if (!boardConfig) throw new Error('--board-config is required')
  if (command === 'validate') {
    const board = await validateBoardConfig(boardConfig)
    console.log(JSON.stringify({ valid: true, boardSha256: board.sha256 }))
  } else if (command === 'package') {
    const version = option('--version', process.env.DASHBOARD_VERSION ?? '0.0.0-dev') ?? '0.0.0-dev'
    const outputDir = option('--output', 'dashboard-release') ?? 'dashboard-release'
    const result = await assembleRelease({ boardConfigPath: boardConfig, outputDir, version })
    console.log(JSON.stringify(result.metadata))
  } else {
    throw new Error('Usage: ze-great-dashboard validate|package --board-config <path>')
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
}

import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { assembleRelease, clientAssetUrl, validateBoardConfig } from '../src/index.ts'

describe('consumer release contract', () => {
  it('validates a consumer board and emits a stable asset URL', async () => {
    const board = await validateBoardConfig(
      fileURLToPath(new URL('../../../boards/example.yaml', import.meta.url)),
    )
    expect(board.config.boards.example).toBeDefined()
    expect(clientAssetUrl('1.2.3')).toBe('https://public-assets.zegreatrob.com/dashboard/1.2.3')
  })

  it('rejects invalid consumer board configuration', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dashboard-invalid-'))
    const boardPath = join(root, 'board.yaml')
    await writeFile(boardPath, 'boards: {demo: {panels: []}}\nsources: {}\n')
    await expect(validateBoardConfig(boardPath)).rejects.toThrow(/Invalid board configuration/)
  })

  it('assembles equivalent YAML deterministically without secrets', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dashboard-release-'))
    const boardPath = join(root, 'board.yaml')
    await writeFile(boardPath, 'boards: {demo: {panels: [{id: p, type: x}]}}\nsources: {}\n')
    const one = await assembleRelease({
      boardConfigPath: boardPath,
      outputDir: join(root, 'one'),
      version: '1.0.0',
    })
    const two = await assembleRelease({
      boardConfigPath: boardPath,
      outputDir: join(root, 'two'),
      version: '1.0.0',
    })
    expect(one.files['board.yaml']).toBe(two.files['board.yaml'])
    expect(await readFile(join(root, 'one', 'release.json'), 'utf8')).not.toMatch(/token|secret/i)
  })
})

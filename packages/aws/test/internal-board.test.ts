import { describe, expect, it } from 'vitest'
import { boardConfigSchema } from '../src/internal-board.ts'

describe('the AWS board validator compatibility contract', () => {
  it('accepts boards without a density setting', () => {
    expect(
      boardConfigSchema.safeParse({
        boards: { legacy: { panels: [{ id: 'build', type: 'pipeline-status' }] } },
      }).success,
    ).toBe(true)
  })

  it('preserves supported density settings', () => {
    const result = boardConfigSchema.parse({
      boards: {
        board: {
          panels: [
            { id: 'build', type: 'pipeline-status', density: 'comfortable' },
            { id: 'future', type: 'http-value', density: 'compact' },
          ],
        },
      },
    })

    expect(result.boards.board?.panels).toEqual([
      { id: 'build', type: 'pipeline-status', density: 'comfortable' },
      { id: 'future', type: 'http-value', density: 'compact' },
    ])
  })
})

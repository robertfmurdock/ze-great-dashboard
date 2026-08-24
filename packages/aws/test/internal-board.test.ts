import { describe, expect, it } from 'vitest'
import { boardConfigSchema } from '../src/internal-board.ts'

describe('the AWS board validator compatibility contract', () => {
  it('accepts legacy boards without a display role', () => {
    expect(
      boardConfigSchema.safeParse({
        boards: { legacy: { panels: [{ id: 'build', type: 'pipeline-status' }] } },
      }).success,
    ).toBe(true)
  })

  it('preserves supported and future cosmetic roles', () => {
    const result = boardConfigSchema.parse({
      boards: {
        board: {
          panels: [
            { id: 'build', type: 'pipeline-status', display: 'primary' },
            { id: 'future', type: 'http-value', display: 'hero' },
          ],
        },
      },
    })

    expect(result.boards.board?.panels).toEqual([
      { id: 'build', type: 'pipeline-status', display: 'primary' },
      { id: 'future', type: 'http-value', display: 'hero' },
    ])
  })
})

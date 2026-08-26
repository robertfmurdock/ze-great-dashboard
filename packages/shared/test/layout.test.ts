import { describe, expect, it } from 'vitest'
import type { Panel } from '../src/board-config.ts'
import { analyzeBoardLayout, isZeroPosition, normalizeBoardLayout } from '../src/layout.ts'

const panel = (id: string, position?: Panel['position']): Panel => ({
  id,
  type: 'test',
  ...(position ? { position } : {}),
})

describe('analyzeBoardLayout', () => {
  it('accepts a clean twelve-by-twelve layout', () => {
    const result = analyzeBoardLayout([
      panel('left', { x: 0, y: 0, w: 6, h: 6 }),
      panel('right', { x: 6, y: 0, w: 6, h: 6 }),
    ])

    expect(result.issues).toEqual([])
  })

  it('reports vertical overflow without changing authored coordinates', () => {
    const position = { x: 0, y: 12, w: 12, h: 12 }
    const result = analyzeBoardLayout([panel('review', position)])

    expect(result.issues[0]).toMatchObject({ panelId: 'review', kind: 'out-of-bounds' })
  })

  it('reports overlaps separately from non-renderable positions', () => {
    const result = analyzeBoardLayout([
      panel('first', { x: 0, y: 0, w: 8, h: 3 }),
      panel('second', { x: 4, y: 1, w: 8, h: 2 }),
    ])

    expect(result.issues[0]).toMatchObject({
      panelId: 'second',
      kind: 'overlap',
      position: { x: 4, y: 1, w: 8, h: 2 },
      conflictsWith: ['first'],
    })
  })

  it('aggregates all overlap partners into one issue', () => {
    const result = analyzeBoardLayout([
      panel('first', { x: 0, y: 0, w: 6, h: 3 }),
      panel('second', { x: 6, y: 0, w: 6, h: 3 }),
      panel('third', { x: 4, y: 1, w: 4, h: 2 }),
    ])

    expect(result.issues).toEqual([
      expect.objectContaining({
        panelId: 'third',
        kind: 'overlap',
        conflictsWith: ['first', 'second'],
      }),
    ])
  })

  it('does not report unpositioned panels as repaired', () => {
    const result = analyzeBoardLayout([panel('implicit')])

    expect(result.issues).toEqual([])
  })

  it('recognizes the zero-size preserved-but-hidden sentinel', () => {
    expect(isZeroPosition({ x: 0, y: 0, w: 0, h: 0 })).toBe(true)
    expect(isZeroPosition({ x: 0, y: 0, w: 1, h: 1 })).toBe(false)
    expect(analyzeBoardLayout([panel('hidden', { x: 0, y: 0, w: 0, h: 0 })]).issues).toEqual([])
  })

  it('normalizes an oversized rendered area into the twelve-by-twelve canvas', () => {
    const normalized = normalizeBoardLayout([
      panel('build', { x: 0, y: 0, w: 8, h: 6 }),
      panel('version', { x: 8, y: 0, w: 4, h: 6 }),
      panel('treatments', { x: 0, y: 6, w: 12, h: 6 }),
      panel('review', { x: 0, y: 12, w: 12, h: 12 }),
    ])

    expect(normalized.map((item) => item.position)).toEqual([
      { x: 0, y: 0, w: 8, h: 3 },
      { x: 8, y: 0, w: 4, h: 3 },
      { x: 0, y: 3, w: 12, h: 3 },
      { x: 0, y: 6, w: 12, h: 6 },
    ])
    expect(analyzeBoardLayout(normalized).issues).toEqual([])
  })

  it('moves later panels to the nearest legal cells after scaling', () => {
    const normalized = normalizeBoardLayout([
      panel('first', { x: 0, y: 0, w: 8, h: 3 }),
      panel('second', { x: 4, y: 1, w: 8, h: 2 }),
    ])

    expect(normalized[1]?.position).toEqual({ x: 4, y: 3, w: 8, h: 2 })
    expect(analyzeBoardLayout(normalized).issues).toEqual([])
  })

  it('zeroes a panel when no legal cell remains', () => {
    const normalized = normalizeBoardLayout([
      panel('first', { x: 0, y: 0, w: 12, h: 12 }),
      panel('second', { x: 0, y: 0, w: 12, h: 12 }),
    ])

    expect(normalized[1]?.position).toEqual({ x: 0, y: 0, w: 0, h: 0 })
    expect(analyzeBoardLayout(normalized).issues).toEqual([])
  })
})

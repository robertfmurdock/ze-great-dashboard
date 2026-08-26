import { describe, expect, it } from 'vitest'
import {
  buildStaticField,
  clearTrailingLine,
  type FallingShape,
  fallingDirection,
  fallingGrid,
  findDestination,
  findPlacement,
  occupiedCellCount,
  overlaps,
  shapeFits,
  targetCellCount,
} from '../src/falling-shapes.ts'

const settled = (x: number, y: number): FallingShape => ({
  id: 1,
  bornAt: 0,
  cells: [{ x: 0, y: 0 }],
  x,
  y,
  phase: 'settled',
})

describe('falling shapes', () => {
  it('uses a stable wide-versus-tall direction rule', () => {
    expect(fallingDirection(12, 6)).toBe('horizontal')
    expect(fallingDirection(6, 12)).toBe('vertical')
    expect(fallingDirection(12, 12)).toBe('vertical')
  })

  it('scales the logical field to the available rendered space', () => {
    expect(fallingGrid('horizontal', 1200, 180)).toEqual({ columns: 24, rows: 4 })
    expect(fallingGrid('vertical', 180, 720)).toEqual({ columns: 4, rows: 16 })
    expect(fallingGrid('horizontal', 300, 300)).toEqual({ columns: 6, rows: 6 })
  })

  it('only accepts shapes that fit the logical panel grid', () => {
    expect(
      shapeFits(
        [
          { x: 0, y: 0 },
          { x: 1, y: 0 },
        ],
        2,
        2,
      ),
    ).toBe(true)
    expect(
      shapeFits(
        [
          { x: 0, y: 0 },
          { x: 1, y: 0 },
        ],
        1,
        2,
      ),
    ).toBe(false)
  })

  it('chooses a supported, non-overlapping destination', () => {
    const piece = [{ x: 0, y: 0 }]
    const destination = findDestination(piece, 'vertical', 4, 4, [settled(0, 3)])
    expect(destination).toEqual({ x: 1, y: 3 })
    expect(
      overlaps({ ...settled(0, 0), x: destination?.x ?? 0, y: destination?.y ?? 0 }, settled(0, 3)),
    ).toBe(false)
  })

  it('rejects a supported destination whose approach crosses a settled piece', () => {
    const destination = findDestination(
      [{ x: 0, y: 0 }],
      'vertical',
      2,
      4,
      [settled(0, 1)],
      0,
      true,
    )
    expect(destination).toEqual({ x: 1, y: 3 })
  })

  it('can choose a supported placement from a different generated shape', () => {
    const placement = findPlacement('vertical', 4, 4, [settled(0, 3)], 12, true)
    expect(placement).toBeDefined()
    expect(placement?.destination.y).toBeLessThan(4)
  })

  it('builds a deterministic reduced-motion composition without overlap', () => {
    const pieces = buildStaticField('horizontal', 12, 4, 42, 6)
    expect(pieces.length).toBeGreaterThan(0)
    expect(pieces.every((piece) => piece.phase === 'settled')).toBe(true)
    expect(
      pieces.some((left, index) => pieces.slice(index + 1).some((right) => overlaps(left, right))),
    ).toBe(false)
  })

  it('ramps the target field toward an 85 percent fill at the estimate', () => {
    expect(targetCellCount(10, 10, 0)).toBe(0)
    expect(targetCellCount(10, 10, 0.5)).toBe(43)
    expect(targetCellCount(10, 10, 1)).toBe(85)
    expect(targetCellCount(10, 10, 2)).toBe(85)
  })

  it('counts occupied cells for pacing without counting empty space', () => {
    expect(
      occupiedCellCount([
        settled(0, 0),
        {
          ...settled(1, 0),
          cells: [
            { x: 0, y: 0 },
            { x: 1, y: 0 },
          ],
        },
      ]),
    ).toBe(3)
  })

  it('removes the bottom vertical line and shifts the remaining field down', () => {
    const cleared = clearTrailingLine('vertical', 2, 4, [settled(0, 0), settled(1, 3)], true)
    expect(cleared?.complete).toBe(false)
    expect(cleared?.cleared).toEqual([{ x: 1, y: 3 }])
    expect(cleared?.shapes).toEqual([{ ...settled(0, 0), y: 1 }])
  })

  it('removes the left horizontal line and shifts the remaining field left', () => {
    const cleared = clearTrailingLine('horizontal', 4, 2, [settled(0, 0), settled(2, 1)], true)
    expect(cleared?.cleared).toEqual([{ x: 0, y: 0 }])
    expect(cleared?.shapes).toEqual([{ ...settled(2, 1), x: 1 }])
  })

  it('retains the unaffected cells of a shape intersecting the cleared line', () => {
    const shape = {
      ...settled(0, 2),
      cells: [
        { x: 0, y: 0 },
        { x: 0, y: 1 },
      ],
    }
    const cleared = clearTrailingLine('vertical', 2, 4, [shape], true)
    expect(cleared?.cleared).toEqual([{ x: 0, y: 3 }])
    expect(cleared?.shapes).toEqual([{ ...shape, cells: [{ x: 0, y: 0 }], y: 3 }])
  })

  it('can require a complete trailing line before clearing', () => {
    const cleared = clearTrailingLine('vertical', 2, 4, [settled(0, 3)], false)
    expect(cleared).toBeUndefined()
  })
})

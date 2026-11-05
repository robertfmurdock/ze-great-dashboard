import { mint } from '@continuous-excellence/testmints-js/vitest'
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
describe('falling field sizing', () => {
  for (const scenario of [
    { width: 12, height: 6, direction: 'horizontal' },
    { width: 6, height: 12, direction: 'vertical' },
    { width: 12, height: 12, direction: 'vertical' },
  ] as const)
    it(
      `falls ${scenario.direction} in ${scenario.width} by ${scenario.height}`,
      mint({
        setup: () => scenario,
        exercise: ({ width, height }) => fallingDirection(width, height),
        verify: (actual, { direction }) => expect(actual).toBe(direction),
      }),
    )
  for (const scenario of [
    { direction: 'horizontal', width: 1200, height: 180, grid: { columns: 24, rows: 4 } },
    { direction: 'vertical', width: 180, height: 720, grid: { columns: 4, rows: 16 } },
    { direction: 'horizontal', width: 300, height: 300, grid: { columns: 6, rows: 6 } },
  ] as const)
    it(
      `scales the ${scenario.direction} grid for ${scenario.width} by ${scenario.height}`,
      mint({
        setup: () => scenario,
        exercise: ({ direction, width, height }) => fallingGrid(direction, width, height),
        verify: (grid, { grid: expected }) => expect(grid).toEqual(expected),
      }),
    )
  for (const scenario of [
    { columns: 2, fits: true },
    { columns: 1, fits: false },
  ])
    it(
      `fits a two-cell piece in ${scenario.columns} columns: ${scenario.fits}`,
      mint({
        setup: () => ({
          ...scenario,
          rows: 2,
          cells: [
            { x: 0, y: 0 },
            { x: 1, y: 0 },
          ],
        }),
        exercise: ({ cells, columns, rows }) => shapeFits(cells, columns, rows),
        verify: (fits, { fits: expected }) => expect(fits).toBe(expected),
      }),
    )
})
describe('falling placement', () => {
  it(
    'chooses a supported destination beside occupied space',
    mint({
      setup: () => ({ piece: [{ x: 0, y: 0 }], obstacles: [settled(0, 3)] }),
      exercise: ({ piece, obstacles }) => findDestination(piece, 'vertical', 4, 4, obstacles),
      verify: (destination) => expect(destination).toEqual({ x: 1, y: 3 }),
    }),
  )
  it(
    'rejects an approach crossing a settled piece',
    mint({
      setup: () => ({ piece: [{ x: 0, y: 0 }], obstacles: [settled(0, 1)] }),
      exercise: ({ piece, obstacles }) =>
        findDestination(piece, 'vertical', 2, 4, obstacles, 0, true),
      verify: (destination) => expect(destination).toEqual({ x: 1, y: 3 }),
    }),
  )
  it(
    'chooses a supported placement from generated shapes',
    mint({
      setup: () => ({ obstacles: [settled(0, 3)], seed: 12 }),
      exercise: ({ obstacles, seed }) => findPlacement('vertical', 4, 4, obstacles, seed, true),
      verify: (placement) => {
        expect(placement).toBeDefined()
        expect(placement?.destination.y).toBeLessThan(4)
      },
    }),
  )
  it(
    'builds a settled reduced-motion field without overlap',
    mint({
      setup: () => ({ seed: 42 }),
      exercise: ({ seed }) => buildStaticField('horizontal', 12, 4, seed, 6),
      verify: (pieces) => {
        expect(pieces.length).toBeGreaterThan(0)
        expect(pieces.every((piece) => piece.phase === 'settled')).toBe(true)
        const occupied = pieces.flatMap((piece) =>
          piece.cells.map((cell) => `${piece.x + cell.x}:${piece.y + cell.y}`),
        )
        expect(new Set(occupied).size).toBe(occupied.length)
      },
    }),
  )
})
describe('fill pacing', () => {
  for (const scenario of [
    { progress: 0, target: 0 },
    { progress: 0.5, target: 43 },
    { progress: 1, target: 85 },
    { progress: 2, target: 85 },
  ])
    it(
      `targets ${scenario.target} cells at progress ${scenario.progress}`,
      mint({
        setup: () => ({ ...scenario, columns: 10, rows: 10 }),
        exercise: ({ columns, rows, progress }) => targetCellCount(columns, rows, progress),
        verify: (count, { target }) => expect(count).toBe(target),
      }),
    )
  it(
    'counts occupied cells rather than bounding space',
    mint({
      setup: () => ({
        shapes: [
          settled(0, 0),
          {
            ...settled(1, 0),
            cells: [
              { x: 0, y: 0 },
              { x: 1, y: 0 },
            ],
          },
        ],
      }),
      exercise: ({ shapes }) => occupiedCellCount(shapes),
      verify: (count) => expect(count).toBe(3),
    }),
  )
})
describe('trailing line clearing', () => {
  it(
    'removes a partial bottom line and shifts remaining shapes down',
    mint({
      setup: () => ({ survivor: settled(0, 0), removed: settled(1, 3) }),
      exercise: ({ survivor, removed }) =>
        clearTrailingLine('vertical', 2, 4, [survivor, removed], true),
      verify: (cleared, { survivor, removed }) => {
        expect(cleared?.complete).toBe(false)
        expect(cleared?.cleared).toEqual([{ x: removed.x, y: removed.y }])
        expect(cleared?.shapes).toEqual([{ ...survivor, y: survivor.y + 1 }])
      },
    }),
  )
  it(
    'removes the left line and shifts remaining shapes left',
    mint({
      setup: () => ({ removed: settled(0, 0), survivor: settled(2, 1) }),
      exercise: ({ removed, survivor }) =>
        clearTrailingLine('horizontal', 4, 2, [removed, survivor], true),
      verify: (cleared, { removed, survivor }) => {
        expect(cleared?.cleared).toEqual([{ x: removed.x, y: removed.y }])
        expect(cleared?.shapes).toEqual([{ ...survivor, x: survivor.x - 1 }])
      },
    }),
  )
  it(
    'retains cells of a shape intersecting the cleared line',
    mint({
      setup: () => ({
        shape: {
          ...settled(0, 2),
          cells: [
            { x: 0, y: 0 },
            { x: 0, y: 1 },
          ],
        },
      }),
      exercise: ({ shape }) => clearTrailingLine('vertical', 2, 4, [shape], true),
      verify: (cleared, { shape }) => {
        expect(cleared?.cleared).toEqual([{ x: shape.x, y: shape.y + 1 }])
        expect(cleared?.shapes).toEqual([{ ...shape, cells: [shape.cells[0]], y: shape.y + 1 }])
      },
    }),
  )
  it(
    'retains an incomplete line when completeness is required',
    mint({
      setup: () => ({ shapes: [settled(0, 3)] }),
      exercise: ({ shapes }) => clearTrailingLine('vertical', 2, 4, shapes, false),
      verify: (cleared) => expect(cleared).toBeUndefined(),
    }),
  )
})

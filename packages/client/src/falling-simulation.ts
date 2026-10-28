import {
  clearTrailingLine,
  type FallingCell,
  type FallingDirection,
  type FallingShape,
  findPlacement,
  occupiedCellCount,
  targetCellCount,
} from './falling-shapes.ts'

export const FALLING_ENTRY_MS = 250
export const FALLING_TRAVEL_MS = 850
export const FALLING_RECYCLE_MS = 500
export const FALLING_PIECE_INTERVAL_MS = 1_250

export type FallingSimulation = {
  settled: FallingShape[]
  active: FallingShape[]
  nextPieceAt: number
  recycleUntil: number
  nextId: number
  recycling: boolean
  clearingCells: FallingCell[]
}

type SimulationInput = {
  elapsed: number
  direction: FallingDirection
  columns: number
  rows: number
  progress: number
  estimatedDurationMs?: number
  overdue: boolean
  seed: number
}

export function createFallingSimulation(): FallingSimulation {
  return {
    settled: [],
    active: [],
    nextPieceAt: FALLING_PIECE_INTERVAL_MS,
    recycleUntil: 0,
    nextId: 0,
    recycling: false,
    clearingCells: [],
  }
}

export function advanceFallingSimulation(
  simulation: FallingSimulation,
  input: SimulationInput,
): FallingSimulation {
  if (input.elapsed < simulation.recycleUntil) return simulation
  let settled = simulation.settled
  let active = simulation.active
  let nextPieceAt = simulation.nextPieceAt
  const recycleUntil = simulation.recycleUntil
  let nextId = simulation.nextId
  let recycling = simulation.recycling
  let clearingCells = simulation.clearingCells

  if (recycling) {
    recycling = false
    clearingCells = []
  }
  if (input.elapsed >= nextPieceAt && active.length === 0) {
    const target = targetCellCount(input.columns, input.rows, input.progress)
    if (input.progress < 1 && occupiedCellCount(settled) >= target)
      return { ...simulation, recycling, clearingCells }
    const placement = findPlacement(
      input.direction,
      input.columns,
      input.rows,
      settled,
      input.seed + nextId * 17 + 1,
      !input.overdue,
    )
    if (!placement && (input.progress >= 1 || input.estimatedDurationMs === undefined)) {
      const cleared = clearTrailingLine(input.direction, input.columns, input.rows, settled, true)
      if (cleared) {
        return {
          ...simulation,
          settled: cleared.shapes,
          recycleUntil: input.elapsed + FALLING_RECYCLE_MS,
          nextPieceAt: input.elapsed + FALLING_RECYCLE_MS,
          recycling: true,
          clearingCells: cleared.cleared,
        }
      }
    }
    if (placement) {
      const height = Math.max(...placement.shape.map((cell) => cell.y)) + 1
      active = [
        {
          id: nextId,
          bornAt: input.elapsed,
          cells: placement.shape,
          x:
            input.direction === 'horizontal'
              ? input.columns - Math.max(...placement.shape.map((cell) => cell.x)) - 0.5
              : placement.destination.x,
          y: input.direction === 'vertical' ? -height + 0.5 : placement.destination.y,
          targetX: placement.destination.x,
          targetY: placement.destination.y,
          phase: 'entry',
        },
      ]
      nextId += 1
      nextPieceAt += pieceInterval(input.estimatedDurationMs, input.columns, input.rows)
    }
  }
  const nextActive: FallingShape[] = []
  for (const piece of active) {
    const age = input.elapsed - piece.bornAt
    const amount = Math.min(1, Math.max(0, (age - FALLING_ENTRY_MS) / FALLING_TRAVEL_MS))
    if (amount >= 1 && piece.targetX !== undefined && piece.targetY !== undefined) {
      settled = [...settled, { ...piece, x: piece.targetX, y: piece.targetY, phase: 'settled' }]
      continue
    }
    const startX =
      input.direction === 'horizontal'
        ? input.columns - Math.max(...piece.cells.map((cell) => cell.x)) - 1
        : (piece.targetX ?? piece.x)
    const startY = input.direction === 'vertical' ? 0 : (piece.targetY ?? piece.y)
    const lifecycleAmount = Math.min(1, Math.max(0, age / (FALLING_ENTRY_MS + FALLING_TRAVEL_MS)))
    nextActive.push({
      ...piece,
      x:
        input.direction === 'horizontal'
          ? startX + ((piece.targetX ?? startX) - startX) * amount
          : startX,
      y:
        input.direction === 'vertical'
          ? startY + ((piece.targetY ?? startY) - startY) * amount
          : startY,
      phase: age < FALLING_ENTRY_MS ? 'entry' : lifecycleAmount < 0.35 ? 'align' : 'travel',
    })
  }
  return {
    settled,
    active: nextActive,
    nextPieceAt,
    recycleUntil,
    nextId,
    recycling,
    clearingCells,
  }
}

export function visibleFallingShapes(simulation: FallingSimulation) {
  return [...simulation.settled, ...simulation.active]
}

function pieceInterval(estimatedDurationMs: number | undefined, columns: number, rows: number) {
  const target = Math.ceil(columns * rows * 0.85)
  return estimatedDurationMs === undefined || target <= 0
    ? FALLING_PIECE_INTERVAL_MS
    : Math.max(400, estimatedDurationMs / Math.max(1, Math.ceil(target / 3)))
}

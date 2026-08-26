export type FallingDirection = 'horizontal' | 'vertical'
export type FallingCell = { x: number; y: number }
export type FallingShape = {
  id: number
  bornAt: number
  cells: FallingCell[]
  x: number
  y: number
  targetX?: number
  targetY?: number
  phase: 'entry' | 'align' | 'travel' | 'settled'
}

export const FALLING_TARGET_FILL = 0.85

const shapes: FallingCell[][] = [
  [
    { x: 0, y: 0 },
    { x: 1, y: 0 },
  ],
  [
    { x: 0, y: 0 },
    { x: 0, y: 1 },
  ],
  [
    { x: 0, y: 0 },
    { x: 1, y: 0 },
    { x: 0, y: 1 },
  ],
  [
    { x: 0, y: 0 },
    { x: 1, y: 0 },
    { x: 2, y: 0 },
  ],
  [
    { x: 0, y: 0 },
    { x: 0, y: 1 },
    { x: 1, y: 1 },
  ],
]

export function fallingDirection(width: number, height: number): FallingDirection {
  return width > height ? 'horizontal' : 'vertical'
}

export function fallingGrid(
  direction: FallingDirection,
  width = direction === 'horizontal' ? 12 : 3,
  height = direction === 'horizontal' ? 3 : 12,
): { columns: number; rows: number } {
  const fieldWidth = Math.max(1, width * 0.8)
  const fieldHeight = Math.max(1, height * 0.8)
  const cellSize = Math.max(24, Math.min(42, Math.min(fieldWidth, fieldHeight) / 4))
  const columns = Math.max(3, Math.min(24, Math.round(fieldWidth / cellSize)))
  const rows = Math.max(3, Math.min(16, Math.round(fieldHeight / cellSize)))
  return direction === 'horizontal'
    ? { columns: Math.max(columns, rows), rows }
    : { columns, rows: Math.max(rows, columns) }
}

export function fallingSeed(value: string): number {
  return Array.from(value).reduce(
    (hash, character) => (hash * 31 + character.charCodeAt(0)) >>> 0,
    7,
  )
}

export function shapeFits(shape: FallingCell[], columns: number, rows: number): boolean {
  const maxX = Math.max(...shape.map((cell) => cell.x))
  const maxY = Math.max(...shape.map((cell) => cell.y))
  return maxX < columns && maxY < rows
}

export function overlaps(left: FallingShape, right: FallingShape): boolean {
  return left.cells.some((leftCell) =>
    right.cells.some(
      (rightCell) =>
        left.x + leftCell.x === right.x + rightCell.x &&
        left.y + leftCell.y === right.y + rightCell.y,
    ),
  )
}

export function chooseShape(seed: number, columns: number, rows: number): FallingCell[] {
  const candidates = shapes.filter((shape) => shapeFits(shape, columns, rows))
  return candidates[randomIndex(seed, candidates.length)] ?? [{ x: 0, y: 0 }]
}

export function findDestination(
  shape: FallingCell[],
  direction: FallingDirection,
  columns: number,
  rows: number,
  settled: readonly FallingShape[],
  seed = 0,
  requireSupported = false,
): { x: number; y: number } | undefined {
  const width = Math.max(...shape.map((cell) => cell.x)) + 1
  const height = Math.max(...shape.map((cell) => cell.y)) + 1
  const candidates: Array<{ x: number; y: number; support: number }> = []
  for (let y = 0; y <= rows - height; y++) {
    for (let x = 0; x <= columns - width; x++) {
      const candidate = { id: -1, bornAt: 0, cells: shape, x, y, phase: 'settled' as const }
      if (settled.some((item) => overlaps(candidate, item))) continue
      if (!clearPath(shape, direction, columns, rows, candidate, settled)) continue
      const support =
        direction === 'vertical'
          ? shape.filter(
              (cell) =>
                y + cell.y === rows - 1 ||
                settled.some((item) =>
                  item.cells.some(
                    (other) =>
                      item.x + other.x === x + cell.x && item.y + other.y === y + cell.y + 1,
                  ),
                ),
            ).length
          : shape.filter(
              (cell) =>
                x + cell.x === 0 ||
                settled.some((item) =>
                  item.cells.some(
                    (other) =>
                      item.x + other.x === x + cell.x - 1 && item.y + other.y === y + cell.y,
                  ),
                ),
            ).length
      if (requireSupported && support < leadingEdgeCount(shape, direction)) continue
      candidates.push({ x, y, support })
    }
  }
  candidates.sort(
    (left, right) =>
      right.support - left.support ||
      (direction === 'vertical'
        ? right.y - left.y || left.x - right.x
        : left.x - right.x || left.y - right.y),
  )
  const bestSupport = candidates[0]?.support
  const best = candidates.filter((candidate) => candidate.support === bestSupport)
  const destination = best[randomIndex(seed, best.length)]
  return destination ? { x: destination.x, y: destination.y } : undefined
}

export function findPlacement(
  direction: FallingDirection,
  columns: number,
  rows: number,
  settled: readonly FallingShape[],
  seed: number,
  requireSupported: boolean,
): { shape: FallingCell[]; destination: { x: number; y: number } } | undefined {
  const candidates = shapes.flatMap((shape, index) => {
    if (!shapeFits(shape, columns, rows)) return []
    const destination = findDestination(
      shape,
      direction,
      columns,
      rows,
      settled,
      seed + index * 31,
      requireSupported,
    )
    return destination ? [{ shape, destination }] : []
  })
  if (candidates.length === 0) return undefined
  return candidates[randomIndex(seed, candidates.length)]
}

export function targetCellCount(columns: number, rows: number, progress: number): number {
  return Math.ceil(columns * rows * FALLING_TARGET_FILL * Math.min(1, Math.max(0, progress)))
}

export function occupiedCellCount(shapes: readonly FallingShape[]): number {
  return shapes.reduce((count, shape) => count + shape.cells.length, 0)
}

export type LineClear = {
  shapes: FallingShape[]
  cleared: FallingCell[]
  complete: boolean
}

/** Clears only cells in the trailing edge line and slides the surviving field into it. */
export function clearTrailingLine(
  direction: FallingDirection,
  columns: number,
  rows: number,
  settled: readonly FallingShape[],
  allowPartial: boolean,
): LineClear | undefined {
  const edgeLine = direction === 'vertical' ? rows - 1 : 0
  const occupied = new Set(
    settled.flatMap((item) =>
      item.cells
        .filter((cell) =>
          direction === 'vertical' ? item.y + cell.y === edgeLine : item.x + cell.x === edgeLine,
        )
        .map((cell) => (direction === 'vertical' ? item.x + cell.x : item.y + cell.y)),
    ),
  )
  const lineWidth = direction === 'vertical' ? columns : rows
  const complete = occupied.size === lineWidth
  if (!complete && !allowPartial) return undefined
  if (occupied.size === 0) return undefined

  const cleared: FallingCell[] = []
  const shapes = settled.flatMap((item) => {
    const remaining = item.cells.filter((cell) => {
      const onLine =
        direction === 'vertical' ? item.y + cell.y === edgeLine : item.x + cell.x === edgeLine
      if (onLine) {
        cleared.push({ x: item.x + cell.x, y: item.y + cell.y })
      }
      return !onLine
    })
    if (remaining.length === 0) return []
    return [
      {
        ...item,
        cells: remaining,
        y: direction === 'vertical' ? item.y + 1 : item.y,
        x: direction === 'horizontal' ? item.x - 1 : item.x,
      },
    ]
  })
  return { shapes, cleared, complete }
}

export function buildStaticField(
  direction: FallingDirection,
  columns: number,
  rows: number,
  seed: number,
  count: number,
): FallingShape[] {
  const settled: FallingShape[] = []
  for (let id = 0; id < count; id += 1) {
    const pieceSeed = seed + id * 17
    const shape = chooseShape(pieceSeed, columns, rows)
    const destination = findDestination(shape, direction, columns, rows, settled, pieceSeed + 1)
    if (!destination) break
    settled.push({
      id,
      bornAt: 0,
      cells: shape,
      x: destination.x,
      y: destination.y,
      phase: 'settled',
    })
  }
  return settled
}

function leadingEdgeCount(shape: FallingCell[], direction: FallingDirection): number {
  if (direction === 'vertical') {
    return new Set(shape.map((cell) => cell.x)).size
  }
  return new Set(shape.map((cell) => cell.y)).size
}

function clearPath(
  shape: FallingCell[],
  direction: FallingDirection,
  columns: number,
  rows: number,
  destination: FallingShape,
  settled: readonly FallingShape[],
): boolean {
  const width = Math.max(...shape.map((cell) => cell.x)) + 1
  const height = Math.max(...shape.map((cell) => cell.y)) + 1
  if (direction === 'vertical') {
    for (let y = 0; y <= destination.y; y += 1) {
      if (settled.some((item) => overlaps({ ...destination, y }, item))) return false
    }
    return destination.y + height <= rows
  }
  for (let x = columns - width; x >= destination.x; x -= 1) {
    if (settled.some((item) => overlaps({ ...destination, x }, item))) return false
  }
  return destination.x + width <= columns
}

function randomIndex(seed: number, length: number): number {
  if (length <= 1) return 0
  const value = Math.sin(seed * 12.9898 + 78.233) * 43_758.5453
  return Math.floor((value - Math.floor(value)) * length)
}

export type SnowmanPhase = 'drift' | 'snowing' | 'assembling' | 'complete' | 'overdue'
export type SnowCellOwner = 'ground' | 'body' | 'head' | 'snowman'
export type SnowmanDimensions = { width: number; height: number }

export type SnowCell = {
  id: number
  x: number
  y: number
  owner: SnowCellOwner
  /** Coordinates relative to a rolling ball. Ground and accumulated snow omit these. */
  localX?: number
  localY?: number
  targetLocalX?: number
  targetLocalY?: number
}
export type AirborneFlake = { id: number; x: number; y: number; bornAt: number }
export type Snowball = {
  kind: 'body' | 'head'
  x: number
  y: number
  radius: number
  angle: number
  /** A placed ball no longer follows the relaxing terrain beneath it. */
  locked: boolean
}
export type SnowmanSimulation = {
  nextAt: number
  id: number
  lastElapsed: number
  grid: { columns: number; rows: number }
  flakes: AirborneFlake[]
  cells: SnowCell[]
  body?: Snowball
  head?: Snowball
  toppling?: { startedAt: number; angle: number; pivotX: number; pivotY: number }
  toppled: boolean
}

const STEP_MS = 25
const ASSEMBLY_START = 0.5
const BODY_DONE = 0.75
const HAT_AT = 0.95
/** Attached snowfall at which the completed decorative figure falls and stays down. */
export const SNOWMAN_TOPPLE_LOAD = 60

export function createSnowmanSimulation(
  dimensions: SnowmanDimensions = { width: 360, height: 180 },
): SnowmanSimulation {
  return {
    nextAt: 0,
    id: 0,
    lastElapsed: 0,
    grid: snowmanGrid(dimensions),
    flakes: [],
    cells: [],
    toppled: false,
  }
}

export function snowmanGrid(dimensions: SnowmanDimensions) {
  // Four device-independent pixels gives fine grain without making a compact field expensive.
  const columns = clamp(Math.round(dimensions.width / 4), 48, 180)
  const rows = clamp(Math.round(dimensions.height / 4), 28, 100)
  return { columns, rows }
}

export function snowmanScenePhase(
  progress: number,
  estimatedDurationMs: number | undefined,
  overdue: boolean,
): SnowmanPhase {
  if (overdue) return 'overdue'
  if (estimatedDurationMs === undefined) return 'snowing'
  if (progress >= HAT_AT) return 'complete'
  if (progress >= ASSEMBLY_START) return 'assembling'
  return 'drift'
}

/** A permanent slight breeze plus seed-stable, visibly stronger intermittent gusts. */
export function snowmanWind(seed: number, elapsed: number) {
  const direction = random(seed + 41) < 0.5 ? -1 : 1
  const breeze = direction * (0.72 + random(seed + 43) * 0.45)
  const smallVariation = Math.sin(elapsed / 1_600 + random(seed + 47) * Math.PI * 2) * 0.4
  const gustWave = Math.max(0, Math.sin(elapsed / 3_100 + random(seed + 53) * Math.PI * 2))
  const gust = direction * gustWave ** 7 * (3.2 + random(seed + 59) * 1.8)
  return breeze + smallVariation + gust
}

export function snowmanMaterialCount(dimensions: SnowmanDimensions) {
  const grid = snowmanGrid(dimensions)
  return Math.round(grid.columns * grid.rows * 0.18)
}

export function snowmanSpawnInterval(
  estimatedDurationMs: number | undefined,
  dimensions: SnowmanDimensions,
  overdue = false,
) {
  if (estimatedDurationMs === undefined) return overdue ? 30 : 60
  const ordinary = (estimatedDurationMs * HAT_AT) / snowmanMaterialCount(dimensions)
  return overdue ? ordinary / 2 : ordinary
}

/** Advances a fixed-step cellular snow simulation without reading the DOM or a browser clock. */
export function advanceSnowmanSimulation(
  previous: SnowmanSimulation,
  {
    elapsed,
    progress,
    estimatedDurationMs,
    overdue,
    seed,
    dimensions,
  }: {
    elapsed: number
    progress: number
    estimatedDurationMs?: number
    overdue: boolean
    seed: number
    dimensions: SnowmanDimensions
  },
): SnowmanSimulation {
  const grid = snowmanGrid(dimensions)
  let simulation =
    previous.grid.columns === grid.columns && previous.grid.rows === grid.rows
      ? clone(previous)
      : createSnowmanSimulation(dimensions)
  const targetElapsed = Math.max(simulation.lastElapsed, elapsed)
  for (let time = simulation.lastElapsed; time < targetElapsed; time += STEP_MS) {
    const nextTime = Math.min(targetElapsed, time + STEP_MS)
    simulation = step(
      simulation,
      nextTime,
      progress,
      estimatedDurationMs,
      overdue,
      seed,
      dimensions,
    )
  }
  simulation.lastElapsed = targetElapsed
  return simulation
}

export function snowmanStaticScene(
  phase: SnowmanPhase,
  seed: number,
  dimensions: SnowmanDimensions,
): SnowmanSimulation {
  const duration = 10_000
  const overdue = phase === 'overdue'
  const progress =
    phase === 'drift' || phase === 'snowing' ? 0.48 : phase === 'assembling' ? 0.72 : 1
  const elapsed = overdue ? duration * 2.5 : duration * progress
  return advanceSnowmanSimulation(createSnowmanSimulation(dimensions), {
    elapsed,
    progress,
    estimatedDurationMs: phase === 'snowing' ? undefined : duration,
    overdue,
    seed,
    dimensions,
  })
}

export function snowmanLoad(cells: readonly SnowCell[]) {
  return cells.filter((cell) => cell.owner === 'snowman').length
}

export function resolvedCells(simulation: SnowmanSimulation) {
  return simulation.cells.map((cell) => {
    const ball =
      cell.owner === 'body' ? simulation.body : cell.owner === 'head' ? simulation.head : undefined
    const resolved =
      ball && cell.localX !== undefined && cell.localY !== undefined
        ? { ...cell, x: ball.x + cell.localX, y: ball.y + cell.localY }
        : cell
    return simulation.toppling && resolved.owner !== 'ground'
      ? rotateAround(resolved, simulation.toppling)
      : resolved
  })
}

export function resolvedBallCenter(simulation: SnowmanSimulation, ball: Snowball) {
  return simulation.toppling ? rotateAround(ball, simulation.toppling) : ball
}

function step(
  simulation: SnowmanSimulation,
  elapsed: number,
  progress: number,
  estimatedDurationMs: number | undefined,
  overdue: boolean,
  seed: number,
  dimensions: SnowmanDimensions,
) {
  const phase = snowmanScenePhase(progress, estimatedDurationMs, overdue)
  const interval = snowmanSpawnInterval(estimatedDurationMs, dimensions, overdue)
  while (elapsed >= simulation.nextAt) {
    simulation.flakes.push({
      id: simulation.id++,
      x: random(seed + simulation.id * 17) * simulation.grid.columns,
      y: -1 - random(seed + simulation.id * 23) * 6,
      bornAt: simulation.nextAt,
    })
    simulation.nextAt += interval
  }

  updateBalls(simulation, progress, estimatedDurationMs, overdue)
  const occupied = occupiedCells(simulation)
  const wind = snowmanWind(seed, elapsed) * (STEP_MS / 1_000)
  const nextFlakes: AirborneFlake[] = []
  for (const flake of simulation.flakes) {
    const moved = { ...flake, x: flake.x + wind, y: flake.y + 0.52 }
    const ball = hitBall(simulation, moved)
    if (ball) {
      joinBall(simulation, ball, flake.id, moved.x - ball.x, moved.y - ball.y)
      continue
    }
    const resting = findRestingCell(moved, occupied, simulation.grid, wind, seed)
    if (!resting) {
      nextFlakes.push({ ...moved, x: clamp(moved.x, 0, simulation.grid.columns - 1) })
      continue
    }
    const belowOwner = occupied.get(key(resting.x, resting.y + 1))
    simulation.cells.push({
      id: flake.id,
      x: resting.x,
      y: resting.y,
      owner:
        belowOwner === 'body' || belowOwner === 'head' || belowOwner === 'snowman'
          ? 'snowman'
          : 'ground',
    })
    occupied.set(key(resting.x, resting.y), simulation.cells.at(-1)?.owner ?? 'ground')
  }
  simulation.flakes = nextFlakes
  if (estimatedDurationMs !== undefined && phase !== 'drift' && phase !== 'snowing')
    collectTouchedGround(simulation)
  compactBallCells(simulation)
  // A small cascade closes a swept gap promptly without making the whole bank flow at once.
  relaxSettledSnow(simulation, seed, elapsed)
  relaxSettledSnow(simulation, seed, elapsed + STEP_MS / 2)
  if (
    overdue &&
    !simulation.toppling &&
    !simulation.toppled &&
    snowmanLoad(simulation.cells) >= SNOWMAN_TOPPLE_LOAD
  )
    beginTopple(simulation, elapsed)
  advanceTopple(simulation, elapsed)
  return simulation
}

function updateBalls(
  simulation: SnowmanSimulation,
  progress: number,
  estimatedDurationMs: number | undefined,
  overdue: boolean,
) {
  if (estimatedDurationMs === undefined) return
  const { columns, rows } = simulation.grid
  const bodyAmount =
    overdue || progress >= BODY_DONE
      ? 1
      : clamp((progress - ASSEMBLY_START) / (BODY_DONE - ASSEMBLY_START), 0, 1)
  if (bodyAmount > 0 && !simulation.body)
    simulation.body = {
      kind: 'body',
      x: columns * 0.14,
      y: rows * 0.72,
      radius: 2,
      angle: 0,
      locked: false,
    }
  if (simulation.body) {
    simulation.body.radius = ballRadius(simulation, 'body', 2)
    if (!simulation.body.locked) {
      const x = columns * (0.14 + 0.38 * bodyAmount)
      const y = restingBallY(simulation, x, simulation.body.radius, rows * 0.82)
      rollBallTo(simulation, simulation.body, x, y)
      simulation.body.locked = bodyAmount === 1
    }
  }
  const headAmount =
    overdue || progress >= HAT_AT ? 1 : clamp((progress - BODY_DONE) / (HAT_AT - BODY_DONE), 0, 1)
  if (headAmount > 0 && !simulation.head)
    simulation.head = {
      kind: 'head',
      x: columns * 0.88,
      y: rows * 0.72,
      radius: 2,
      angle: 0,
      locked: false,
    }
  if (simulation.head && simulation.body) {
    simulation.head.radius = ballRadius(simulation, 'head', 1.7)
    if (!simulation.head.locked) {
      const rolling = clamp(headAmount / 0.68, 0, 1)
      const groundX = columns * (0.88 - 0.3 * rolling)
      const groundY = restingBallY(simulation, groundX, simulation.head.radius, rows * 0.82)
      const seatX = simulation.body.x
      const seatY = simulation.body.y - simulation.body.radius - simulation.head.radius + 0.5
      const climb = clamp((headAmount - 0.68) / 0.32, 0, 1)
      rollBallTo(
        simulation,
        simulation.head,
        groundX + (seatX - groundX) * climb,
        groundY + (seatY - groundY) * climb,
      )
      simulation.head.locked = headAmount === 1
    }
  }
}

function rollBallTo(simulation: SnowmanSimulation, ball: Snowball, x: number, y: number) {
  const dx = x - ball.x
  const rotation = dx / Math.max(ball.radius, 1)
  if (rotation !== 0) {
    const cosine = Math.cos(rotation)
    const sine = Math.sin(rotation)
    for (const cell of simulation.cells) {
      if (cell.owner !== ball.kind || cell.localX === undefined || cell.localY === undefined)
        continue
      const localX = cell.localX
      cell.localX = localX * cosine - cell.localY * sine
      cell.localY = localX * sine + cell.localY * cosine
      if (cell.targetLocalX !== undefined && cell.targetLocalY !== undefined) {
        const targetLocalX = cell.targetLocalX
        cell.targetLocalX = targetLocalX * cosine - cell.targetLocalY * sine
        cell.targetLocalY = targetLocalX * sine + cell.targetLocalY * cosine
      }
    }
    ball.angle += rotation
  }
  ball.x = x
  // Support cells are discrete and can reconfigure in one tick. The rolling core follows that
  // surface continuously instead of teleporting a whole ball by a cell height.
  ball.y = moveToward(ball.y, y, 0.16)
}

function collectTouchedGround(simulation: SnowmanSimulation) {
  const resolved = resolvedCells(simulation)
  const originals = new Map(simulation.cells.map((cell) => [cell.id, cell]))
  const groundCoordinates = new Set(
    resolved
      .filter((cell) => cell.owner === 'ground')
      .map((cell) => key(Math.round(cell.x), Math.round(cell.y))),
  )
  const exposedGround = new Set(
    resolved
      .filter((cell) => cell.owner === 'ground')
      .filter((cell) => !groundCoordinates.has(key(Math.round(cell.x), Math.round(cell.y) - 1)))
      .map((cell) => cell.id),
  )
  for (const ball of [simulation.body, simulation.head]) {
    if (!ball || ball.locked) continue
    const owner = ball.kind
    const captureRadius = ball.radius + 0.75
    for (const cell of resolved) {
      if (cell.owner !== 'ground') continue
      const dx = cell.x - ball.x
      const dy = cell.y - ball.y
      const distance = Math.hypot(dx, dy)
      // The roller takes only exposed grains on its lower, leading contact arc. Capturing buried
      // cells makes the ball appear to hook loose snow into the air behind it.
      if (
        !exposedGround.has(cell.id) ||
        distance > captureRadius ||
        distance < Math.max(1, ball.radius - 0.85) ||
        dy < -ball.radius * 0.1
      )
        continue
      const original = originals.get(cell.id)
      if (!original) continue
      joinBall(simulation, ball, original.id, dx, dy)
    }
    ball.radius = ballRadius(simulation, owner, ball.kind === 'body' ? 2 : 1.7)
  }
}

function hitBall(simulation: SnowmanSimulation, flake: AirborneFlake) {
  const candidates = [simulation.body, simulation.head].filter(
    (ball): ball is Snowball => ball !== undefined,
  )
  return candidates.find((ball) => Math.hypot(flake.x - ball.x, flake.y - ball.y) <= ball.radius)
}

function joinBall(
  simulation: SnowmanSimulation,
  ball: Snowball,
  id: number,
  localX: number,
  localY: number,
) {
  const cell = simulation.cells.find((candidate) => candidate.id === id)
  const target = ballInteriorSlot(simulation, ball, id)
  const start = openBallPosition(simulation, ball, localX, localY, id)
  const next = {
    id,
    x: ball.x + start.x,
    y: ball.y + start.y,
    owner: ball.kind,
    localX: start.x,
    localY: start.y,
    targetLocalX: target.x,
    targetLocalY: target.y,
  }
  if (cell) Object.assign(cell, next)
  else simulation.cells.push(next)
}

function openBallPosition(
  simulation: SnowmanSimulation,
  ball: Snowball,
  localX: number,
  localY: number,
  id: number,
) {
  const occupied = new Set(
    simulation.cells
      .filter((cell) => cell.id !== id && cell.owner === ball.kind)
      .map((cell) => key(Math.round(cell.localX ?? 0), Math.round(cell.localY ?? 0))),
  )
  const x = Math.round(localX)
  const y = Math.round(localY)
  if (!occupied.has(key(x, y))) return { x, y }
  for (let radius = 1; radius <= Math.ceil(ball.radius); radius += 1)
    for (let offsetX = -radius; offsetX <= radius; offsetX += 1)
      for (let offsetY = -radius; offsetY <= radius; offsetY += 1) {
        const candidateX = x + offsetX
        const candidateY = y + offsetY
        if (
          Math.hypot(candidateX, candidateY) <= ball.radius + 0.3 &&
          !occupied.has(key(candidateX, candidateY))
        )
          return { x: candidateX, y: candidateY }
      }
  return { x, y }
}

function ballInteriorSlot(simulation: SnowmanSimulation, ball: Snowball, id: number) {
  const occupied = new Set(
    simulation.cells
      .filter((cell) => cell.owner === ball.kind && cell.targetLocalX !== undefined)
      .map((cell) => key(Math.round(cell.targetLocalX ?? 0), Math.round(cell.targetLocalY ?? 0))),
  )
  for (let attempt = 0; attempt < 48; attempt += 1) {
    const angle = random(id * 31 + attempt * 17) * Math.PI * 2
    const distance = Math.sqrt(random(id * 37 + attempt * 19)) * Math.max(0.8, ball.radius - 0.45)
    const x = Math.round(Math.cos(angle) * distance)
    const y = Math.round(Math.sin(angle) * distance)
    if (!occupied.has(key(x, y))) return { x, y }
  }
  return { x: 0, y: 0 }
}

function compactBallCells(simulation: SnowmanSimulation) {
  for (const ball of [simulation.body, simulation.head]) {
    if (!ball) continue
    const cells = simulation.cells.filter(
      (cell) =>
        cell.owner === ball.kind &&
        cell.localX !== undefined &&
        cell.localY !== undefined &&
        cell.targetLocalX !== undefined &&
        cell.targetLocalY !== undefined,
    )
    const occupied = new Map<string, SnowCell>()
    for (const cell of cells) {
      const start = openBallPosition(simulation, ball, cell.localX ?? 0, cell.localY ?? 0, cell.id)
      cell.localX = start.x
      cell.localY = start.y
      occupied.set(key(start.x, start.y), cell)
    }
    for (const cell of cells) {
      const currentX = Math.round(cell.localX ?? 0)
      const currentY = Math.round(cell.localY ?? 0)
      const targetX = Math.round(cell.targetLocalX ?? 0)
      const targetY = Math.round(cell.targetLocalY ?? 0)
      const horizontal = Math.sign(targetX - currentX)
      const vertical = Math.sign(targetY - currentY)
      const moves: [number, number][] =
        Math.abs(targetX - currentX) >= Math.abs(targetY - currentY)
          ? [
              [horizontal, 0],
              [0, vertical],
              [horizontal, vertical],
            ]
          : [
              [0, vertical],
              [horizontal, 0],
              [horizontal, vertical],
            ]
      for (const [x, y] of moves) {
        if (x === 0 && y === 0) continue
        if (shiftBallCell(cell, x, y, occupied, ball, new Set())) break
      }
    }
  }
}

function shiftBallCell(
  cell: SnowCell,
  dx: number,
  dy: number,
  occupied: Map<string, SnowCell>,
  ball: Snowball,
  seen: Set<number>,
): boolean {
  if (seen.has(cell.id)) return false
  seen.add(cell.id)
  const fromX = Math.round(cell.localX ?? 0)
  const fromY = Math.round(cell.localY ?? 0)
  const toX = fromX + dx
  const toY = fromY + dy
  if (Math.hypot(toX, toY) > ball.radius + 0.3) return false
  const blocker = occupied.get(key(toX, toY))
  if (blocker && blocker !== cell && !shiftBallCell(blocker, dx, dy, occupied, ball, seen))
    return false
  occupied.delete(key(fromX, fromY))
  cell.localX = toX
  cell.localY = toY
  occupied.set(key(toX, toY), cell)
  return true
}

function occupiedCells(simulation: SnowmanSimulation) {
  const occupied = new Map<string, SnowCellOwner>()
  for (const cell of resolvedCells(simulation))
    occupied.set(key(Math.round(cell.x), Math.round(cell.y)), cell.owner)
  return occupied
}

/** Lets a settled bank creep into a newly cleared trench instead of preserving impossible voids. */
function relaxSettledSnow(simulation: SnowmanSimulation, seed: number, elapsed: number) {
  const occupied = occupiedCells(simulation)
  const ground = simulation.cells
    .filter((cell) => cell.owner === 'ground')
    .sort((first, second) => second.y - first.y || first.x - second.x)
  for (const cell of ground) {
    const below = key(cell.x, cell.y + 1)
    if (cell.y < simulation.grid.rows - 1 && !occupied.has(below)) {
      occupied.delete(key(cell.x, cell.y))
      cell.y += 1
      occupied.set(key(cell.x, cell.y), cell.owner)
      continue
    }
    const preferred = random(seed + cell.id * 29 + elapsed) < 0.5 ? -1 : 1
    for (const direction of [preferred, -preferred]) {
      const x = cell.x + direction
      if (
        x < 0 ||
        x >= simulation.grid.columns ||
        cell.y >= simulation.grid.rows - 1 ||
        occupied.has(key(x, cell.y)) ||
        occupied.has(key(x, cell.y + 1))
      )
        continue
      occupied.delete(key(cell.x, cell.y))
      cell.x = x
      cell.y += 1
      occupied.set(key(cell.x, cell.y), cell.owner)
      break
    }
  }
}

function findRestingCell(
  flake: AirborneFlake,
  occupied: Map<string, SnowCellOwner>,
  grid: SnowmanSimulation['grid'],
  wind: number,
  seed: number,
) {
  const x = Math.round(flake.x)
  const y = Math.round(flake.y)
  if (y < 0) return undefined
  if (y >= grid.rows - 1) return { x, y: grid.rows - 1 }
  if (!occupied.has(key(x, y + 1))) return undefined
  const preferred = wind >= 0 ? 1 : -1
  const alternate = random(seed + flake.id * 71 + y) > 0.5 ? preferred : -preferred
  for (const offset of [alternate, -alternate]) {
    const side = x + offset
    if (
      side >= 0 &&
      side < grid.columns &&
      !occupied.has(key(side, y + 1)) &&
      !occupied.has(key(side, y))
    )
      return { x: side, y: y + 1 }
  }
  return occupied.has(key(x, y)) ? { x, y: Math.max(0, y - 1) } : { x, y }
}

function restingBallY(simulation: SnowmanSimulation, x: number, radius: number, fallback: number) {
  const cells = resolvedCells(simulation).filter(
    (cell) => cell.owner === 'ground' && Math.abs(cell.x - x) <= radius,
  )
  const surface = cells.length ? Math.min(...cells.map((cell) => cell.y)) : fallback
  return surface - radius
}
function ballRadius(simulation: SnowmanSimulation, owner: 'body' | 'head', minimum: number) {
  const count = simulation.cells.filter((cell) => cell.owner === owner).length
  return minimum + Math.sqrt(count / Math.PI) * 0.45
}
function beginTopple(simulation: SnowmanSimulation, elapsed: number) {
  const body = simulation.body
  if (!body) return
  simulation.toppling = {
    startedAt: elapsed,
    angle: 0,
    pivotX: body.x,
    pivotY: body.y + body.radius * 0.72,
  }
}

function advanceTopple(simulation: SnowmanSimulation, elapsed: number) {
  const toppling = simulation.toppling
  if (!toppling) return
  const progress = clamp((elapsed - toppling.startedAt) / 750, 0, 1)
  // Ease-in keeps the initial loss of balance readable; ease-out lets the body settle rather than snap.
  toppling.angle = (1 - (1 - progress) ** 3) * (Math.PI / 2)
  if (progress === 1) simulation.toppled = true
}

function rotateAround<T extends { x: number; y: number }>(
  point: T,
  toppling: NonNullable<SnowmanSimulation['toppling']>,
) {
  const cosine = Math.cos(toppling.angle)
  const sine = Math.sin(toppling.angle)
  const x = point.x - toppling.pivotX
  const y = point.y - toppling.pivotY
  return {
    ...point,
    x: toppling.pivotX + x * cosine - y * sine,
    y: toppling.pivotY + x * sine + y * cosine,
  }
}
function clone(simulation: SnowmanSimulation): SnowmanSimulation {
  return {
    ...simulation,
    grid: { ...simulation.grid },
    flakes: simulation.flakes.map((flake) => ({ ...flake })),
    cells: simulation.cells.map((cell) => ({ ...cell })),
    body: simulation.body && { ...simulation.body },
    head: simulation.head && { ...simulation.head },
    toppling: simulation.toppling && { ...simulation.toppling },
  }
}
function key(x: number, y: number) {
  return `${x}:${y}`
}
function clamp(value: number, low: number, high: number) {
  return Math.max(low, Math.min(high, value))
}
function moveToward(current: number, target: number, maximumStep: number) {
  if (Math.abs(target - current) <= maximumStep) return target
  return current + Math.sign(target - current) * maximumStep
}
function random(value: number) {
  const sine = Math.sin(value * 12.9898) * 43758.5453
  return sine - Math.floor(sine)
}

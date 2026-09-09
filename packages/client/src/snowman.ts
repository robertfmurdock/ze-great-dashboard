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
  packed?: boolean
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
  /** The final support position captured when the body locks. */
  supportY?: number
  launch?: { x: number; y: number }
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
  hat?: { x: number; y: number; angle: number }
}

export { snowmanSchedule } from './snowman-timing.ts'

import {
  scheduleAmount as amount,
  smoothScheduleAmount as ease,
  snowmanSchedule,
} from './snowman-timing.ts'

const STEP_MS = 25
const ASSEMBLY_START = 0.5
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
  if (snowmanSchedule(estimatedDurationMs).mode === 'snowfall') return 'snowing'
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
  elapsed = 0,
) {
  if (estimatedDurationMs === undefined) return overdue ? 30 : 60
  const ordinary = (estimatedDurationMs * HAT_AT) / snowmanMaterialCount(dimensions)
  if (overdue) return ordinary / 2
  const schedule = snowmanSchedule(estimatedDurationMs)
  if (schedule.mode !== 'snowfall' && elapsed >= Math.max(0, schedule.bodyStart - 500)) {
    return ordinary * 4
  }
  return ordinary
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
  for (let time = simulation.lastElapsed + STEP_MS; time <= targetElapsed; time += STEP_MS) {
    simulation = step(
      simulation,
      time,
      estimatedDurationMs === undefined ? progress : time / estimatedDurationMs,
      estimatedDurationMs,
      overdue && (estimatedDurationMs === undefined || time >= estimatedDurationMs),
      seed,
      dimensions,
    )
    simulation.lastElapsed = time
  }
  return simulation
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
        ? {
            ...cell,
            x: ball.x + cell.localX * Math.cos(ball.angle) - cell.localY * Math.sin(ball.angle),
            y: ball.y + cell.localX * Math.sin(ball.angle) + cell.localY * Math.cos(ball.angle),
          }
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
  const interval = snowmanSpawnInterval(estimatedDurationMs, dimensions, overdue, elapsed)
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
  const fall =
    estimatedDurationMs === undefined
      ? 0.52
      : Math.max(0.52, ((simulation.grid.rows + 7) * STEP_MS) / (estimatedDurationMs * 0.25))
  const nextFlakes: AirborneFlake[] = []
  for (const flake of simulation.flakes) {
    const moved = { ...flake, x: flake.x + wind, y: flake.y + fall }
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
  const body = simulation.body
  if (body?.locked) {
    body.supportY ??= restingBallY(simulation, body.x, body.radius, body.y + body.radius)
    body.y = body.supportY
  }
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
  _overdue: boolean,
) {
  if (estimatedDurationMs === undefined) return
  const schedule = snowmanSchedule(estimatedDurationMs)
  if (schedule.mode === 'snowfall') return
  const time = progress * estimatedDurationMs
  const { columns, rows } = simulation.grid
  const bodyAmount = ease(amount(time, schedule.bodyStart, schedule.bodyEnd))
  if (time >= schedule.bodyStart && !simulation.body) {
    const x = columns * 0.14
    simulation.body = {
      kind: 'body',
      x,
      y: restingBallY(simulation, x, 2, rows - 1),
      radius: 2,
      angle: 0,
      locked: false,
    }
  }
  const body = simulation.body
  if (body && !body.locked) {
    body.radius = Math.max(body.radius, ballRadius(simulation, 'body', 2))
    const x = columns * (0.14 + 0.38 * bodyAmount)
    rollBallTo(body, x, restingBallY(simulation, x, body.radius, rows - 1))
    body.locked = time >= schedule.bodyEnd
  }
  if (time >= schedule.headStart && !simulation.head) {
    const x = columns * (schedule.mode === 'full' ? 0.88 : 0.66)
    simulation.head = {
      kind: 'head',
      x,
      y: restingBallY(simulation, x, 1.7, rows - 1),
      radius: 1.7,
      angle: 0,
      locked: false,
    }
    collectTouchedGround(simulation)
  }
  const head = simulation.head
  if (head && body && !head.locked) {
    head.radius = Math.max(head.radius, ballRadius(simulation, 'head', 1.7))
    if (time < schedule.hopStart) {
      const rolling = ease(amount(time, schedule.headStart, schedule.hopStart))
      const x = columns * (0.88 - 0.22 * rolling)
      rollBallTo(head, x, restingBallY(simulation, x, head.radius, rows - 1))
    } else {
      head.launch ??= { x: head.x, y: head.y }
      const hop = amount(time, schedule.hopStart, schedule.land)
      const seatY = body.y - body.radius - head.radius + 0.5
      head.x = head.launch.x + (body.x - head.launch.x) * ease(hop)
      head.y =
        head.launch.y +
        (seatY - head.launch.y) * ease(hop) -
        Math.sin(Math.PI * hop) * Math.max(5, body.radius * 1.5)
      if (time >= schedule.land) {
        const settle = amount(time, schedule.land, schedule.settleEnd)
        head.y += Math.sin(Math.PI * settle) * 0.45
      }
      head.locked = time >= schedule.settleEnd
    }
  }
  if (head && time >= schedule.land) {
    const drop = amount(time, schedule.land, schedule.end)
    simulation.hat = {
      x: head.x,
      y: head.y - head.radius - 1 - 5 * (1 - drop * drop),
      angle: (1 - ease(drop)) * -0.22,
    }
  }
}

function rollBallTo(ball: Snowball, x: number, y: number) {
  const nextY = moveToward(ball.y, y, 0.16)
  const dx = x - ball.x
  ball.angle += (Math.sign(dx) * Math.hypot(dx, nextY - ball.y)) / Math.max(ball.radius, 1)
  ball.x = x
  ball.y = nextY
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
      if (!canCollect(simulation, ball)) break
      if (cell.owner !== 'ground') continue
      const dx = cell.x - ball.x
      const dy = cell.y - ball.y
      const distance = Math.hypot(dx, dy)
      // The roller takes only exposed grains on its lower, leading contact arc. Capturing buried
      // cells makes the ball appear to hook loose snow into the air behind it.
      if (!exposedGround.has(cell.id) || distance > captureRadius || dy < -ball.radius * 0.2)
        continue
      const original = originals.get(cell.id)
      if (!original) continue
      joinBall(simulation, ball, original.id, dx, dy)
    }
    ball.radius = Math.max(
      ball.radius,
      ballRadius(simulation, owner, ball.kind === 'body' ? 2 : 1.7),
    )
  }
}

function canCollect(simulation: SnowmanSimulation, ball: Snowball) {
  if (ball.kind === 'body' || !simulation.body) return true
  const bodyRadius = simulation.body.radius
  const targetHeadRadius = bodyRadius * 0.72
  const maxHeadCount = Math.max(
    12,
    Math.round(Math.PI * (Math.max(0, targetHeadRadius - 1.7) / 0.6) ** 2),
  )
  return simulation.cells.filter((cell) => cell.owner === 'head').length < maxHeadCount
}

function hitBall(simulation: SnowmanSimulation, flake: AirborneFlake) {
  const candidates = [simulation.body, simulation.head].filter(
    (ball): ball is Snowball => ball !== undefined && !ball.locked,
  )
  return candidates.find(
    (ball) =>
      canCollect(simulation, ball) && Math.hypot(flake.x - ball.x, flake.y - ball.y) <= ball.radius,
  )
}

function joinBall(
  simulation: SnowmanSimulation,
  ball: Snowball,
  id: number,
  localX: number,
  localY: number,
) {
  const cosine = Math.cos(-ball.angle)
  const sine = Math.sin(-ball.angle)
  const rotatedX = localX * cosine - localY * sine
  localY = localX * sine + localY * cosine
  localX = rotatedX
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
  ball.radius = Math.max(
    ball.radius,
    ballRadius(simulation, ball.kind, ball.kind === 'body' ? 2 : 1.7),
  )
  rebalanceBallTargets(simulation, ball)
}

function openBallPosition(
  simulation: SnowmanSimulation,
  ball: Snowball,
  localX: number,
  localY: number,
  id: number,
) {
  const cells = simulation.cells.filter((cell) => cell.id !== id && cell.owner === ball.kind)
  const free = (x: number, y: number) =>
    cells.every((cell) => Math.hypot((cell.localX ?? 0) - x, (cell.localY ?? 0) - y) >= 0.75)
  if (free(localX, localY)) return { x: localX, y: localY }
  // Search outward from the contact, retaining already packed grains in their material frame.
  for (let radius = 0.75; ; radius += 0.75) {
    for (let i = 0; i < 32; i++) {
      const angle = (i * Math.PI) / 16
      const x = localX + Math.cos(angle) * radius
      const y = localY + Math.sin(angle) * radius
      if ((Math.hypot(x, y) <= ball.radius + 0.75 || radius > ball.radius * 2) && free(x, y)) {
        ball.radius = Math.max(ball.radius, Math.hypot(x, y) - 0.5)
        return { x, y }
      }
    }
  }
}

function ballInteriorSlot(simulation: SnowmanSimulation, ball: Snowball, id: number) {
  const existing = simulation.cells.filter(
    (cell) =>
      cell.owner === ball.kind &&
      cell.targetLocalX !== undefined &&
      cell.targetLocalY !== undefined,
  )
  const free = (x: number, y: number, minDistance = 0.72) =>
    existing.every(
      (cell) =>
        Math.hypot((cell.targetLocalX ?? 0) - x, (cell.targetLocalY ?? 0) - y) >= minDistance,
    )
  for (let attempt = 0; attempt < 64; attempt += 1) {
    const angle = random(id * 31 + attempt * 17) * Math.PI * 2
    const distance = Math.sqrt(random(id * 37 + attempt * 19)) * Math.max(0.4, ball.radius - 0.35)
    const x = Math.cos(angle) * distance
    const y = Math.sin(angle) * distance
    if (free(x, y)) return { x, y }
  }
  for (let radius = 0.4; radius <= ball.radius - 0.35; radius += 0.5) {
    const steps = Math.max(6, Math.round((2 * Math.PI * radius) / 0.72))
    for (let i = 0; i < steps; i++) {
      const angle = (i * Math.PI * 2) / steps + random(id * 13)
      const x = Math.cos(angle) * radius
      const y = Math.sin(angle) * radius
      if (free(x, y, 0.6)) return { x, y }
    }
  }
  return { x: 0, y: 0 }
}

function compactBallCells(simulation: SnowmanSimulation) {
  for (const cell of simulation.cells) {
    if (
      cell.packed ||
      cell.localX === undefined ||
      cell.localY === undefined ||
      cell.targetLocalX === undefined ||
      cell.targetLocalY === undefined
    )
      continue
    const x = moveToward(cell.localX, cell.targetLocalX, 0.25)
    const y = moveToward(cell.localY, cell.targetLocalY, 0.25)
    cell.localX = x
    cell.localY = y
    cell.packed = x === cell.targetLocalX && y === cell.targetLocalY
  }
}

/** Reassigns the material to a dense lattice so newly collected snow compresses older grains. */
function rebalanceBallTargets(simulation: SnowmanSimulation, ball: Snowball) {
  const cells = simulation.cells.filter(
    (cell) => cell.owner === ball.kind && cell.localX !== undefined && cell.localY !== undefined,
  )
  const slots = denseBallSlots(ball.radius, cells.length)
  cells.sort((first, second) => first.id - second.id)
  for (const [index, cell] of cells.entries()) {
    const slot = slots[index]
    if (!slot) break
    cell.targetLocalX = slot.x
    cell.targetLocalY = slot.y
    cell.packed = false
  }
}

function denseBallSlots(radius: number, count: number) {
  const boundary = Math.max(0.2, radius - 0.1)
  const candidates: Array<{ x: number; y: number }> = []
  const spacing = 0.9
  const vertical = (spacing * Math.sqrt(3)) / 2
  for (let row = -Math.ceil(boundary / vertical); row <= Math.ceil(boundary / vertical); row += 1) {
    const y = row * vertical
    const offset = (row & 1) === 0 ? 0 : spacing / 2
    for (
      let column = -Math.ceil(boundary / spacing);
      column <= Math.ceil(boundary / spacing);
      column += 1
    ) {
      const x = column * spacing + offset
      if (Math.hypot(x, y) <= boundary) candidates.push({ x, y })
    }
  }
  candidates.sort((first, second) => Math.hypot(first.x, first.y) - Math.hypot(second.x, second.y))
  const slots: Array<{ x: number; y: number }> = []
  for (const candidate of candidates) {
    if (slots.every((slot) => Math.hypot(slot.x - candidate.x, slot.y - candidate.y) >= 0.82))
      slots.push(candidate)
    if (slots.length === count) break
  }
  return slots
}

export function resolvedHat(simulation: SnowmanSimulation) {
  if (!simulation.hat) return undefined
  return simulation.toppling
    ? {
        ...rotateAround(simulation.hat, simulation.toppling),
        angle: simulation.hat.angle + simulation.toppling.angle,
      }
    : simulation.hat
}

/** Interpolate presentation only; particle identities and physics remain on the fixed clock. */
export function interpolateSnowman(
  previous: SnowmanSimulation,
  next: SnowmanSimulation,
  fraction: number,
) {
  const scene = clone(next)
  const mix = (a: number, b: number) => a + (b - a) * clamp(fraction, 0, 1)
  for (const kind of ['body', 'head'] as const) {
    const a = previous[kind],
      b = scene[kind]
    if (a && b) {
      b.x = mix(a.x, b.x)
      b.y = mix(a.y, b.y)
      b.angle = mix(a.angle, b.angle)
    }
  }
  const oldFlakes = new Map(previous.flakes.map((flake) => [flake.id, flake]))
  for (const flake of scene.flakes) {
    const old = oldFlakes.get(flake.id)
    if (old) {
      flake.x = mix(old.x, flake.x)
      flake.y = mix(old.y, flake.y)
    }
  }
  if (scene.toppling && previous.toppling)
    scene.toppling.angle = mix(previous.toppling.angle, scene.toppling.angle)
  if (scene.hat && previous.hat)
    scene.hat = {
      x: mix(previous.hat.x, scene.hat.x),
      y: mix(previous.hat.y, scene.hat.y),
      angle: mix(previous.hat.angle, scene.hat.angle),
    }
  return scene
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
  return minimum + Math.sqrt(count / Math.PI) * 0.5
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
    hat: simulation.hat && { ...simulation.hat },
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

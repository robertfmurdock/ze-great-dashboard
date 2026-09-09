import { describe, expect, it } from 'vitest'
import {
  advanceSnowmanSimulation,
  createSnowmanSimulation,
  interpolateSnowman,
  resolvedBallCenter,
  resolvedCells,
  resolvedHat,
  SNOWMAN_TOPPLE_LOAD,
  snowmanLoad,
  snowmanScenePhase,
  snowmanSchedule,
  snowmanSpawnInterval,
  snowmanWind,
} from '../src/snowman.ts'

const dimensions = { width: 360, height: 180 }
const estimated = { estimatedDurationMs: 10_000, seed: 7, dimensions }

function advanceTo(elapsed: number, progress: number, overdue = false) {
  return advanceSnowmanSimulation(createSnowmanSimulation(dimensions), {
    elapsed,
    progress,
    overdue,
    ...estimated,
  })
}

describe('snowman simulation', () => {
  it('keeps a stable breeze and deterministic intermittent gusts for every seed', () => {
    expect(Math.abs(snowmanWind(7, 2_000))).toBeGreaterThan(0.2)
    expect(snowmanWind(7, 2_000)).toBe(snowmanWind(7, 2_000))
    expect(Math.abs(snowmanWind(7, 0) - snowmanWind(7, 2_400))).toBeGreaterThan(0.3)
  })

  it('packs flakes against existing snow instead of stacking only in their landing column', () => {
    const scene = advanceTo(4_000, 0.4)
    const ground = resolvedCells(scene).filter((cell) => cell.owner === 'ground')
    expect(ground.length).toBeGreaterThan(100)
    expect(new Set(ground.map((cell) => cell.x)).size).toBeGreaterThan(20)
    expect(
      ground.some((cell) =>
        ground.some((other) => other.y === cell.y + 1 && Math.abs(other.x - cell.x) === 1),
      ),
    ).toBe(true)
  })

  it('lets settled snow creep into a newly cleared gap', () => {
    const scene = createSnowmanSimulation(dimensions)
    scene.cells = [
      { id: 1, x: 20, y: 44, owner: 'ground' },
      { id: 2, x: 21, y: 43, owner: 'ground' },
    ]
    const relaxed = advanceSnowmanSimulation(scene, {
      elapsed: 25,
      progress: 0.4,
      overdue: false,
      ...estimated,
    })
    expect(relaxed.cells.find((cell) => cell.id === 2)).toMatchObject({ x: 21, y: 44 })
  })

  it('rolls a growing body ball through contacted terrain without relocating flakes to a final silhouette', () => {
    const first = advanceTo(5_800, 0.58)
    const later = advanceSnowmanSimulation(first, {
      elapsed: 6_600,
      progress: 0.66,
      overdue: false,
      ...estimated,
    })
    expect(first.body).toBeDefined()
    expect(later.body?.x).toBeGreaterThan(first.body?.x ?? 0)
    expect(later.body?.radius).toBeGreaterThanOrEqual(first.body?.radius ?? 0)
    expect(later.body?.angle).not.toBe(first.body?.angle)
    const bodyCells = resolvedCells(later).filter((cell) => cell.owner === 'body')
    expect(bodyCells.length).toBeGreaterThan(0)
    expect(new Set(bodyCells.map((cell) => `${cell.x}:${cell.y}`)).size).toBe(bodyCells.length)
    expect(
      bodyCells.every(
        (cell) =>
          Math.hypot(cell.x - (later.body?.x ?? 0), cell.y - (later.body?.y ?? 0)) <=
          (later.body?.radius ?? 0) + 1,
      ),
    ).toBe(true)
  })

  it('approaches changing support height without jumping the rolling core', () => {
    const rolling = advanceTo(5_800, 0.58)
    const next = advanceSnowmanSimulation(rolling, {
      elapsed: 5_825,
      progress: 0.58,
      overdue: false,
      ...estimated,
    })
    expect(Math.abs((next.body?.y ?? 0) - (rolling.body?.y ?? 0))).toBeLessThanOrEqual(0.16)
  })

  it('compacts contact grains inward and lets falling flakes join the ball', () => {
    const scene = createSnowmanSimulation(dimensions)
    scene.nextAt = Number.POSITIVE_INFINITY
    scene.body = { kind: 'body', x: 30, y: 25, radius: 5, angle: 0, locked: false }
    scene.flakes = [{ id: 99, x: 30, y: 23, bornAt: 0 }]
    const joined = advanceSnowmanSimulation(scene, {
      elapsed: 25,
      progress: 1,
      overdue: false,
      ...estimated,
      estimatedDurationMs: undefined,
    })
    const first = joined.cells.find((cell) => cell.id === 99)
    expect(first?.owner).toBe('body')
    expect(first?.targetLocalX).toBeDefined()
    const compacted = advanceSnowmanSimulation(joined, {
      elapsed: 50,
      progress: 1,
      overdue: false,
      ...estimated,
      estimatedDurationMs: undefined,
    }).cells.find((cell) => cell.id === 99)
    expect(
      Math.hypot(
        (compacted?.localX ?? 0) - (compacted?.targetLocalX ?? 0),
        (compacted?.localY ?? 0) - (compacted?.targetLocalY ?? 0),
      ),
    ).toBeLessThan(
      Math.hypot(
        (first?.localX ?? 0) - (first?.targetLocalX ?? 0),
        (first?.localY ?? 0) - (first?.targetLocalY ?? 0),
      ),
    )
  })

  it('rolls and then hops the head ball onto the body', () => {
    const rolling = advanceTo(8_100, 0.81)
    const seated = advanceSnowmanSimulation(rolling, {
      elapsed: 9_400,
      progress: 0.94,
      overdue: false,
      ...estimated,
    })
    expect(rolling.head).toBeDefined()
    expect(seated.head?.y).toBeLessThan(rolling.head?.y ?? Number.POSITIVE_INFINITY)
    expect(Math.abs((seated.head?.x ?? 0) - (seated.body?.x ?? 0))).toBeLessThan(1)
  })

  it('anchors the completed figure while nearby settled snow continues to relax', () => {
    const complete = advanceTo(9_600, 0.96)
    const later = advanceSnowmanSimulation(complete, {
      elapsed: 10_600,
      progress: 1,
      overdue: false,
      ...estimated,
    })
    expect(complete.body?.locked).toBe(true)
    expect(complete.head?.locked).toBe(true)
    expect(later.body).toMatchObject({ x: complete.body?.x, y: complete.body?.y })
    expect(later.head).toMatchObject({ x: complete.head?.x, y: complete.head?.y })
  })

  it('scales dense snowfall with measured area, preserves milestones, and doubles overdue cadence', () => {
    expect(snowmanSpawnInterval(10_000, { width: 720, height: 360 })).toBeLessThan(
      snowmanSpawnInterval(10_000, { width: 180, height: 90 }),
    )
    expect(snowmanScenePhase(0.94, 10_000, false)).toBe('assembling')
    expect(snowmanScenePhase(0.95, 10_000, false)).toBe('complete')
    expect(snowmanSpawnInterval(10_000, dimensions, true)).toBe(
      snowmanSpawnInterval(10_000, dimensions) / 2,
    )
  })

  it('keeps unestimated snowfall unassembled and topples only after attached accumulation', () => {
    const indefinite = advanceSnowmanSimulation(createSnowmanSimulation(dimensions), {
      elapsed: 8_000,
      progress: 1,
      estimatedDurationMs: undefined,
      overdue: false,
      seed: 7,
      dimensions,
    })
    expect(indefinite.body).toBeUndefined()
    let overdue = createSnowmanSimulation(dimensions)
    for (let elapsed = 0; elapsed <= 24_000; elapsed += 100)
      overdue = advanceSnowmanSimulation(overdue, {
        elapsed,
        progress: 1,
        overdue: true,
        ...estimated,
      })
    expect(snowmanLoad(overdue.cells)).toBeGreaterThanOrEqual(SNOWMAN_TOPPLE_LOAD)
    expect(overdue.toppled).toBe(true)
  })

  it('falls through a continuous rolling arc before the figure settles sideways', () => {
    const scene = createSnowmanSimulation(dimensions)
    scene.lastElapsed = 10_000
    scene.nextAt = Number.POSITIVE_INFINITY
    scene.body = { kind: 'body', x: 45, y: 32, radius: 6, angle: 0, locked: true }
    scene.head = { kind: 'head', x: 45, y: 20, radius: 4, angle: 0, locked: true }
    scene.cells = Array.from({ length: SNOWMAN_TOPPLE_LOAD }, (_, id) => ({
      id,
      x: 45,
      y: 32,
      owner: 'snowman' as const,
    }))
    const falling = advanceSnowmanSimulation(scene, {
      elapsed: 10_400,
      progress: 1,
      overdue: true,
      ...estimated,
    })
    expect(falling.toppling?.angle).toBeGreaterThan(0)
    expect(falling.toppled).toBe(false)
    expect(resolvedBallCenter(falling, falling.head ?? scene.head).x).not.toBe(falling.head?.x)
    const settled = advanceSnowmanSimulation(falling, {
      elapsed: 11_200,
      progress: 1,
      overdue: true,
      ...estimated,
    })
    expect(settled.toppled).toBe(true)
    expect(settled.toppling?.angle).toBeCloseTo(Math.PI / 2)
  })
})

describe('duration-aware choreography', () => {
  it('omits assembly when the body cannot roll readably', () => {
    expect(snowmanSchedule(2799).mode).toBe('snowfall')
    expect(
      advanceSnowmanSimulation(createSnowmanSimulation(dimensions), {
        ...estimated,
        estimatedDurationMs: 2799,
        elapsed: 2800,
        progress: 1,
        overdue: false,
      }).body,
    ).toBeUndefined()
  })
  it.each([
    [2800, 'hop'],
    [2801, 'hop'],
    [5149, 'hop'],
    [5150, 'full'],
    [5151, 'full'],
    [10000, 'full'],
    [300000, 'full'],
  ] as const)('fits the %ims run using %s choreography', (duration, mode) => {
    const schedule = snowmanSchedule(duration)
    expect(schedule.mode).toBe(mode)
    expect(schedule.bodyEnd - schedule.bodyStart).toBeGreaterThanOrEqual(700)
    expect(schedule.bodyEnd - schedule.bodyStart).toBeLessThanOrEqual(2500)
    expect(schedule.headStart).toBeGreaterThanOrEqual(duration * 0.75 - 0.00001)
    expect(schedule.land - schedule.hopStart).toBeGreaterThanOrEqual(350)
    expect(schedule.land - schedule.hopStart).toBeLessThanOrEqual(900)
    expect(schedule.settleEnd).toBeLessThanOrEqual(schedule.end)
    expect(schedule.end).toBe(duration * 0.95)
  })

  it('builds from real accumulated snow even at the shortest readable duration on a large panel', () => {
    const scene = advanceSnowmanSimulation(createSnowmanSimulation({ width: 720, height: 360 }), {
      ...estimated,
      dimensions: { width: 720, height: 360 },
      estimatedDurationMs: 2800,
      elapsed: 2675,
      progress: 0.95,
      overdue: false,
    })
    expect(scene.cells.filter((cell) => cell.owner === 'body').length).toBeGreaterThan(10)
    expect(scene.cells.filter((cell) => cell.owner === 'head').length).toBeGreaterThan(0)
    expect(scene.head?.locked).toBe(true)
    expect(scene.hat?.angle).toBeCloseTo(0)
    expect(scene.cells.length + scene.flakes.length).toBe(scene.id)
  })

  it('replays identical material and poses for browser intervals and late mounting', () => {
    const options = { ...estimated, overdue: false, progress: 0.96 }
    const late = advanceSnowmanSimulation(createSnowmanSimulation(dimensions), {
      ...options,
      elapsed: 9600,
    })
    for (const interval of [16, 33, 100]) {
      let scene = createSnowmanSimulation(dimensions)
      for (let elapsed = interval; elapsed < 9600; elapsed += interval)
        scene = advanceSnowmanSimulation(scene, { ...options, elapsed })
      scene = advanceSnowmanSimulation(scene, { ...options, elapsed: 9600 })
      expect(scene).toEqual(late)
    }
    expect(late.cells.length + late.flakes.length).toBe(late.id)
    expect(new Set([...late.cells, ...late.flakes].map((cell) => cell.id)).size).toBe(late.id)
  })

  it('keeps packed material rigid while rotation follows travel and interpolates frames', () => {
    const scene = createSnowmanSimulation(dimensions)
    scene.lastElapsed = 6000
    scene.nextAt = Infinity
    scene.body = { kind: 'body', x: 24.6, y: 42, radius: 2, angle: 0, locked: false }
    scene.cells = [{ id: 1, owner: 'body', x: 0, y: 0, localX: 1, localY: 0, packed: true }]
    const next = advanceSnowmanSimulation(scene, {
      ...estimated,
      elapsed: 6025,
      progress: 0.6025,
      overdue: false,
    })
    expect(next.cells[0]).toEqual(scene.cells[0])
    expect(next.body?.angle).toBeCloseTo(
      Math.hypot((next.body?.x ?? 0) - 24.6, (next.body?.y ?? 0) - 42) / (next.body?.radius ?? 1),
    )
    const midway = interpolateSnowman(scene, next, 0.5)
    expect(midway.body?.x).toBeCloseTo((24.6 + (next.body?.x ?? 0)) / 2)
  })

  it('hops above the direct path, seats exactly, and carries the hat through toppling', () => {
    const schedule = snowmanSchedule(10000)
    const launch = advanceTo(Math.ceil(schedule.hopStart / 25) * 25, 0.8)
    const mid = advanceSnowmanSimulation(launch, {
      ...estimated,
      elapsed: (schedule.hopStart + schedule.land) / 2,
      progress: 0.9,
      overdue: false,
    })
    expect(mid.head?.y).toBeLessThan(
      ((launch.head?.y ?? 0) +
        (mid.body?.y ?? 0) -
        (mid.body?.radius ?? 0) -
        (mid.head?.radius ?? 0)) /
        2,
    )
    const done = advanceSnowmanSimulation(mid, {
      ...estimated,
      elapsed: 9500,
      progress: 0.95,
      overdue: false,
    })
    expect(done.head?.locked).toBe(true)
    expect(done.head?.radius).toBeLessThan(done.body?.radius ?? 0)
    expect(done.head?.x).toBe(done.body?.x)
    expect(done.hat?.angle).toBeCloseTo(0)
    done.toppling = { startedAt: 9500, angle: Math.PI / 2, pivotX: 40, pivotY: 40 }
    const hat = resolvedHat(done)
    expect(hat?.angle).toBeCloseTo(Math.PI / 2)
    expect(hat?.x).toBeCloseTo(80 - (done.hat?.y ?? 0))
    expect(hat?.y).toBeCloseTo(done.hat?.x ?? 0)
  })
})

import { describe, expect, it } from 'vitest'
import {
  advanceSnowmanSimulation,
  createSnowmanSimulation,
  resolvedBallCenter,
  resolvedCells,
  SNOWMAN_TOPPLE_LOAD,
  snowmanLoad,
  snowmanScenePhase,
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
    expect(
      new Set(bodyCells.map((cell) => `${Math.round(cell.x)}:${Math.round(cell.y)}`)).size,
    ).toBe(bodyCells.length)
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
    scene.body = { kind: 'body', x: 30, y: 25, radius: 5, angle: 0, locked: true }
    scene.flakes = [{ id: 99, x: 30, y: 23, bornAt: 0 }]
    const joined = advanceSnowmanSimulation(scene, {
      elapsed: 25,
      progress: 1,
      overdue: false,
      ...estimated,
    })
    const first = joined.cells.find((cell) => cell.id === 99)
    expect(first?.owner).toBe('body')
    expect(first?.targetLocalX).toBeDefined()
    const compacted = advanceSnowmanSimulation(joined, {
      elapsed: 50,
      progress: 1,
      overdue: false,
      ...estimated,
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

  it('rolls and then continuously climbs the head ball onto the body', () => {
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
      elapsed: 400,
      progress: 1,
      overdue: true,
      ...estimated,
    })
    expect(falling.toppling?.angle).toBeGreaterThan(0)
    expect(falling.toppled).toBe(false)
    expect(resolvedBallCenter(falling, falling.head ?? scene.head).x).not.toBe(falling.head?.x)
    const settled = advanceSnowmanSimulation(falling, {
      elapsed: 1_200,
      progress: 1,
      overdue: true,
      ...estimated,
    })
    expect(settled.toppled).toBe(true)
    expect(settled.toppling?.angle).toBeCloseTo(Math.PI / 2)
  })
})

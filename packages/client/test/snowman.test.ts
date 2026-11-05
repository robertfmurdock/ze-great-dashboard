import { mint } from '@continuous-excellence/testmints-js/vitest'
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

function completedSceneWithAttachedSnow(load: number) {
  const scene = createSnowmanSimulation(dimensions)
  scene.lastElapsed = 10_000
  scene.nextAt = Number.POSITIVE_INFINITY
  scene.body = { kind: 'body', x: 45, y: 40, radius: 4, angle: 0, locked: true }
  scene.cells = Array.from({ length: load }, (_, id) => ({
    id,
    x: 45,
    y: 45,
    owner: 'snowman' as const,
  }))
  return scene
}

describe('wind', () => {
  it(
    'keeps a stable breeze and deterministic intermittent gusts for a fixed seed',
    mint({
      setup: () => ({ seed: 7 }),
      exercise: ({ seed }) => ({
        first: snowmanWind(seed, 2000),
        repeat: snowmanWind(seed, 2000),
        start: snowmanWind(seed, 0),
        gust: snowmanWind(seed, 2400),
      }),
      verify: ({ first, repeat, start, gust }) => {
        expect(Math.abs(first)).toBeGreaterThan(0.2)
        expect(repeat).toBe(first)
        expect(Math.abs(start - gust)).toBeGreaterThan(0.3)
      },
    }),
  )
})

describe('snow accumulation', () => {
  it(
    'packs flakes against existing snow instead of stacking only in their landing column',
    mint({
      setup: () => ({
        scene: createSnowmanSimulation(dimensions),
        options: { ...estimated, elapsed: 4000, progress: 0.4, overdue: false },
      }),
      exercise: ({ scene, options }) => advanceSnowmanSimulation(scene, options),
      verify: (scene) => {
        const ground = resolvedCells(scene).filter((cell) => cell.owner === 'ground')
        expect(ground.length).toBeGreaterThan(100)
        expect(new Set(ground.map((cell) => cell.x)).size).toBeGreaterThan(20)
        expect(
          ground.some((cell) =>
            ground.some((other) => other.y === cell.y + 1 && Math.abs(other.x - cell.x) === 1),
          ),
        ).toBe(true)
      },
    }),
  )

  it(
    'lets settled snow creep into a newly cleared gap',
    mint({
      setup: () => {
        const scene = createSnowmanSimulation(dimensions)
        scene.cells = [
          { id: 1, x: 20, y: 44, owner: 'ground' },
          { id: 2, x: 21, y: 43, owner: 'ground' },
        ]

        const options = {
          elapsed: 25,
          progress: 0.4,
          overdue: false,
          ...estimated,
        } satisfies Parameters<typeof advanceSnowmanSimulation>[1]
        return { scene, options }
      },
      exercise: ({ scene, options }) => advanceSnowmanSimulation(scene, options),
      verify: (relaxed) => {
        expect(relaxed.cells.find((cell) => cell.id === 2)).toMatchObject({ x: 21, y: 44 })
      },
    }),
  )
})

describe('rolling assembly', () => {
  it(
    'rolls a growing body ball through contacted terrain without relocating flakes to a final silhouette',
    mint({
      setup: () => {
        const first = advanceTo(5_800, 0.58)

        const options = {
          elapsed: 6_600,
          progress: 0.66,
          overdue: false,
          ...estimated,
        } satisfies Parameters<typeof advanceSnowmanSimulation>[1]
        return { options, first }
      },
      exercise: ({ first, options }) => advanceSnowmanSimulation(first, options),
      verify: (later, { first }) => {
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
        const interiorCells = bodyCells.filter(
          (cell) =>
            Math.hypot(cell.x - (later.body?.x ?? 0), cell.y - (later.body?.y ?? 0)) <=
            (later.body?.radius ?? 0) * 0.65,
        )
        expect(interiorCells.length).toBeGreaterThan(5)
      },
    }),
  )

  it(
    'approaches changing support height without jumping the rolling core',
    mint({
      setup: () => {
        const rolling = advanceTo(5_800, 0.58)

        const options = {
          elapsed: 5_825,
          progress: 0.58,
          overdue: false,
          ...estimated,
        } satisfies Parameters<typeof advanceSnowmanSimulation>[1]
        return { options, rolling }
      },
      exercise: ({ rolling, options }) => advanceSnowmanSimulation(rolling, options),
      verify: (next, { rolling }) => {
        expect(Math.abs((next.body?.y ?? 0) - (rolling.body?.y ?? 0))).toBeLessThanOrEqual(0.16)
      },
    }),
  )

  it(
    'compacts contact grains inward and lets falling flakes join the ball',
    mint({
      setup: () => {
        const scene = createSnowmanSimulation(dimensions)
        scene.nextAt = Number.POSITIVE_INFINITY
        scene.body = { kind: 'body', x: 30, y: 25, radius: 5, angle: 0, locked: false }
        scene.flakes = [{ id: 99, x: 30, y: 23, bornAt: 0 }]
        return { scene }
      },
      exercise: ({ scene }) => {
        const joined = advanceSnowmanSimulation(scene, {
          elapsed: 25,
          progress: 1,
          overdue: false,
          ...estimated,
          estimatedDurationMs: undefined,
        })
        const first = joined.cells.find((cell) => cell.id === 99)
        const compacted = advanceSnowmanSimulation(joined, {
          elapsed: 50,
          progress: 1,
          overdue: false,
          ...estimated,
          estimatedDurationMs: undefined,
        }).cells.find((cell) => cell.id === 99)
        return { first, compacted }
      },
      verify: ({ first, compacted }) => {
        expect(first?.owner).toBe('body')
        expect(first?.targetLocalX).toBeDefined()
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
      },
    }),
  )

  it(
    'rolls and then hops the head ball onto the body',
    mint({
      setup: () => {
        const rolling = advanceTo(8_100, 0.81)

        const options = {
          elapsed: 9_400,
          progress: 0.94,
          overdue: false,
          ...estimated,
        } satisfies Parameters<typeof advanceSnowmanSimulation>[1]
        return { options, rolling }
      },
      exercise: ({ rolling, options }) => advanceSnowmanSimulation(rolling, options),
      verify: (seated, { rolling }) => {
        expect(rolling.head).toBeDefined()
        expect(seated.head?.y).toBeLessThan(rolling.head?.y ?? Number.POSITIVE_INFINITY)
        expect(Math.abs((seated.head?.x ?? 0) - (seated.body?.x ?? 0))).toBeLessThan(1)
      },
    }),
  )

  it(
    'anchors the completed figure while nearby settled snow continues to relax',
    mint({
      setup: () => {
        const complete = advanceTo(9_600, 0.96)
        return { complete }
      },
      exercise: ({ complete }) => {
        let later = complete
        for (const elapsed of [10_600, 10_975, 11_000, 11_125])
          later = advanceSnowmanSimulation(later, {
            elapsed,
            progress: 1,
            overdue: false,
            ...estimated,
          })
        return later
      },
      verify: (later, { complete }) => {
        expect(complete.body?.locked).toBe(true)
        expect(complete.head?.locked).toBe(true)
        expect(later.body).toMatchObject({ x: complete.body?.x, y: complete.body?.y })
        expect(later.head).toMatchObject({ x: complete.head?.x, y: complete.head?.y })
        const ground = resolvedCells(complete).filter(
          (cell) =>
            cell.owner === 'ground' &&
            Math.abs(cell.x - (complete.body?.x ?? 0)) <= (complete.body?.radius ?? 0),
        )
        expect(ground.length).toBeGreaterThan(0)
        expect((complete.body?.y ?? 0) + (complete.body?.radius ?? 0)).toBeCloseTo(
          Math.min(...ground.map((cell) => cell.y)),
          5,
        )
        const bodyCells = resolvedCells(complete).filter((cell) => cell.owner === 'body')
        expect(
          Math.min(...ground.map((cell) => cell.y)) - Math.max(...bodyCells.map((cell) => cell.y)),
        ).toBeLessThanOrEqual(0.25)
      },
    }),
  )
})

describe('attached-snow toppling', () => {
  it(
    'falls through a continuous rolling arc before the figure settles sideways',
    mint({
      setup: () => {
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
        return { scene }
      },
      exercise: ({ scene }) => {
        const falling = advanceSnowmanSimulation(scene, {
          elapsed: 10_400,
          progress: 1,
          overdue: true,
          ...estimated,
        })
        const settled = advanceSnowmanSimulation(falling, {
          elapsed: 11_200,
          progress: 1,
          overdue: true,
          ...estimated,
        })
        return { falling, settled }
      },
      verify: ({ falling, settled }, { scene }) => {
        expect(falling.toppling?.angle).toBeGreaterThan(0)
        expect(falling.toppled).toBe(false)
        expect(
          resolvedBallCenter(
            falling,
            falling.head ?? (scene.head as NonNullable<typeof scene.head>),
          ).x,
        ).not.toBe(falling.head?.x)
        expect(settled.toppled).toBe(true)
        expect(settled.toppling?.angle).toBeCloseTo(Math.PI / 2)
      },
    }),
  )

  it(
    'does not topple below the attached snow threshold',
    mint({
      setup: () => {
        const oneShort = completedSceneWithAttachedSnow(SNOWMAN_TOPPLE_LOAD - 1)

        const options = {
          elapsed: 10_025,
          progress: 1,
          overdue: true,
          ...estimated,
        } satisfies Parameters<typeof advanceSnowmanSimulation>[1]
        return { oneShort, options }
      },
      exercise: ({ oneShort, options }) => advanceSnowmanSimulation(oneShort, options),
      verify: (belowThreshold) => {
        expect(belowThreshold.toppling).toBeUndefined()
      },
    }),
  )

  it(
    'topples when a falling flake reaches the attached snow threshold',
    mint({
      setup: () => {
        const threshold = completedSceneWithAttachedSnow(SNOWMAN_TOPPLE_LOAD - 1)
        threshold.flakes = [{ id: SNOWMAN_TOPPLE_LOAD, x: 45, y: 43.5, bornAt: 10_000 }]

        const options = {
          elapsed: 10_025,
          progress: 1,
          overdue: true,
          ...estimated,
        } satisfies Parameters<typeof advanceSnowmanSimulation>[1]
        return { threshold, options }
      },
      exercise: ({ threshold, options }) => advanceSnowmanSimulation(threshold, options),
      verify: (attached, { options }) => {
        expect(snowmanLoad(attached.cells)).toBe(SNOWMAN_TOPPLE_LOAD)
        expect(attached.toppling).toMatchObject({ startedAt: options.elapsed })
      },
    }),
  )

  it(
    'carries the hat through a toppled pose',
    mint({
      setup: () => {
        const schedule = snowmanSchedule(10000)
        const launch = advanceTo(Math.ceil(schedule.hopStart / 25) * 25, 0.8)
        const mid = advanceSnowmanSimulation(launch, {
          ...estimated,
          elapsed: (schedule.hopStart + schedule.land) / 2,
          progress: 0.9,
          overdue: false,
        })
        const done = advanceSnowmanSimulation(mid, {
          ...estimated,
          elapsed: 9500,
          progress: 0.95,
          overdue: false,
        })
        done.toppling = { startedAt: 9500, angle: Math.PI / 2, pivotX: 40, pivotY: 40 }
        return { done }
      },
      exercise: ({ done }) => resolvedHat(done),
      verify: (hat, { done }) => {
        expect(hat?.angle).toBeCloseTo(Math.PI / 2)
        expect(hat?.x).toBeCloseTo(80 - (done.hat?.y ?? 0))
        expect(hat?.y).toBeCloseTo(done.hat?.x ?? 0)
      },
    }),
  )
})

describe('duration-aware choreography', () => {
  it(
    'omits assembly when the body cannot roll readably',
    mint({
      setup: () => ({
        scene: createSnowmanSimulation(dimensions),
        options: {
          ...estimated,
          estimatedDurationMs: 2799,
          elapsed: 2800,
          progress: 1,
          overdue: false,
        },
      }),
      exercise: ({ scene, options }) => advanceSnowmanSimulation(scene, options),
      verify: (scene) => expect(scene.body).toBeUndefined(),
    }),
  )

  for (const scenario of [
    { duration: 2800, mode: 'hop' },
    { duration: 2801, mode: 'hop' },
    { duration: 5149, mode: 'hop' },
    { duration: 5150, mode: 'full' },
    { duration: 5151, mode: 'full' },
    { duration: 10000, mode: 'full' },
    { duration: 300000, mode: 'full' },
  ])
    it(
      `fits the ${scenario.duration}ms run with ${scenario.mode} choreography`,
      mint({
        setup: () => scenario,
        exercise: ({ duration }) => snowmanSchedule(duration),
        verify: (schedule, { duration, mode }) => {
          expect(schedule.mode).toBe(mode)
          expect(schedule.bodyEnd - schedule.bodyStart).toBeGreaterThanOrEqual(700)
          expect(schedule.bodyEnd - schedule.bodyStart).toBeLessThanOrEqual(2500)
          expect(schedule.headStart).toBeGreaterThanOrEqual(duration * 0.75 - 0.00001)
          expect(schedule.land - schedule.hopStart).toBeGreaterThanOrEqual(350)
          expect(schedule.land - schedule.hopStart).toBeLessThanOrEqual(900)
          expect(schedule.settleEnd).toBeLessThanOrEqual(schedule.end)
          expect(schedule.end).toBe(duration * 0.95)
        },
      }),
    )

  it(
    'builds from real accumulated snow even at the shortest readable duration on a large panel',
    mint({
      setup: () => {
        const dimensions = { width: 720, height: 360 }
        const input = createSnowmanSimulation(dimensions)
        const options = {
          ...estimated,
          dimensions,
          estimatedDurationMs: 2800,
          elapsed: 2675,
          progress: 0.95,
          overdue: false,
        } satisfies Parameters<typeof advanceSnowmanSimulation>[1]
        return { input, options }
      },
      exercise: ({ input, options }) => advanceSnowmanSimulation(input, options),
      verify: (scene) => {
        expect(scene.cells.filter((cell) => cell.owner === 'body').length).toBeGreaterThan(10)
        expect(scene.cells.filter((cell) => cell.owner === 'head').length).toBeGreaterThan(0)
        expect(scene.head?.locked).toBe(true)
        expect(scene.hat?.angle).toBeCloseTo(0)
        expect(scene.cells.length + scene.flakes.length).toBe(scene.id)
      },
    }),
  )

  it(
    'replays identical material and poses for browser intervals and late mounting',
    mint({
      setup: () => ({
        options: { ...estimated, overdue: false, progress: 0.96 },
        elapsed: 9600,
        intervals: [16, 33, 100],
      }),
      exercise: ({ options, elapsed, intervals }) => {
        const late = advanceSnowmanSimulation(createSnowmanSimulation(dimensions), {
          ...options,
          elapsed,
        })
        const stepped = intervals.map((interval) => {
          let scene = createSnowmanSimulation(dimensions)
          for (let time = interval; time < elapsed; time += interval)
            scene = advanceSnowmanSimulation(scene, { ...options, elapsed: time })
          return advanceSnowmanSimulation(scene, { ...options, elapsed })
        })
        return { late, stepped }
      },
      verify: ({ late, stepped }) => {
        for (const scene of stepped) expect(scene).toEqual(late)
        expect(late.cells.length + late.flakes.length).toBe(late.id)
        expect(new Set([...late.cells, ...late.flakes].map((cell) => cell.id)).size).toBe(late.id)
      },
    }),
  )

  it(
    'leaves unestimated snowfall unassembled',
    mint({
      setup: () => {
        const indefinite = createSnowmanSimulation(dimensions)
        indefinite.lastElapsed = 7_975
        indefinite.nextAt = Number.POSITIVE_INFINITY

        const options = {
          elapsed: 8_000,
          progress: 1,
          estimatedDurationMs: undefined,
          overdue: false,
          seed: 7,
          dimensions,
        } satisfies Parameters<typeof advanceSnowmanSimulation>[1]
        return { indefinite, options }
      },
      exercise: ({ indefinite, options }) => advanceSnowmanSimulation(indefinite, options),
      verify: (unestimated) => {
        expect(unestimated.body).toBeUndefined()
      },
    }),
  )

  it(
    'uses snowfall-only scheduling below readable assembly duration',
    mint({
      setup: () => ({ duration: 2799 }),
      exercise: ({ duration }) => snowmanSchedule(duration),
      verify: (schedule) => expect(schedule.mode).toBe('snowfall'),
    }),
  )
})

describe('pose projection', () => {
  it(
    'keeps packed material rigid while rotation follows travel and interpolates frames',
    mint({
      setup: () => {
        const scene = createSnowmanSimulation(dimensions)
        scene.lastElapsed = 6000
        scene.nextAt = Infinity
        scene.body = { kind: 'body', x: 24.6, y: 42, radius: 2, angle: 0, locked: false }
        scene.cells = [{ id: 1, owner: 'body', x: 0, y: 0, localX: 1, localY: 0, packed: true }]

        const options = {
          ...estimated,
          elapsed: 6025,
          progress: 0.6025,
          overdue: false,
        } satisfies Parameters<typeof advanceSnowmanSimulation>[1]
        return { options, scene }
      },
      exercise: ({ scene, options }) => advanceSnowmanSimulation(scene, options),
      verify: (next, { scene }) => {
        expect(next.cells[0]).toEqual(scene.cells[0])
        expect(next.body?.angle).toBeCloseTo(
          Math.hypot((next.body?.x ?? 0) - 24.6, (next.body?.y ?? 0) - 42) /
            (next.body?.radius ?? 1),
        )
      },
    }),
  )

  it(
    'hops above the direct path, seats exactly, and carries the hat through toppling',
    mint({
      setup: () => {
        const schedule = snowmanSchedule(10000)
        const launch = advanceTo(Math.ceil(schedule.hopStart / 25) * 25, 0.8)
        return { launch, schedule }
      },
      exercise: ({ launch, schedule }) => {
        const mid = advanceSnowmanSimulation(launch, {
          ...estimated,
          elapsed: (schedule.hopStart + schedule.land) / 2,
          progress: 0.9,
          overdue: false,
        })
        const done = advanceSnowmanSimulation(mid, {
          ...estimated,
          elapsed: 9500,
          progress: 0.95,
          overdue: false,
        })
        return { mid, done }
      },
      verify: ({ mid, done }, { launch }) => {
        expect(mid.head?.y).toBeLessThan(
          ((launch.head?.y ?? 0) +
            (mid.body?.y ?? 0) -
            (mid.body?.radius ?? 0) -
            (mid.head?.radius ?? 0)) /
            2,
        )
        expect(done.head?.locked).toBe(true)
        expect(done.head?.radius).toBeLessThan(done.body?.radius ?? 0)
        expect(done.head?.x).toBe(done.body?.x)
        expect(done.hat?.angle).toBeCloseTo(0)
      },
    }),
  )

  it(
    'interpolates the rolling ball between simulation frames',
    mint({
      setup: () => {
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
        return { scene, next, fraction: 0.5 }
      },
      exercise: ({ scene, next, fraction }) => interpolateSnowman(scene, next, fraction),
      verify: (midway, { scene, next, fraction }) =>
        expect(midway.body?.x).toBeCloseTo(((scene.body?.x ?? 0) + (next.body?.x ?? 0)) * fraction),
    }),
  )
})

describe('snowfall pacing', () => {
  it(
    'scales snowfall with measured panel area',
    mint({
      setup: () => ({
        duration: 10000,
        large: { width: 720, height: 360 },
        small: { width: 180, height: 90 },
      }),
      exercise: ({ duration, large, small }) => ({
        large: snowmanSpawnInterval(duration, large),
        small: snowmanSpawnInterval(duration, small),
      }),
      verify: ({ large, small }) => expect(large).toBeLessThan(small),
    }),
  )

  for (const scenario of [
    { elapsed: 4400, overdue: false, multiplier: 1 },
    { elapsed: 4500, overdue: false, multiplier: 4 },
    { elapsed: 7000, overdue: false, multiplier: 4 },
    { elapsed: 7000, overdue: true, multiplier: 0.5 },
  ])
    it(
      `uses cadence multiplier ${scenario.multiplier} at ${scenario.elapsed}ms overdue ${scenario.overdue}`,
      mint({
        setup: () => ({ ...scenario, duration: 10000, dimensions }),
        exercise: ({ duration, dimensions, elapsed, overdue }) => ({
          baseline: snowmanSpawnInterval(duration, dimensions, false, 0),
          interval: snowmanSpawnInterval(duration, dimensions, overdue, elapsed),
        }),
        verify: ({ baseline, interval }, { multiplier }) =>
          expect(interval).toBe(baseline * multiplier),
      }),
    )
})

describe('assembly milestones', () => {
  for (const scenario of [
    { progress: 0.94, phase: 'assembling' },
    { progress: 0.95, phase: 'complete' },
  ])
    it(
      `reports ${scenario.phase} at progress ${scenario.progress}`,
      mint({
        setup: () => scenario,
        exercise: ({ progress }) => snowmanScenePhase(progress, 10000, false),
        verify: (phase, { phase: expected }) => expect(phase).toBe(expected),
      }),
    )
})

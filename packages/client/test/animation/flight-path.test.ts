import { mint } from '@continuous-excellence/testmints-js/vitest'
import { describe, expect, it } from 'vitest'
import { flightPosition } from '../../src/FlightPathField.tsx'

describe('flight camera positions', () => {
  for (const scenario of [
    { progress: 0, expected: { worldX: 8, worldY: 74, x: 8, y: 74, pitch: 0, stage: 'rollout' } },
    {
      progress: 0.18,
      expected: { worldX: 22, worldY: 74, x: 22, y: 74, pitch: -7, stage: 'climb' },
    },
    { progress: 0.35, expected: { x: 50, y: 50, pitch: 0, stage: 'cruise', groundOffsetY: 20 } },
    { progress: 0.7, expected: { x: 50, y: 50, pitch: 4, stage: 'approach' } },
  ])
    it(
      `positions the aircraft at progress ${scenario.progress}`,
      mint({
        setup: () => scenario,
        exercise: ({ progress }) => flightPosition(progress, false),
        verify: (position, { expected }) => expect(position).toMatchObject(expected),
      }),
    )
  it(
    'follows the climb before centering',
    mint({
      setup: () => ({ progress: 0.26 }),
      exercise: ({ progress }) => flightPosition(progress, false),
      verify: (position) => {
        expect(position.x).toBeLessThan(50)
        expect(position.pitch).toBe(-7)
      },
    }),
  )
  it(
    'brings ground back into view during approach',
    mint({
      setup: () => ({ progress: 0.85 }),
      exercise: ({ progress }) => flightPosition(progress, false),
      verify: (position) => {
        expect(position.groundOffsetY).toBeGreaterThan(0)
        expect(position.groundOffsetY).toBeLessThan(20)
      },
    }),
  )
  it(
    'keeps the runway below the centered late-flight camera',
    mint({
      setup: () => ({ progress: 1, runwayY: 74 }),
      exercise: ({ progress }) => flightPosition(progress, false),
      verify: (position, { runwayY }) => {
        expect(position).toMatchObject({
          x: 50,
          y: 50,
          pitch: 4,
          stage: 'approach',
          groundOffsetY: 0,
        })
        expect(Math.abs(position.pitch)).toBeLessThanOrEqual(7)
        expect(runwayY - position.cameraY - position.y).toBeGreaterThan(20)
      },
    }),
  )
  it(
    'holds an indeterminate flight in level cruise',
    mint({
      setup: () => ({ progress: 0.95 }),
      exercise: ({ progress }) => flightPosition(progress, true),
      verify: (position) =>
        expect(position).toMatchObject({ x: 50, y: 50, pitch: 0, stage: 'holding' }),
    }),
  )
})

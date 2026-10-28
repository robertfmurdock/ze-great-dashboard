import { mint } from '@continuous-excellence/testmints-js/vitest'
import { describe, expect, test } from 'vitest'
import type { FallingShape } from '../src/falling-shapes.ts'
import {
  advanceFallingSimulation,
  createFallingSimulation,
  FALLING_PIECE_INTERVAL_MS,
  FALLING_TRAVEL_MS,
  visibleFallingShapes,
} from '../src/falling-simulation.ts'

const wideField = { direction: 'horizontal' as const, columns: 12, rows: 3 }
const ordinaryRun = { progress: 0.4, overdue: false, seed: 7 }

describe('falling simulation', () => {
  test(
    'introduces an entry piece at its configured cadence',
    mint({
      setup: () => ({
        initial: createFallingSimulation(),
        cadence: FALLING_PIECE_INTERVAL_MS,
        simulationInput: {
          ...wideField,
          ...ordinaryRun,
        },
      }),
      exercise: ({ initial, cadence, simulationInput }) => {
        const beforeCadence = advanceFallingSimulation(initial, {
          ...simulationInput,
          elapsed: cadence - 1,
        })
        const entering = advanceFallingSimulation(initial, { ...simulationInput, elapsed: cadence })
        return { beforeCadence, entering }
      },
      verify: ({ beforeCadence, entering }) => {
        expect(visibleFallingShapes(beforeCadence)).toEqual([])
        expect(entering.active).toHaveLength(1)
        expect(entering.active[0]?.phase).toBe('entry')
      },
    }),
  )

  test(
    'settles an entering piece at its selected destination',
    mint({
      setup: () => ({
        simulation: {
          ...createFallingSimulation(),
          active: [
            {
              id: 0,
              bornAt: 0,
              cells: [{ x: 0, y: 0 }],
              x: 11.5,
              y: 1,
              targetX: 2,
              targetY: 1,
              phase: 'entry' as const,
            },
          ],
        },
        simulationInput: {
          elapsed: FALLING_TRAVEL_MS + 250,
          ...wideField,
          ...ordinaryRun,
        },
      }),
      exercise: ({ simulation, simulationInput }) =>
        advanceFallingSimulation(simulation, simulationInput),
      verify: (settled) => {
        expect(settled.active).toEqual([])
        expect(settled.settled).toMatchObject([{ id: 0, x: 2, y: 1, phase: 'settled' }])
      },
    }),
  )

  test(
    'clears a full trailing line before resuming the simulation',
    mint({
      setup: () => {
        const settled = Array.from(
          { length: 9 },
          (_, id): FallingShape => ({
            id,
            bornAt: 0,
            cells: [{ x: 0, y: 0 }],
            x: Math.floor(id / 3),
            y: id % 3,
            phase: 'settled',
          }),
        )
        return {
          simulation: { ...createFallingSimulation(), settled, nextPieceAt: 0 },
          simulationInput: {
            direction: 'horizontal' as const,
            columns: 3,
            rows: 3,
            progress: 1,
            overdue: true,
            seed: 7,
          },
        }
      },
      exercise: ({ simulation, simulationInput }) => {
        const recycling = advanceFallingSimulation(simulation, { ...simulationInput, elapsed: 0 })
        return {
          recycling,
          afterRecycle: advanceFallingSimulation(recycling, {
            ...simulationInput,
            elapsed: recycling.recycleUntil,
          }),
        }
      },
      verify: ({ recycling, afterRecycle }) => {
        expect(recycling.recycling).toBe(true)
        expect(recycling.clearingCells).toHaveLength(3)
        expect(afterRecycle.recycling).toBe(false)
        expect(afterRecycle.clearingCells).toEqual([])
      },
    }),
  )
})

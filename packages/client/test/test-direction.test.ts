import { mint } from '@continuous-excellence/testmints-js/vitest'
import { describe, expect, test } from 'vitest'
import {
  classifyTestDirection,
  type TestDirection,
  type TestSample,
} from '../src/test-direction.ts'

function samples(totals: readonly number[]): TestSample[] {
  return totals.map((total, index) => ({
    total,
    id: String(index),
    attempt: 1,
    updatedAt: new Date(Date.UTC(2026, 10, 4, index)).toISOString(),
  }))
}

describe('test direction selection', () => {
  const cases: {
    name: string
    totals: number[]
    mode: TestDirection['mode']
    delta: number
    symbol: string
    emphasized: boolean
    visibleTotals?: number[]
  }[] = [
    {
      name: 'one run cannot supply a delta',
      totals: [100],
      mode: 'quiet',
      delta: 0,
      symbol: '',
      emphasized: false,
    },
    {
      name: 'flat counts',
      totals: [100, 100],
      mode: 'quiet',
      delta: 0,
      symbol: '',
      emphasized: false,
    },
    {
      name: 'zero overrides large decrease',
      totals: [100, 0],
      mode: 'zero',
      delta: -100,
      symbol: '⚠ ↓',
      emphasized: true,
    },
    {
      name: 'repeated reported zero is quiet',
      totals: [0, 0],
      mode: 'quiet',
      delta: 0,
      symbol: '',
      emphasized: false,
    },
    {
      name: 'inclusive upward threshold',
      totals: [100, 120],
      mode: 'jump',
      delta: 20,
      symbol: '↑',
      emphasized: true,
    },
    {
      name: 'inclusive downward threshold',
      totals: [100, 80],
      mode: 'jump',
      delta: -20,
      symbol: '↓',
      emphasized: true,
    },
    {
      name: 'absolute threshold still applies',
      totals: [10, 29],
      mode: 'change',
      delta: 19,
      symbol: '↑',
      emphasized: false,
    },
    {
      name: 'relative threshold still applies',
      totals: [1000, 1199],
      mode: 'change',
      delta: 199,
      symbol: '↑',
      emphasized: false,
    },
    {
      name: 'rise from zero',
      totals: [0, 20],
      mode: 'jump',
      delta: 20,
      symbol: '↑',
      emphasized: true,
    },
    {
      name: 'small rise from zero',
      totals: [0, 19],
      mode: 'change',
      delta: 19,
      symbol: '↑',
      emphasized: false,
    },
    {
      name: 'two following runs establish a plateau',
      totals: [100, 140, 141, 142],
      mode: 'holding',
      delta: 42,
      symbol: '→',
      emphasized: false,
    },
    {
      name: 'minimum plateau tolerance',
      totals: [30, 50, 52, 48],
      mode: 'holding',
      delta: 18,
      symbol: '→',
      emphasized: false,
    },
    {
      name: 'relative plateau tolerance',
      totals: [800, 1000, 1020, 980],
      mode: 'holding',
      delta: 180,
      symbol: '→',
      emphasized: false,
    },
    {
      name: 'one following run is insufficient',
      totals: [100, 140, 140],
      mode: 'quiet',
      delta: 0,
      symbol: '',
      emphasized: false,
    },
    {
      name: 'drifting beyond plateau tolerance',
      totals: [100, 140, 143, 143],
      mode: 'quiet',
      delta: 0,
      symbol: '',
      emphasized: false,
    },
    {
      name: 'most recent qualifying plateau wins',
      totals: [100, 140, 141, 142, 200, 201, 200],
      mode: 'holding',
      delta: 58,
      symbol: '→',
      emphasized: false,
    },
    {
      name: 'new jump overrides prior direction',
      totals: [100, 102, 104, 130],
      mode: 'jump',
      delta: 26,
      symbol: '↑',
      emphasized: true,
    },
    {
      name: 'three rises and a flat',
      totals: [100, 102, 102, 104, 105],
      mode: 'trend',
      delta: 5,
      symbol: '↗',
      emphasized: false,
    },
    {
      name: 'three falls',
      totals: [105, 103, 101, 100],
      mode: 'trend',
      delta: -5,
      symbol: '↘',
      emphasized: false,
    },
    {
      name: 'two rises cannot establish direction',
      totals: [100, 103, 106],
      mode: 'change',
      delta: 3,
      symbol: '↑',
      emphasized: false,
    },
    {
      name: 'tiny net movement cannot establish direction',
      totals: [100, 101, 102, 103],
      mode: 'change',
      delta: 1,
      symbol: '↑',
      emphasized: false,
    },
    {
      name: 'opposing movement breaks a trend',
      totals: [100, 103, 102, 104, 106],
      mode: 'change',
      delta: 2,
      symbol: '↑',
      emphasized: false,
    },
    {
      name: 'ordinary decrease',
      totals: [100, 97],
      mode: 'change',
      delta: -3,
      symbol: '↓',
      emphasized: false,
    },
    {
      name: 'only latest eight counts inform direction',
      visibleTotals: [100, 102, 104, 106, 108, 110, 112, 114],
      totals: [0, 100, 102, 104, 106, 108, 110, 112, 114],
      mode: 'trend',
      delta: 14,
      symbol: '↗',
      emphasized: false,
    },
  ]
  for (const scenario of cases)
    test(
      scenario.name,
      mint({
        setup: () => ({
          scenario,
          input: samples(scenario.totals),
          expectedTotals: scenario.visibleTotals ?? scenario.totals,
        }),
        exercise: ({ input }) => classifyTestDirection(input),
        verify: (result, { scenario, expectedTotals }) => {
          expect(result).toMatchObject({
            mode: scenario.mode,
            delta: scenario.delta,
            symbol: scenario.symbol,
            emphasized: scenario.emphasized,
            totals: expectedTotals,
          })
          expect(result?.explanation).toContain('Source readings retained by this browser')
        },
      }),
    )
  test(
    'empty history has no presentation',
    mint({
      setup: () => [],
      exercise: classifyTestDirection,
      verify: (result) => expect(result).toBeUndefined(),
    }),
  )
})

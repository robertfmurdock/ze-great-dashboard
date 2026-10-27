import { mint } from '@continuous-excellence/testmints-js/vitest'
import { describe, expect, test } from 'vitest'
import type { Panel } from '../src'
import { analyzeBoardLayout, isZeroPosition, normalizeBoardLayout } from '../src'

const panel = (id: string, position?: Panel['position']): Panel => ({
  id,
  type: 'test',
  ...(position ? { position } : {}),
})

describe('analyzeBoardLayout', () => {
  test(
    'accepts a clean twelve-by-twelve layout',
    mint({
      setup: () => ({
        panels: [
          panel('left', { x: 0, y: 0, w: 6, h: 6 }),
          panel('right', { x: 6, y: 0, w: 6, h: 6 }),
        ],
      }),
      exercise: ({ panels }) => analyzeBoardLayout(panels),
      verify: (result) => expect(result.issues).toEqual([]),
    }),
  )

  test(
    'reports vertical overflow without changing authored coordinates',
    mint({
      setup: () => {
        const position = { x: 0, y: 12, w: 12, h: 12 }
        return { panels: [panel('review', position)] }
      },
      exercise: ({ panels }) => analyzeBoardLayout(panels),
      verify: (result) =>
        expect(result.issues[0]).toMatchObject({ panelId: 'review', kind: 'out-of-bounds' }),
    }),
  )

  test(
    'reports overlaps separately from non-renderable positions',
    mint({
      setup: () => ({
        panels: [
          panel('first', { x: 0, y: 0, w: 8, h: 3 }),
          panel('second', { x: 4, y: 1, w: 8, h: 2 }),
        ],
      }),
      exercise: ({ panels }) => analyzeBoardLayout(panels),
      verify: (result) =>
        expect(result.issues[0]).toMatchObject({
          panelId: 'second',
          kind: 'overlap',
          position: { x: 4, y: 1, w: 8, h: 2 },
          conflictsWith: ['first'],
        }),
    }),
  )

  test(
    'aggregates all overlap partners into one issue',
    mint({
      setup: () => ({
        panels: [
          panel('first', { x: 0, y: 0, w: 6, h: 3 }),
          panel('second', { x: 6, y: 0, w: 6, h: 3 }),
          panel('third', { x: 4, y: 1, w: 4, h: 2 }),
        ],
      }),
      exercise: ({ panels }) => analyzeBoardLayout(panels),
      verify: (result) =>
        expect(result.issues).toEqual([
          expect.objectContaining({
            panelId: 'third',
            kind: 'overlap',
            conflictsWith: ['first', 'second'],
          }),
        ]),
    }),
  )

  test(
    'does not report unpositioned panels as repaired',
    mint({
      setup: () => ({ panels: [panel('implicit')] }),
      exercise: ({ panels }) => analyzeBoardLayout(panels),
      verify: (result) => expect(result.issues).toEqual([]),
    }),
  )

  test(
    'does not report the zero-size preserved-but-hidden sentinel as an issue',
    mint({
      setup: () => ({ panels: [panel('hidden', { x: 0, y: 0, w: 0, h: 0 })] }),
      exercise: ({ panels }) => analyzeBoardLayout(panels),
      verify: (result) => expect(result.issues).toEqual([]),
    }),
  )
})

describe('isZeroPosition', () => {
  test(
    'recognizes the zero-size preserved-but-hidden sentinel',
    mint({
      setup: () => ({ position: { x: 0, y: 0, w: 0, h: 0 } }),
      exercise: ({ position }) => isZeroPosition(position),
      verify: (result) => expect(result).toBe(true),
    }),
  )

  test(
    'does not mistake a rendered position for the hidden sentinel',
    mint({
      setup: () => ({ position: { x: 0, y: 0, w: 1, h: 1 } }),
      exercise: ({ position }) => isZeroPosition(position),
      verify: (result) => expect(result).toBe(false),
    }),
  )
})

describe('normalizeBoardLayout', () => {
  test(
    'normalizes an oversized rendered area into the twelve-by-twelve canvas',
    mint({
      setup: () => ({
        panels: [
          panel('build', { x: 0, y: 0, w: 8, h: 6 }),
          panel('version', { x: 8, y: 0, w: 4, h: 6 }),
          panel('treatments', { x: 0, y: 6, w: 12, h: 6 }),
          panel('review', { x: 0, y: 12, w: 12, h: 12 }),
        ],
      }),
      exercise: ({ panels }) => normalizeBoardLayout(panels),
      verify: (normalized) => {
        expect(normalized.map((item) => item.position)).toEqual([
          { x: 0, y: 0, w: 8, h: 3 },
          { x: 8, y: 0, w: 4, h: 3 },
          { x: 0, y: 3, w: 12, h: 3 },
          { x: 0, y: 6, w: 12, h: 6 },
        ])
      },
    }),
  )

  test(
    'moves later panels to the nearest legal cells after scaling',
    mint({
      setup: () => ({
        panels: [
          panel('first', { x: 0, y: 0, w: 8, h: 3 }),
          panel('second', { x: 4, y: 1, w: 8, h: 2 }),
        ],
      }),
      exercise: ({ panels }) => normalizeBoardLayout(panels),
      verify: (normalized) =>
        expect(normalized.map((item) => item.position)).toEqual([
          { x: 0, y: 0, w: 8, h: 3 },
          { x: 4, y: 3, w: 8, h: 2 },
        ]),
    }),
  )

  test(
    'zeroes a panel when no legal cell remains',
    mint({
      setup: () => ({
        panels: [
          panel('first', { x: 0, y: 0, w: 12, h: 12 }),
          panel('second', { x: 0, y: 0, w: 12, h: 12 }),
        ],
      }),
      exercise: ({ panels }) => normalizeBoardLayout(panels),
      verify: (normalized) =>
        expect(normalized.map((item) => item.position)).toEqual([
          { x: 0, y: 0, w: 12, h: 12 },
          { x: 0, y: 0, w: 0, h: 0 },
        ]),
    }),
  )
})

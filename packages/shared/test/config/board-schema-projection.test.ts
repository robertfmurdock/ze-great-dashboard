import { mint } from '@continuous-excellence/testmints-js/vitest'
import { describe, expect, test } from 'vitest'
import { serializeBoardConfigJsonSchema } from '../../src/board-config.ts'

describe('the published board schema projection', () => {
  test(
    'serializes deterministic editor metadata and field constraints without parser defaults',
    mint({
      setup: () => ({}),
      exercise: () => ({
        first: serializeBoardConfigJsonSchema(),
        second: serializeBoardConfigJsonSchema(),
      }),
      verify: ({ first, second }) => {
        expect(second).toBe(first)
        const schema = JSON.parse(first)
        expect(schema).toMatchObject({
          $schema: 'https://json-schema.org/draft/2020-12/schema',
          $id: 'board-config.schema.json',
          title: 'Ze Great Dashboard board configuration',
          'x-dashboard-runtime-rules': expect.arrayContaining([
            expect.objectContaining({ category: 'unique-panel-and-fact-ids' }),
            expect.objectContaining({ category: 'panel-source-relationships' }),
          ]),
          properties: {
            security: { enum: ['warn', 'required', 'unsecured'] },
            boards: {
              additionalProperties: {
                properties: {
                  panels: {
                    items: {
                      properties: {
                        facts: {
                          items: { properties: { link: { type: 'string', format: 'uri' } } },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
        })
        expect(first).not.toMatch(/"default"\s*:/)
        expect(first).not.toMatch(/gitlab\.com/i)
      },
    }),
  )
})

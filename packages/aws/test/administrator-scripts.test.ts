import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { mint } from '@continuous-excellence/testmints-js/vitest'
import { describe, expect, it } from 'vitest'

describe('administrator shell syntax', () => {
  for (const script of [
    'scripts/deploy-reference-composition.sh',
    'scripts/test-ecs-image.sh',
    'scripts/repair-consumer-bootstrap-validation.sh',
  ])
    it(
      `parses ${script} with bash`,
      mint({
        setup: () => ({ path: fileURLToPath(new URL(`../../../${script}`, import.meta.url)) }),
        exercise: ({ path }) => spawnSync('bash', ['-n', path], { encoding: 'utf8' }),
        verify: (result) => {
          expect(result.status).toBe(0)
          expect(result.stderr).toBe('')
        },
      }),
    )
})

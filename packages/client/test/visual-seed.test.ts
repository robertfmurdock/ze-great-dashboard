import { describe, expect, it } from 'vitest'
import { visualSeed } from '../src/visual-seed.ts'

describe('visualSeed', () => {
  it('is stable per panel id while preserving deterministic variation', () => {
    expect(visualSeed('build')).toBe(visualSeed('build'))
    expect(visualSeed('build')).not.toBe(visualSeed('deploy'))
  })
})

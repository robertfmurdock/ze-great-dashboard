import { mint } from '@continuous-excellence/testmints-js/vitest'
import { describe, expect, test } from 'vitest'
import { readClientEnv } from '../src/client-env.ts'

const valid = {
  assetPath: 'https://assets.example.com/dashboard/1.0.7',
  assetPathId: 'sha256:3f454a601d3791a603e550652cec7ca1fb4359489df99605e72e051dd5b02731',
  proxyPath: '/api',
  board: 'ze-great-team',
}

describe('reading window.env', () => {
  describe('accepting injected configuration', () => {
    test(
      'accepts the unauthenticated block the server injects',
      mint({
        setup: () => ({ source: valid }),
        exercise: ({ source }) => readClientEnv(source),
        verify: (environment, { source }) => {
          expect(environment).toEqual(source)
          expect(environment.auth).toBeUndefined()
        },
      }),
    )

    test(
      'accepts an auth block when present',
      mint({
        setup: () => ({
          source: {
            ...valid,
            auth: {
              issuer: 'https://login.example.com',
              clientId: 'dashboard',
              audience: 'https://dashboard-api',
            },
          },
        }),
        exercise: ({ source }) => readClientEnv(source),
        verify: (environment, { source }) => expect(environment.auth).toEqual(source.auth),
      }),
    )

    for (const security of ['warning', 'blocked'] as const) {
      test(
        `accepts the public ${security} security boundary state`,
        mint({
          setup: () => ({ source: { ...valid, security } }),
          exercise: ({ source }) => readClientEnv(source),
          verify: (environment, { source }) => expect(environment.security).toBe(source.security),
        }),
      )
    }
  })

  describe('rejecting unusable configuration', () => {
    test(
      'explains itself when configuration never arrived',
      mint({
        // The alternative is a blank board, which for a trust radiator is the worst outcome.
        setup: () => ({ source: undefined }),
        exercise: throws(({ source }) => readClientEnv(source)),
        verify: (error) => {
          expect(error).toBeInstanceOf(Error)
          expect((error as Error).message).toMatch(/window\.env is missing or invalid/)
        },
      }),
    )

    test(
      'identifies the missing asset path in incomplete configuration',
      mint({
        setup: () => ({ source: { proxyPath: '/api' } }),
        exercise: throws(({ source }) => readClientEnv(source)),
        verify: (error) => {
          expect(error).toBeInstanceOf(Error)
          expect((error as Error).message).toMatch(/assetPath/)
        },
      }),
    )
  })
})

/** Captures expected synchronous failure as Testmints exercise output for verification. */
function throws<Input>(exercise: (input: Input) => unknown) {
  return (input: Input) => {
    try {
      exercise(input)
    } catch (error) {
      return error
    }
    throw new Error('Expected the exercise to throw.')
  }
}

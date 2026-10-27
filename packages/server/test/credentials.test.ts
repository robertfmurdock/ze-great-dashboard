import { mint } from '@continuous-excellence/testmints-js/vitest'
import { describe, expect, test, vi } from 'vitest'
import { createCredentialResolver, parseCredentialMap } from '../src/credentials.ts'

describe('credential map parsing', () => {
  test(
    'accepts a JSON object with non-empty string credential values',
    mint({
      setup: () => ({ credentialMap: '{"GITHUB_TOKEN":"token"}' }),
      exercise: ({ credentialMap }) => parseCredentialMap(credentialMap),
      verify: (credentials) => {
        expect(credentials).toEqual({ GITHUB_TOKEN: 'token' })
      },
    }),
  )

  for (const { name, value } of [
    { name: 'is absent', value: undefined },
    { name: 'is not JSON', value: 'not json' },
    { name: 'is an array', value: '[]' },
    { name: 'has an empty credential value', value: '{"GITHUB_TOKEN":""}' },
    { name: 'has a non-string credential value', value: '{"GITHUB_TOKEN":1}' },
  ] as const) {
    test(
      `rejects a credential map that ${name}`,
      mint({
        setup: () => ({ credentialMap: value }),
        exercise: throws(({ credentialMap }) => parseCredentialMap(credentialMap)),
        verify: (error) => {
          expect(error).toMatchObject({
            message: 'Credential reference must be a JSON object of non-empty string values',
          })
        },
      }),
    )
  }
})

describe('remote credential resolution', () => {
  test(
    'loads only the configured names from one secret map',
    mint({
      setup: () => {
        const send = vi.fn(async () => ({
          SecretString: '{"GITHUB_TOKEN":"private","UNUSED":"x"}',
        }))
        return {
          send,
          options: {
            secretReference: 'arn:aws:secretsmanager:region:account:secret:credentials',
            credentialNames: ['GITHUB_TOKEN'],
            secretsManager: { send },
          },
        }
      },
      exercise: ({ options }) => createCredentialResolver(options),
      verify: (credentials, { send }) => {
        expect(credentials.get('GITHUB_TOKEN')).toBe('private')
        expect(credentials.get('UNUSED')).toBeUndefined()
        expect(send).toHaveBeenCalledTimes(1)
      },
    }),
  )

  test(
    'loads a SecureString parameter map with decryption',
    mint({
      setup: () => {
        const send = vi.fn(async () => ({ Parameter: { Value: '{"GITHUB_TOKEN":"private"}' } }))
        return {
          send,
          options: {
            secretReference: 'arn:aws:ssm:region:account:parameter/dashboard/credentials',
            credentialNames: ['GITHUB_TOKEN'],
            parameterStore: { send },
          },
        }
      },
      exercise: ({ options }) => createCredentialResolver(options),
      verify: (credentials, { send }) => {
        expect(credentials.get('GITHUB_TOKEN')).toBe('private')
        expect(send).toHaveBeenCalledWith(
          expect.objectContaining({
            input: {
              Name: 'arn:aws:ssm:region:account:parameter/dashboard/credentials',
              WithDecryption: true,
            },
          }),
        )
      },
    }),
  )

  test(
    'fails closed when a credential reference omits a configured key',
    mint({
      setup: () => ({
        options: {
          secretReference: 'arn:aws:secretsmanager:region:account:secret:credentials',
          credentialNames: ['GITHUB_TOKEN'],
          secretsManager: { send: async () => ({ SecretString: '{"OTHER":"private-value"}' }) },
        },
      }),
      exercise: rejects(({ options }) => createCredentialResolver(options)),
      verify: (error) => {
        expect(error).toMatchObject({
          message: 'Credential reference is missing configured keys: GITHUB_TOKEN',
        })
      },
    }),
  )

  test(
    'fails closed without exposing a credential value when the reference cannot be read',
    mint({
      setup: () => ({
        options: {
          secretReference: 'arn:aws:secretsmanager:region:account:secret:credentials',
          credentialNames: ['GITHUB_TOKEN'],
          secretsManager: {
            send: async () => Promise.reject(new Error('access denied: private-value')),
          },
        },
      }),
      exercise: rejects(({ options }) => createCredentialResolver(options)),
      verify: (error) => {
        expect(error).toMatchObject({
          message: 'Unable to read credential reference for configured keys: GITHUB_TOKEN',
        })
        expect(String(error)).not.toContain('private-value')
      },
    }),
  )
})

describe('environment credential resolution', () => {
  test(
    'preserves environment credentials when no secret ARN is configured',
    mint({
      setup: () => ({
        options: {
          credentialNames: ['GITHUB_TOKEN'],
          env: { GITHUB_TOKEN: 'local-token' },
        },
      }),
      exercise: ({ options }) => createCredentialResolver(options),
      verify: (credentials) => {
        expect(credentials.get('GITHUB_TOKEN')).toBe('local-token')
      },
    }),
  )
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

/** Captures expected asynchronous failure as Testmints exercise output for verification. */
function rejects<Input, Output>(exercise: (input: Input) => Promise<Output>) {
  return async (input: Input): Promise<unknown> => {
    try {
      await exercise(input)
    } catch (error) {
      return error
    }
    throw new Error('Expected the exercise to reject.')
  }
}

import assert from 'node:assert/strict'
import { mint } from '@continuous-excellence/testmints-js/vitest'
import { test } from 'vitest'
import { auth0FunctionalInfrastructure, auth0ReaderRoleArn } from './auth0-functional-config.mjs'
import { classifyAwsFailure, resolveAuth0FunctionalEnvironment } from './auth0-functional-env.mjs'

const values = {
  AUTH0_FUNCTIONAL_TEST_RUNNER_CLIENT_SECRET: 'runner-secret',
  AUTH0_FUNCTIONAL_ALLOWED_PASSWORD: 'allowed-password',
  AUTH0_FUNCTIONAL_UNLISTED_PASSWORD: 'unlisted-password',
}

test(
  'reads the exact parameter through the current identity',
  mint({
    setup: () => {
      const calls = []
      return {
        calls,
        options: {
          environment: {},
          execute: async (_file, args) => {
            calls.push(args)
            return JSON.stringify(values)
          },
        },
      }
    },
    exercise: ({ options }) => resolveAuth0FunctionalEnvironment(options),
    verify: (result, { calls }) => {
      assert.equal(result.source, 'ssm')
      assert.ok(calls[0].includes(auth0FunctionalInfrastructure.parameterName))
    },
  }),
)

test(
  'assumes the fixed reader role after direct access fails',
  mint({
    setup: () => {
      const calls = []
      const credentials = ['access', 'secret', 'token']
      return {
        calls,
        credentials,
        options: {
          environment: { AWS_PROFILE: 'local-sso' },
          execute: async (_file, args, environment) => {
            calls.push({ args, environment })
            if (calls.length === 1) throw new Error('denied')
            if (args[0] === 'sts') return JSON.stringify(credentials)
            return JSON.stringify(values)
          },
        },
      }
    },
    exercise: ({ options }) => resolveAuth0FunctionalEnvironment(options),
    verify: (result, { calls, credentials, options }) => {
      assert.equal(result.source, 'assumed-role')
      assert.equal(calls[1].environment.AWS_PROFILE, options.environment.AWS_PROFILE)
      const roleIndex = calls[1].args.indexOf('--role-arn')
      assert.ok(roleIndex >= 0)
      assert.equal(calls[1].args[roleIndex + 1], auth0ReaderRoleArn)
      assert.equal(calls[2].environment.AWS_ACCESS_KEY_ID, credentials[0])
      assert.equal(calls[2].environment.AWS_SESSION_TOKEN, credentials[2])
    },
  }),
)

for (const [name, parameter] of [
  ['malformed JSON', 'not-json'],
  ['incomplete JSON', '{"AUTH0_FUNCTIONAL_ALLOWED_PASSWORD":"private-value"}'],
]) {
  test(
    `${name} is reported directly without attempting role assumption`,
    mint({
      setup: () => {
        const calls = []
        return {
          calls,
          options: {
            environment: {},
            execute: async (...args) => {
              calls.push(args)
              return parameter
            },
          },
        }
      },
      exercise: ({ options }) => resolveAuth0FunctionalEnvironment(options),
      verify: (result, { calls }) => {
        assert.equal(result.available, false)
        assert.equal(calls.length, 1)
        assert.match(result.reason, /SSM parameter/)
        assert.doesNotMatch(result.reason, /private-value/)
      },
    }),
  )
}

async function resolveFailure(options) {
  try {
    await resolveAuth0FunctionalEnvironment(options)
  } catch (error) {
    return error
  }
  throw new Error('Expected Auth0 credential discovery to reject.')
}

test(
  'malformed retrieved data fails directly in strict mode',
  mint({
    setup: () => ({ environment: {}, execute: async () => 'not-json', strict: true }),
    exercise: resolveFailure,
    verify: (error) => assert.match(error.message, /not valid JSON/),
  }),
)

function unavailableFixture(strict) {
  const diagnostic = 'credential-value-that-must-not-leak'
  return {
    diagnostic,
    options: {
      environment: {},
      strict,
      execute: async () => {
        throw new Error(diagnostic)
      },
    },
  }
}

test(
  'unavailable credentials skip local execution without exposing diagnostics',
  mint({
    setup: () => unavailableFixture(false),
    exercise: ({ options }) => resolveAuth0FunctionalEnvironment(options),
    verify: (result, { diagnostic }) => {
      assert.equal(result.available, false)
      assert.ok(!result.reason.includes(diagnostic))
    },
  }),
)

test(
  'unavailable credentials fail strict execution without exposing diagnostics',
  mint({
    setup: () => unavailableFixture(true),
    exercise: ({ options }) => resolveFailure(options),
    verify: (error, { diagnostic }) => {
      assert.match(error.message, /credentials are unavailable/)
      assert.ok(!error.message.includes(diagnostic))
    },
  }),
)

test(
  'reports which safe discovery stages failed without exposing command diagnostics',
  mint({
    setup: () => {
      const principal = 'principal-secret'
      const session = 'session-secret'
      return {
        principal,
        session,
        options: {
          environment: {},
          execute: async (_file, args) => {
            if (args[0] === 'ssm') throw new Error(`${principal}: AccessDeniedException`)
            throw new Error(`${session}: expired`)
          },
        },
      }
    },
    exercise: ({ options }) => resolveAuth0FunctionalEnvironment(options),
    verify: (result, { principal, session }) => {
      assert.equal(
        result.reason,
        'Auth0 endpoint credentials are unavailable: direct parameter read failed; reader role assumption failed.',
      )
      assert.ok(!result.reason.includes(principal))
      assert.ok(!result.reason.includes(session))
    },
  }),
)

test(
  'classifies AWS access denial without returning the session name',
  mint({
    setup: () => {
      const session = 'private-session'
      return {
        session,
        diagnostic: `AccessDeniedException for arn:aws:sts::174159267544:assumed-role/${session}`,
      }
    },
    exercise: ({ diagnostic }) => classifyAwsFailure({}, diagnostic),
    verify: (classification, { session }) => {
      assert.equal(classification, 'was denied')
      assert.ok(!classification.includes(session))
    },
  }),
)

test(
  'classifies a missing AWS CLI executable',
  mint({
    setup: () => ({ code: 'ENOENT' }),
    exercise: (error) => classifyAwsFailure(error, ''),
    verify: (classification) => assert.equal(classification, 'could not run the AWS CLI'),
  }),
)

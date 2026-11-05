import assert from 'node:assert/strict'
import test from 'node:test'
import { auth0FunctionalInfrastructure, auth0ReaderRoleArn } from './auth0-functional-config.mjs'
import { classifyAwsFailure, resolveAuth0FunctionalEnvironment } from './auth0-functional-env.mjs'

const values = {
  AUTH0_FUNCTIONAL_TEST_RUNNER_CLIENT_SECRET: 'runner-secret',
  AUTH0_FUNCTIONAL_ALLOWED_PASSWORD: 'allowed-password',
  AUTH0_FUNCTIONAL_UNLISTED_PASSWORD: 'unlisted-password',
}

test('reads the exact parameter through the current identity', async () => {
  const calls = []
  const result = await resolveAuth0FunctionalEnvironment({
    environment: {},
    execute: async (_file, args) => {
      calls.push(args)
      return JSON.stringify(values)
    },
  })
  assert.equal(result.source, 'ssm')
  assert.ok(calls[0].includes(auth0FunctionalInfrastructure.parameterName))
})

test('assumes the fixed reader role after direct access fails', async () => {
  const calls = []
  const environment = { AWS_PROFILE: 'local-sso' }
  let call = 0
  const result = await resolveAuth0FunctionalEnvironment({
    environment,
    execute: async (_file, args, environment) => {
      calls.push({ args, environment })
      call += 1
      if (call === 1) throw new Error('denied')
      if (args[0] === 'sts') return '["access","secret","token"]'
      return JSON.stringify(values)
    },
  })
  assert.equal(result.source, 'assumed-role')
  assert.equal(calls[1].environment.AWS_PROFILE, environment.AWS_PROFILE)
  const roleIndex = calls[1].args.indexOf('--role-arn')
  assert.ok(roleIndex >= 0)
  assert.equal(calls[1].args[roleIndex + 1], auth0ReaderRoleArn)
  assert.equal(calls[2].environment.AWS_ACCESS_KEY_ID, 'access')
  assert.equal(calls[2].environment.AWS_SESSION_TOKEN, 'token')
})

for (const [name, parameter] of [
  ['malformed JSON', 'not-json'],
  ['incomplete JSON', '{"AUTH0_FUNCTIONAL_ALLOWED_PASSWORD":"private-value"}'],
]) {
  test(`${name} is reported directly without attempting role assumption`, async () => {
    let calls = 0
    const result = await resolveAuth0FunctionalEnvironment({
      environment: {},
      execute: async () => {
        calls += 1
        return parameter
      },
    })
    assert.equal(result.available, false)
    assert.equal(calls, 1)
    assert.match(result.reason, /SSM parameter/)
    assert.doesNotMatch(result.reason, /private-value/)
  })
}

test('malformed retrieved data fails directly in strict mode', async () => {
  await assert.rejects(
    resolveAuth0FunctionalEnvironment({
      environment: {},
      execute: async () => 'not-json',
      strict: true,
    }),
    /not valid JSON/,
  )
})

test('missing AWS or access denial skips locally but fails in strict mode', async () => {
  const execute = async () => {
    throw new Error('credential-value-that-must-not-leak')
  }
  const skipped = await resolveAuth0FunctionalEnvironment({ environment: {}, execute })
  assert.equal(skipped.available, false)
  assert.doesNotMatch(skipped.reason, /credential-value/)
  await assert.rejects(
    resolveAuth0FunctionalEnvironment({ environment: {}, execute, strict: true }),
    (error) => {
      assert.match(error.message, /credentials are unavailable/)
      assert.doesNotMatch(error.message, /credential-value/)
      return true
    },
  )
})

test('reports which safe discovery stages failed without exposing command diagnostics', async () => {
  const result = await resolveAuth0FunctionalEnvironment({
    environment: {},
    execute: async (_file, args) => {
      if (args[0] === 'ssm') throw new Error('principal-secret: AccessDeniedException')
      throw new Error('session-secret: expired')
    },
  })
  assert.equal(
    result.reason,
    'Auth0 endpoint credentials are unavailable: direct parameter read failed; reader role assumption failed.',
  )
  assert.doesNotMatch(result.reason, /principal-secret|session-secret/)
})

test('classifies AWS CLI diagnostics without returning their potentially sensitive text', () => {
  const diagnostic =
    'AccessDeniedException for arn:aws:sts::174159267544:assumed-role/private-session'
  const classification = classifyAwsFailure({}, diagnostic)
  assert.equal(classification, 'was denied')
  assert.doesNotMatch(classification, /private-session/)
  assert.equal(classifyAwsFailure({ code: 'ENOENT' }, ''), 'could not run the AWS CLI')
})

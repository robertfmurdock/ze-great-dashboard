import assert from 'node:assert/strict'
import test from 'node:test'
import { auth0FunctionalEnvironment } from './auth0-functional-env.mjs'

test('requires every explicit Auth0 functional credential without disclosing values', () => {
  assert.throws(
    () =>
      auth0FunctionalEnvironment({
        AUTH0_FUNCTIONAL_TEST_RUNNER_CLIENT_SECRET: 'runner-secret',
        AUTH0_FUNCTIONAL_ALLOWED_PASSWORD: 'allowed-password',
      }),
    (error) => {
      assert.match(error.message, /AUTH0_FUNCTIONAL_UNLISTED_PASSWORD/)
      assert.doesNotMatch(error.message, /runner-secret/)
      return true
    },
  )
})

test('uses checked-in non-secret identifiers and retains passwords only in the returned capability', () => {
  const environment = {
    AUTH0_FUNCTIONAL_TEST_RUNNER_CLIENT_SECRET: 'runner-secret',
    AUTH0_FUNCTIONAL_ALLOWED_PASSWORD: 'allowed-password',
    AUTH0_FUNCTIONAL_UNLISTED_PASSWORD: 'unlisted-password',
  }
  const result = auth0FunctionalEnvironment(environment)
  assert.equal(result.allowedUser.login, 'ze-great-dashboard-test@continuousexcellence.io')
  assert.equal(result.allowedUser.password, 'allowed-password')
})

const REQUIRED = [
  'AUTH0_FUNCTIONAL_TEST_RUNNER_CLIENT_SECRET',
  'AUTH0_FUNCTIONAL_ALLOWED_PASSWORD',
  'AUTH0_FUNCTIONAL_UNLISTED_PASSWORD',
]

/**
 * Pulls only the values the runner needs, so accidental ambient Auth0 credentials cannot change
 * which tenant is mutated. Errors name variables but never repeat their values.
 */
export function auth0FunctionalEnvironment(environment = process.env) {
  const missing = REQUIRED.filter((name) => !environment[name]?.trim())
  if (missing.length > 0) throw new Error(`Auth0 functional test requires: ${missing.join(', ')}.`)

  return {
    testRunner: {
      clientSecret: environment.AUTH0_FUNCTIONAL_TEST_RUNNER_CLIENT_SECRET,
    },
    allowedUser: {
      login: functionalAuth0.allowedLogin,
      password: environment.AUTH0_FUNCTIONAL_ALLOWED_PASSWORD,
    },
    unlistedUser: {
      login: functionalAuth0.unlistedLogin,
      password: environment.AUTH0_FUNCTIONAL_UNLISTED_PASSWORD,
    },
  }
}

export const functionalAuth0 = {
  domain: 'zegreatrob.us.auth0.com',
  audience: 'ze-great-dashboard-test-api',
  connection: 'Username-Password-Authentication',
  testRunnerClientId: 'HdfdNR0ac5lxII2G3gbM9tTnkxexYtog',
  allowedUsername: 'dashboard-test',
  allowedLogin: 'ze-great-dashboard-test@continuousexcellence.io',
  unlistedUsername: 'dashboard-test2',
  unlistedLogin: 'ze-great-dashboard-test-2@continuousexcellence.io',
  board: 'functional',
}

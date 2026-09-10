export const auth0FunctionalInfrastructure = {
  accountId: '174159267544',
  region: 'us-east-1',
  parameterName: '/ze-great-dashboard/auth0-functional',
  readerRoleName: 'ZeGreatDashboardAuth0FunctionalReader',
}

export const auth0ReaderRoleArn = `arn:aws:iam::${auth0FunctionalInfrastructure.accountId}:role/${auth0FunctionalInfrastructure.readerRoleName}`

export const auth0CredentialNames = [
  'AUTH0_FUNCTIONAL_TEST_RUNNER_CLIENT_SECRET',
  'AUTH0_FUNCTIONAL_ALLOWED_PASSWORD',
  'AUTH0_FUNCTIONAL_UNLISTED_PASSWORD',
]

export const functionalAuth0 = {
  domain: 'zegreatrob.us.auth0.com',
  audience: 'ze-great-dashboard-test-api',
  connection: 'Username-Password-Authentication',
  testRunnerClientId: 'HdfdNR0ac5lxII2G3gbM9tTnkxexYtog',
  allowedLogin: 'ze-great-dashboard-test@continuousexcellence.io',
  unlistedLogin: 'ze-great-dashboard-test-2@continuousexcellence.io',
  board: 'functional',
}

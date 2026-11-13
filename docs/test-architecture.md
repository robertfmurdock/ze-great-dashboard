# Test architecture

The dashboard uses tests as release evidence. A change to application code or a direct npm
dependency should either preserve the supported behavior or fail at a boundary that exposes the
regression. The suites exercise source modules, the assembled dashboard, and the artifacts a
consumer installs or deploys. The [contributor guide](contributing.md) covers setup and commands.

## Choosing a test boundary

| Behavior under test                              | What runs                                                                                                                                                                                                                                                                                                                           | Where to look                                                                                                                    |
| ------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| Configuration, layout, and public data contracts | Vitest in Node exercises shared parsers and serializers, layout resolution, and signal envelopes. Core tests cover package behavior.                                                                                                                                                                                                | [Shared tests](../packages/shared/test/), [core tests](../packages/core/test/)                                                   |
| Adapters and server request handling             | Vitest runs real adapter or Hono app code in process. Injected fetchers control upstream responses. Hono's request interface exercises routing, authorization, and response contracts without a listening server. The pipeline conformance suite reuses scenarios across providers.                                                 | [Server tests](../packages/server/test/), [pipeline conformance](../packages/server/test/pipeline-adapter-contract.test.ts)      |
| Client state and component behavior              | Vitest uses happy-dom for the client project. React Testing Library renders components and hooks, with user-event for interactions and controlled time for polling and expiry. App tests cover composition.                                                                                                                         | [Vitest projects](../vitest.config.ts), [client tests](../packages/client/test/)                                                 |
| AWS tooling and repository scripts               | Vitest covers AWS configuration, bootstrap, CLI behavior, and generated deployment artifacts. Node's test runner covers selected repository tools, including check orchestration, Auth0 environment resolution, and test-summary generation in the gate.                                                                            | [AWS tests](../packages/aws/test/), [check entry point](../scripts/check.mjs)                                                    |
| Browser and hosted behavior                      | Playwright drives Chromium against local fixtures serving built assets and running dashboard servers. It checks production startup and asset version changes, layout and interactions, motion, and OIDC session behavior against a fixture identity provider. Hosted scenarios also make HTTP requests through the packaged server. | [Browser specs](../e2e/), [browser fixture](../scripts/browser-fixture.mjs)                                                      |
| Packaged server over HTTP                        | A separate container check starts the packaged server against fixture asset and upstream origins and calls it over HTTP. With Auth0 credentials, it also exercises provider-issued tokens.                                                                                                                                          | [Container endpoint runner](../scripts/container-endpoint.mjs), [endpoint scenarios](../scripts/container-endpoint-fixtures.mjs) |
| Consumer package and deployment interfaces       | The package smoke test stages release contents and exercises packaged configuration, the AWS CLI, and release assembly. CI adds checks with the exact candidate tarballs and image.                                                                                                                                                 | [Package smoke runner](../scripts/test-published-packages.mjs), [Build workflow](../.github/workflows/main.yml)                  |

Choose the narrowest boundary that observes the whole contract. For example, use a hook test
for polling state, a request-level test for the server's response, and Chromium when the
behavior depends on layout, animation, or browser session handling. A passing hook test cannot
establish that the built client loads against a deployed asset origin. The hosted checks
exercise that boundary with distinct versioned client fixtures and real HTTP requests.

## Scenario design

[Repository guidance](../AGENTS.md) defines how to change tests. New and changed Vitest
scenarios use Testmints `mint` with ordinary Vitest suites and lifecycle hooks. Setup arranges
scenario-owned data and collaborators. Exercise visibly calls the subject. Verify checks its
observable result, including collaborator calls where those are part of the contract. Related
observations belong to the same execution. Playwright and Node scripts keep their native
runner APIs.

For a regression, run the smallest meaningful reproduction against the prior behavior before
changing production code. For a new or materially changed contract, demonstrate that the test
catches a concrete broken implementation, using prior behavior or a reversible fault where
practical. Confirm that the intended assertion fails. When the original environment cannot
be reproduced, record the missing condition and the closest representative evidence.

## Local and CI execution

- `npm run check` starts lint, typechecking, the package build, the container endpoint check,
  the standalone Lambda build, and Node tests independently. Vitest, Playwright, example-board CLI
  validation, and the package smoke test depend on the shared build. The package smoke stage consumes a fixed
  test release version. [Stage graph](../scripts/check.mjs)
- The installed pre-commit hook and CI invoke `npm run check`. `npm run verify` is an alias.
  [Commands](../package.json) and [hook](../.githooks/pre-commit)
- `npm run test:unit` and `npm run test:browser` are narrower entry points that build their
  prerequisites. Their `no-build` variants reuse existing artifacts. The standalone unit script
  and the gate use the same Node test list. [Node suite list](../scripts/node-test-files.mjs),
  [commands](../package.json), and [gate](../scripts/check.mjs)
- Browser checks use a Docker-hosted Playwright browser by default. A contributor with a
  native Playwright installation can set `PLAYWRIGHT_DOCKER=0`. The packaged endpoint check
  still uses Docker. CI runs the gate on Node 24 with npm 11.19.0. [Browser runner](../scripts/test-browser.mjs)
  and [Build workflow](../.github/workflows/main.yml)

## Provider and release evidence

The Build workflow requires credential-backed Auth0 checks on trusted `main` and explicitly
skips that portion on other refs. Fixture-backed endpoint and OIDC browser scenarios still
run there. The live browser case starts with a freshly minted Auth0 token, so it establishes
token acceptance through the packaged dashboard. The fixture OIDC suite separately exercises
session restoration, expiry recovery, and sign-out. [Auth0 browser case](../e2e/auth0-token.spec.ts)
and [OIDC session scenarios](../e2e/oidc-session.spec.ts)

For a non-snapshot main release, CI builds exact-version npm tarballs and a candidate Docker
image. It installs the candidate AWS tarball into a consumer directory, checks a deployed
reference composition, validates ECS packaging and runs an ephemeral Docker smoke test against
the candidate image. A separate job installs the same AWS tarball for consumer bootstrap
validation and deploys a source-free reference board. The release job publishes the saved
tarballs and promotes the verified image to `latest`. Automated dependency PRs use the normal
Build workflow and required branch checks. [Build workflow](../.github/workflows/main.yml) and
[dependency workflow](../.github/workflows/dependency-update.yml)

## Reports

The check runner writes stage results and available runner reports under `check-results/`.
CI publishes the Markdown stage summary and uploads that directory as `check-evidence`.
It also generates a bounded `test-summary.json` and uploads it separately as `ci-evidence`
for the dashboard's test-count reader. Use the stage results and raw runner reports to
investigate a failed gate. The public CDN startup scenario retains a Playwright trace on failure.
[Public startup spec](../e2e/client-startup.spec.ts), [check runner](../scripts/check-runner.mjs),
[summary generator](../scripts/test-summary.mjs), and [artifact upload](../.github/workflows/main.yml)

## Auth and packaging boundaries

- In-process Hono tests own authorization decisions and check that denied requests cause no upstream
  access. Hosted HTTP tests own hostname exposure, forwarded-host handling, and a representative
  missing and malformed bearer check through the packaged host. Both authorized reads remain in the
  shared-policy scenario because the contract spans two boards. [Hono auth](../packages/server/test/api-auth.test.ts)
  and [hosted deployments](../e2e/hosted-deployments.spec.ts)
- The fixture OIDC browser tests own session transitions. The credential-backed container checks
  exercise provider-issued tokens through the packaged API, including denied upstream access.
  The credential-backed browser startup case owns rendering with a provider-issued token.
  [OIDC sessions](../e2e/oidc-session.spec.ts), [container checks](../scripts/container-endpoint-fixtures.mjs),
  and [Auth0 browser case](../e2e/auth0-token.spec.ts)
- The staged-package check owns the publication surface and exercises generated release files and
  packaged configuration before merge. The installed-package command owns npm installation and
  invocation through the installed binary. The release workflow installs the exact candidate and
  deploys the generated composition to establish that AWS accepts it and the reference runs.
  [Staged package](../scripts/test-published-packages.mjs), [installed package](../scripts/test-installed-package.mjs),
  and [release workflow](../.github/workflows/main.yml)

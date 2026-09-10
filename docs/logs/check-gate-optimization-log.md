# Check gate optimization

Recorded 2026-08-26.

The repository-wide `npm run check` gate was retaining all of its validation layers while removing
one confirmed duplicate build. Previously, `test:unit` ran `build:packages`, which already built the
client, and the subsequent browser test invoked the client `test:browser` script, which ran a second
Vite build before starting Playwright.

The client now has two browser-test paths:

- `test:browser` remains self-contained for standalone use: it builds the client and then runs the
  browser tests.
- `test:browser:no-build` runs only Playwright against an existing client build.

The root test sequence runs `test:unit` followed by the root `test:browser:no-build` path. The shared
browser wrapper still owns Playwright Docker startup, signal forwarding, and cleanup; it selects the
client path through an explicit `--no-build` option. This keeps standalone safety while allowing the
aggregate gate to reuse the build it has already produced.

Nothing else was removed from `check`: lint, all TypeScript checks, Vitest unit tests, Playwright
browser tests, the Docker image healthcheck, built CLI board validation, and published-package
staging and consumer smoke tests remain covered. No dependencies were added.

The governing philosophy is a single, unified check gate to maximize consistency, paired with design
pressure to optimize the process and ensure tests add real value rather than filler. In this change,
that meant measuring the command graph, removing only the redundant client build, and preserving the
standalone browser command and every distinct validation layer.

Verification: `npm run check` passed with lint, six TypeScript projects, 241 unit tests, 9 browser
tests, the Docker healthcheck, example-board validation, and published-package smoke tests.

Recorded 2026-09-10.

`npm run check` now has a small Node coordinator with one explicit, validated dependency graph.
Lint, the existing concurrent TypeScript batch, package build, and packaged-container endpoint
evidence start independently. The no-build unit suite, no-build browser suite, and example-board
CLI validation wait for package artifacts; published-package staging waits until every artifact
consumer has completed because it intentionally rewrites package outputs. The standalone unit and
browser commands still build what they need, so this optimization does not make focused use unsafe.

The coordinator has no user-configurable graph, retries, cache, shell execution, or new dependency.
It validates IDs, argument vectors, dependencies, and cycles before spawning anything; child output
is held in private temporary logs to prevent concurrent interleaving. A failed prerequisite blocks
only its dependents while independent active work is allowed to finish. Spawn errors, nonzero exits,
and child signal termination fail closed. `SIGINT` and `SIGTERM` stop scheduling, reach active
children, drain their cleanup, print the fixed-order ledger, and return their conventional nonzero
status.

Subprocess tests exercise those contracts through real child processes, including graph validation,
concurrent starts, grouped diagnostics, failure blocking, independent completion, spawn and child
signal failures, and interrupt forwarding. The gate retains all prior release evidence; no package
was added. On this checkout, the serial-equivalent stages took 44.1 seconds in aggregate and the
concurrent gate took 28.3 seconds. That comparison is a measured result, not a target that permits
removing evidence; Docker cache warmth can move either wall-clock number.

Recorded 2026-09-10 (clarification).

The initial coordinator version still allowed the published-package smoke test to invoke its own
package builds, including while preparing its tarball cases. That contradicted the graph's stated
single-producer intent and unnecessarily put publication after every artifact consumer. The package
build stage now runs once at the beginning with the smoke test's deterministic `9.8.7` release
value. `test:published:no-build` consumes those completed artifacts and stages only temporary
publication files, so it can run immediately after `build-packages` alongside the unit, browser,
board-validation, and container evidence. Standalone `test:published` remains self-contained: its
first staging command builds once, then its remaining tarball scenarios reuse the result.

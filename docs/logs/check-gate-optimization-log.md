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

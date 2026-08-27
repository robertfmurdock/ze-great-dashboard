# Contributing

## Prerequisites

Use Node.js 22+ and npm 11+.

## Local development

```sh
git clone https://github.com/robertfmurdock/ze-great-dashboard.git
cd ze-great-dashboard
npm install
npm run dev
```

Use a local board file when needed:

```sh
BOARD_CONFIG_URL="$PWD/boards/ze-great-team.yaml" npm run dev
```

## Quality gate

Run the full repository gate before handing off work:

```sh
npm run check
```

| Command | Purpose |
| --- | --- |
| `npm run dev` | Start the client and server development loop. |
| `npm run check` | Lint, typecheck, test, validate the example board, and test the published package. |
| `npm run test:watch` | Run unit tests in watch mode. |
| `npm run build` | Build the production client. |
| `npm run format` | Apply Biome formatting fixes. |
| `docker compose up` | Run the published GHCR server image against a published asset path. |
| `docker compose -f docker-compose.yml -f docker-compose.local.yml up --build` | Build and run the current source locally. |

Contributions must pass `npm run check`. New dependencies need a clear justification: the project
deliberately keeps its dependency surface small.

## Container image

The Dockerfile deliberately splits the build and runtime concerns. An Alpine Node 24 builder runs
the existing `esbuild` dependency and emits one standalone server bundle; the production image is
the free, shell-free Google Distroless Node 24 Debian 13 `nonroot` image and contains only that
bundle and the board files. This keeps npm, `tsx`, source files, and build-time dependencies out of
the deployed image without adding a dependency to the repository.

Both base images are pinned to reviewed multi-architecture manifest SHA256 digests. A digest update
is therefore an intentional review of the builder and runtime release pair, rather than an
automatic tag refresh.

## Regression and compatibility testing

Treat existing tests as contracts for previous defaults and behavior. When adding a feature, prefer
adding new tests over editing existing tests, so the old behavior remains visibly defended. New
board-format fields should have both feature coverage and a legacy-shape test proving that the field's
absence still behaves as before.

If a behavior must intentionally change, keep an explicit test for the prior default or compatibility
path and explain the changed expectation in the change. Tests at separate package boundaries—such as
the shared board validator and the AWS release validator—must agree on the accepted configuration
shape. Cosmetic fields may use safe fallback behavior for newer values; security- and routing-
relevant fields remain strictly validated.

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
npm run verify
```

| Command | Purpose |
| --- | --- |
| `npm run dev` | Start the client and server development loop. |
| `npm run check` | Lint, typecheck, unit and browser tests, validate the example board, and test the published package. The unit phase builds packages once; the browser phase reuses that client build. |
| `npm run verify` | Run `check`, then build the production client and Lambda bundle. This is the commit-hook gate. |
| `npm run test:browser` | Build the client and run browser tests independently. |
| `npm run test:watch` | Run unit tests in watch mode. |
| `npm run build` | Build the production client. |
| `npm run format` | Apply Biome formatting fixes. |
| `docker compose up` | Run the published GHCR server image against a published asset path. |
| `docker compose -f docker-compose.yml -f docker-compose.local.yml up --build` | Build and run the current source locally. |

Contributions must pass `npm run verify`. The committed pre-commit hook runs this same gate, so
production-build failures are found before a change enters history. Pushes do not run a second local
gate; CI still runs its own checks and release builds.

New dependencies need a clear justification: the project deliberately keeps its dependency surface
small.

## AWS bootstrap output contract

Bootstrap validation and handoff commands support `--format json|text`; the formats are
behaviorally equivalent. JSON is the stable automation contract and text is the operator-facing
contract. `--format-shell` is an intentional exception: it emits only one copy/pasteable AWS shell
command, while remediation is available from JSON or text. Remediation wording and commands must
come from the AWS package's package-owned instruction model, not from a second CLI, workflow, or
Markdown procedure. AWS commands are emitted for explicit administrator review and invocation; the
library never hides or executes AWS mutations.

CLI backward compatibility has high value. Treat command names, flags, defaults, output format,
JSON field names and meanings, and exit statuses as public bootstrap contracts. Prefer additive
fields, new opt-in flags, and explicit migrations. Any change that could break an existing user or
automation must be called out in the change and approved by a human before merging; passing tests
alone is not approval. Add a meaningful real-interface compatibility test for the preserved behavior
or the approved migration path.

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

Tests justify themselves by running the code they test through its real interface. Source-text
assertions and tests that merely repeat implementation details do not provide behavioral coverage.
For example, SQL tests must execute the SQL against the database engine that interprets it. For
shell and deployment interfaces, exercise observable inputs and outputs, or test syntax when syntax
itself is the contract. Prefer fewer real contract tests over symbolic assertions about source text.

If a behavior must intentionally change, keep an explicit test for the prior default or compatibility
path and explain the changed expectation in the change. Tests at separate package boundaries—such as
the shared board validator and the AWS release validator—must agree on the accepted configuration
shape. Cosmetic fields may use safe fallback behavior for newer values; security- and routing-
relevant fields remain strictly validated.

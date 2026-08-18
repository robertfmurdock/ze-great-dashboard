# ze-great-dashboard

A team-visible trust dashboard: **a lens on your engineering state, not a ledger of it.**

It shows whether the things your team relies on are currently working — builds, deploys, versions,
whatever a team actually walks over to check. It stores nothing, computes no trends, and holds no
opinion about your process. Every panel is a live read of a system that already knows the answer.

Design doc: `ze-great-idea-pit/tool-ideas/trust-dashboard.md`. How this repo came to be shaped the
way it is, including the quirks that look like bugs: `docs/initialization-log.md`.

**Status: first Stage 2 slice.** GitHub Actions `pipeline-status` panels work end to end. Azure
DevOps and `http-value` adapters remain to be built.

## Quickstart

```sh
npm install
npm run dev
```

Then open <http://localhost:3000>.

That runs the Vite dev server on 5173 and the app server on 3000, with the server rendering the
entrypoint from Vite. Edit a component and the page updates — through the real server rendering path,
not a bypass of it. This is the loop for the visual work.

To run a different single-board YAML file, only its path is needed; the server selects its sole
board automatically:

```sh
BOARD_CONFIG_URL="$PWD/boards/ze-great-team.yaml" npm run dev
```

Set `BOARD` as well only when the selected YAML contains multiple boards.

Before you commit anything:

```sh
npm run check
```

Lint, typecheck, and tests, in about a second and a half. The pre-commit hook runs it too, so a
broken change can't be committed by accident — the hooks arrive with `npm install` via
`core.hooksPath`, no extra setup.

### The other mode: the deployed shape

```sh
cp .env.example .env      # set ASSET_PATH to a published version
docker compose up
```

One container, the server only, pointed at a client version already published to the CDN. No client
build involved. This is how you reproduce production behavior, or confirm that a specific published
version renders.

If you want to point it at something served from your own machine instead of the CDN, use the host's
LAN address, not `host.docker.internal` — on Docker Desktop that name can resolve to IPv6, and Node's
`fetch` will fail against an IPv4-only local server while `wget` in the same container succeeds. The
symptom is a refused start naming a URL you can reach perfectly well from the host.

## How it works

The client is an [Immutable Web Application](https://immutablewebapps.org): built once, published to
a versioned CDN path, containing **zero environment values**. The server fetches that version's
`index.html` at request time, injects a `window.env` block as the first element of `<head>`, and
serves it uncached.

The consequence worth caring about: **changing which client version is live is one environment
variable on the server.** No rebuild, no redeploy of the client, and rollback is the same move in
reverse.

```
browser ──► server (Lambda)  ──fetch index.html──►  CDN /dashboard/1.0.7/
                │                                       (immutable, cached hard)
                └── injects window.env, cache-control: no-store
```

Structurally that means:

- **`packages/client`** — the board renderer. React + Vite. Holds no configuration.
- **`packages/server`** — renders the entrypoint; from Stage 2, proxies signal data. Holds the
  credentials, stores nothing.
- **`packages/shared`** — the board config schema and signal envelope. The one definition both sides
  agree on, so changing it is a single coordinated change the type checker enforces.

`packages/server/test/immutable-web-app.test.ts` proves the whole mechanism against two fixture
client versions with different hashed filenames, over real HTTP, with no AWS and no credentials.

## Configuration

Boards are YAML — see `boards/example.yaml` for the small public demo and
`boards/ze-great-team.yaml` for the realistic radiator. Panels name a signal type and a source; the
schema is in `packages/shared/src/board-config.ts`.

**Credentials never appear in board config.** A source names an environment variable (`token_env:`)
and the value lives in the environment. `.env` is gitignored; `.env.example` names every variable and
holds no values.

Server environment variables are documented in `.env.example`. The one that matters is `ASSET_PATH`.

## Deploying

Push to `main`. CI checks, versions with [Tagger](https://github.com/robertfmurdock/tagger), publishes
the client to S3, and points the Lambda at the new version.

Infrastructure is a CloudFormation stack under `infra/`. On `main`, CI deploys the stack before it
publishes assets and updates the Lambda. Other branches receive no AWS credentials. CloudFormation
keeps the infrastructure state in AWS; `infra/README.md` documents the one-time GitHub OIDC role
bootstrap.

## License

MIT

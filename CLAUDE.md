# Working in this repo

A team-visible trust dashboard. The design lives in
`~/git/ze-great-idea-pit/tool-ideas/trust-dashboard.md` — read it before making architectural
decisions, because most of the surprising choices here are explained there.

Currently at **Stage 1**: the immutable shell renders, with no data behind it. No adapters, no
`/api/panel`, no auth.

`docs/logs/initialization-log.md` records why this repo is shaped the way it is, and — more usefully —
the handful of things that look like bugs and are not. Read it before "fixing" something odd, and
before the first deploy: it is explicit about what has never been executed.

After a substantial work slice reaches a meaningful completion point, record the reasoning and
discoveries before context is lost, even if nobody separately asks for it. Consult
[`docs/logging-guidance.md`](docs/logging-guidance.md) for the lightweight prompts. Routine fixes and
routine passing checks do not require log entries; do not gather extensive historical context first
or turn verification into a test-results transcript.

## The two rules

**1. `npm run check` before declaring anything done.** Lint, typecheck, and tests; about 1.5 seconds.
It is also what the pre-commit hook runs, so a change that fails it cannot be committed anyway.
Under ten seconds is a budget to defend as tests accumulate — it is the entire feedback loop.

**2. New dependencies need justification.** A tool whose pitch is trustworthiness should not accrete
packages. Say what it buys and what it costs in the change that adds it. This is the design doc's
*curated dependencies* constraint, and it is why there is no test-HTTP library (Hono's
`app.request()` covers it), no husky (`core.hooksPath` covers it), and no separate formatter (Biome
does both).

## Release evidence and dependency updates

Tests are release evidence, not coverage theater: use the fast-check budget for distinct, real
interfaces and failure modes that give extremely high confidence an automatic dependency update
works in release-relevant conditions or fails before merge. Do not spend it on duplicated structural
assertions, source-text checks, or coverage targets. When an update exposes a regression, add the
smallest meaningful real-interface regression test for that class of breakage.

Use relevant focused checks during iteration, but every commit must still run the unified `npm run
check` gate so unexpected effects cannot evade release evidence.

The daily `Update npm dependencies` workflow updates direct dependencies in the root and every npm
workspace, then enables rebase auto-merge on its PR. The normal Build workflow and protected-branch
requirements remain the only acceptance boundary. GitHub Actions and Docker base-image updates are
intentional review work, not part of this automation.
The pinned npm toolchain is intentionally excluded until a separate review decides how to update it
alongside the Node 24/npm 11.19.0 CI contract.

## Consumer-facing documentation

README files and setup, deployment, and configuration guides are for people deciding whether to use
the dashboard or trying to use it—not for contributors reconstructing the repository. Before
editing one, name its audience and the decision or task the reader needs to complete. Review the
result as a first-time consumer with no repository context:

- Does it say what the product does, what is supported, what is out of scope, and what the reader
  should do next?
- Do every command, link, version, default, and configuration example match the current product and
  work for the audience being addressed?
- Does each section help the reader evaluate, install, configure, deploy, or safely operate the
  product? If it mainly explains implementation history, test mechanics, release internals, or
  contributor workflow, move it to contributor or architecture documentation.
- Can a consumer understand security boundaries and required ownership without knowing package
  names, internal stages, or the repository's development history?

Keep the top-level README especially short and consumer-oriented. Do a final pass looking for
contributor vocabulary such as “the repository currently,” implementation status, test commands,
capture scripts, internal roadmaps, or design archaeology; remove it unless it directly helps a
consumer succeed.

## Commands

| | |
|---|---|
| `npm run check` | The gate. Lint + typecheck + test. |
| `npm run dev` | Vite on 5173 + server on 3000, HMR through the real rendering path. |
| `npm run test:watch` | Vitest in watch mode. |
| `npm run format` | Biome, writing fixes. |
| `npm run build` | Production client build. |
| `docker compose up` | The deployed shape, against a published `ASSET_PATH`. |

## The one mechanism to understand first

The client is an **Immutable Web Application**. It is built once, published to
`{cdn}/dashboard/{version}/`, and contains **zero environment values** — which is what lets one build
serve any environment, and makes promoting or rolling back a client version a single environment
variable on the server with no rebuild.

That works via one rule. `vite.config.ts` sets `base: '/__ASSET_PATH__/'` **unconditionally**, dev
and prod alike. The server's only rewriting is replacing that sentinel with the real asset path. Dev
uses the identical code path because Vite's dev server also serves under the sentinel prefix.

Things that follow, and are load-bearing:

- `index.html` is **deployable configuration**, not a build artifact to bake in. It is fetched from
  `{assetPath}/index.html` at runtime. Baking it into the server image would serve one version's
  assets under another version's hashed filenames — the most confusing available failure.
- `<base href>` is **not** an option. It would repoint *every* relative URL including `/api`, sending
  proxy calls to the CDN.
- `window.env` is injected as the **first** element of `<head>`, because the client's modules read it
  during initial evaluation. Later is a race.
- The entrypoint is served `cache-control: no-store`. The assets it names are immutable and cached
  hard; this document is not.

`packages/server/test/immutable-web-app.test.ts` is the permanent gate on all of this: two fixture
client versions with different hashed filenames, served over real HTTP. If you change the rendering
path, that test is the one that matters.

## Things that are security-relevant, not stylistic

- **`window.env` is browser-visible.** Only public values go in it. Anything secret lives in the
  server's environment and must never reach the template. There is a test asserting
  `BOARD_CONFIG_URL` does not leak.
- **Board config never holds credentials.** It names an environment variable (`token_env:`); the
  value lives in the environment. The failure mode is a PAT in git history, which is not a thing to
  discover later.
- **Duplicate panel ids fail validation loudly.** Ids will key the Stage 2 allowlist and address
  panels in the proxy URL, so "whichever came first" would silently repoint a URL.
- **When the allowlist lands (Stage 2), it goes in one small quarantined file with exhaustive
  tests**, flagged for human review on every change. Wrong there is a vulnerability, not a rendering
  bug.

## Signals and state

- **Stateless. No database, no persistence.** The dashboard is a lens, not a ledger. The one
  exception is the in-memory template cache, and it is only allowed because a version's template is
  immutable, keyed by asset path, and lost freely on restart.
- **`state: "error"` is still HTTP 200.** An upstream being down is a fact to render, not a failure
  of the proxy. 5xx is reserved for the proxy's own breakage. Getting this backwards makes a broken
  upstream look like a broken dashboard.
- A panel that cannot be read must **say so** — never render as healthy, never render blank. For a
  trust radiator a blank panel is the worst outcome available.

## Design constraints for the cosmetic work

Most of the work ahead is visual, and `npm run dev` is the loop for it.

- Sized for a wall: `font-size` scales with the viewport, so the same board reads on a laptop and on
  a TV across the room.
- **Status is never color alone.** Every status pairs with a glyph and a label. The palette in
  `styles.css` was validated computationally against the dark surface for CVD separation and
  contrast — if you change a status color, re-validate rather than eyeball it.
- Status colors (good/warning/serious/critical) are reserved and never reused as categorical series
  colors.

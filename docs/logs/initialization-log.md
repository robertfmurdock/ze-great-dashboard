# Initialization log

Written at the end of the session that created this repo (commit `8eabe0f`, 2026-08-17), while the
reasoning was still in hand. It records what was decided, what was *discovered by running things*,
and — most importantly — what has never been executed and is therefore still a guess.

Read this before the first deploy, and before "cleaning up" anything listed under Quirks.

Design doc: `ze-great-idea-pit/tool-ideas/trust-dashboard.md`. The doc explains *what* and *why*;
this file explains *how it turned out* and where reality pushed back.

---

## What state this repo is actually in

**Stage 1, verified locally at repository initialization.** The repository's later AWS bootstrap
validation is recorded in `docs/logs/aws-bootstrap-log.md`; the original application infrastructure and
runtime remain separate from that bootstrap validation.

Working and proven by running it: `npm run dev`, `npm run check`, `docker compose up`, the
Immutable Web Application rendering path, the commit and push hooks.

Never executed during the initialization session, and therefore unproven by that session:

- **The CI workflow has never run.** Not once, on any branch. There is no remote.
- **`terraform apply` has never run.** Only `init -backend=false`, `validate`, and `fmt -check`.
  Never even `plan` — the session's AWS credentials were `ReadOnlyAccess` throughout.
- **The Lambda has never been invoked.** `hono/aws-lambda` and Function URL payload format v2.0 are
  wired per docs, not per observation.
- **No client version has ever been published**, so the one-variable version switch has only been
  demonstrated against test fixtures and a local static server, not against S3 and CloudFront.

The names in `.github/workflows/main.yml` — `ze-great-dashboard-assets`, the function name, the
role ARN, `assets.dashboard.zegreatrob.com` — are hardcoded to resources Terraform has not created.
They are predictions that must be checked against `terraform output` after the first apply.
`infra/README.md` says this too; it is repeated here because getting it wrong looks like a CI bug
rather than a naming mismatch.

---

## Decisions, and what each one cost

### Scope: scaffolding plus Stage 1, together

Stage 1 (immutable shell, no data) was pulled into the initial commit rather than left for later,
because the two requirements that mattered most — run it locally, block bad commits — are
unfalsifiable claims until something actually renders. A scaffold that "would" support HMR is not
the same as one that does.

### Stack

TypeScript end-to-end, Hono, Vite, React, npm workspaces, `zod`, Biome, Vitest.

React and npm workspaces were routine judgment calls rather than deep ones: the cosmetic work ahead
is where component reuse pays, and npm 11 was already present. Both are cheap to overrule early and
expensive to overrule late, which is the argument for saying so out loud here.

### Deploy shape: Lambda + Function URL, S3 + CloudFront, Terraform applied by hand

No API Gateway — one route surface, no request transformation wanted. **CI cannot create
infrastructure**: the deploy role can write to the assets bucket and update one function, and holds
nothing else. Publishing artifacts and provisioning are different privileges and only one of them
belongs in a pipeline.

### A dedicated assets bucket, not a folder in an existing one

`assets.zegreatrob.com` is Coupling's bucket, and its CORS configuration allowlists specific
origins. This design needs `Access-Control-Allow-Origin: *`, because the server fetches
`index.html` cross-origin from wherever it happens to run — localhost, Lambda, anywhere later — and
enumerating those would mean editing infrastructure to onboard a developer.

Widening Coupling's CORS to get that would have traded another project's security posture for
convenience here. A separate bucket costs approximately nothing.

The `*` is safe *because of what the bucket holds*: immutable build artifacts with zero environment
values and zero secrets. That safety is a property of the content, not of the header — so it stops
being true the moment anything environment-specific gets published there. Don't.

### Two-phase Terraform apply, because DNS is at GoDaddy

`zegreatrob.com` runs on GoDaddy nameservers. No Route53 hosted zone exists, and no ACM certs did
either. So Terraform can neither create the alias record nor validate its own certificate: two
CNAMEs get added by hand, and `infra/README.md` documents the order.

`assets_domain = ""` skips all of it and serves from `d*.cloudfront.net`. That this is a real
option rather than a degraded mode is the one-variable property doing its job.

### TypeScript project references: tried, abandoned

The first attempt used `composite` project references with `tsc --build`. It produced `TS6310`
("Referenced project may not disable emit") together with `TS5097`/`TS7017`, because the packages
are consumed as **TypeScript source** — `packages/shared/package.json` exports `./src/index.ts`
directly, with no build step and no emitted `.d.ts`.

Resolution: drop references entirely. `allowImportingTsExtensions: true` plus `noEmit: true`, and
four independent `tsc -p` invocations run in parallel through `concurrently`.

The consequence to know about: **there is no build order and no incremental cache.** It stays fast
because the project is small (four invocations, well under a second). If typecheck ever becomes the
slow part of `check`, this is the decision to revisit — and the reason it was made this way.

### `check` is one command, and its speed is a feature

`npm run check` = Biome CI + 4× tsc + Vitest. **1.8 seconds** at the initial commit (1.4s before
the last few tests landed) against a self-imposed ten-second budget.

The budget is the point. It is the entire feedback loop, it is what the pre-commit hook runs, and a
gate slow enough to skip gets skipped. Defend it as tests accumulate.

Playwright was deliberately not added. It is right for Stage 5's visual work and far too slow for a
pre-commit gate; the IWA test covers the integration risk that exists today.

### React Testing Library belongs in the client tests

The client tests originally used a small hand-rolled `createRoot` renderer with manual DOM cleanup.
That was enough to test the Stage 1 shell, but the tests already described rendered behavior and an
accessibility contract (`role="alert"`), so maintaining a second rendering harness had no value.
`@testing-library/react` was added on 2026-08-18 and the existing tests were migrated without adding
test cases or changing the check-in gate. RTL now owns rendering and cleanup; Vitest still runs the
same complete `npm run check` loop, with no separate slow-test block or coverage requirement.

### Hooks: committed `.githooks` + `core.hooksPath`, no husky

Wired by a root `postinstall` running `git config core.hooksPath .githooks`. Arrives with
`npm install`, is reviewable in the diff, and adds no dependency.

`pre-commit` runs `check`. `pre-push` runs `check` again plus both production builds — the commit
being pushed may not be the one that was checked (rebases, amends), and a build that only breaks in
CI is a broken deploy found from a red pipeline instead of a failing test.

### `esbuild` as a direct dev dependency

Added to bundle the Lambda. Under the curated-dependencies rule: it was already in the tree twice
over (Vite and tsx both depend on it), so it adds no new supply-chain surface — but it is a
dependency addition and is flagged as one.

Its gated postinstall was approved via `npm install-scripts approve esbuild`, which recorded
`"allowScripts": {"esbuild@0.28.2": true}` **in `package.json`**. That location was the point:
a supply-chain decision belongs in the repo where it can be reviewed, not in one machine's local
approval state.

`fsevents` was left *un*approved. It is a macOS-only watcher optimization; watching falls back to
polling without it, and the smaller approved-scripts list is worth more than the optimization.

### `tsx` in the container instead of a build artifact

The Docker image runs the TypeScript sources directly. One less artifact to keep in sync, and the
code running in the container is the code in the repo. The Lambda still gets a real esbuild bundle,
because cold-start time there is worth the extra step.

### Status colors were validated computationally, not chosen by eye

The palette in `styles.css` was checked with a validator against the actual dark surface
(`#12140f`): the statuses in use pass CVD separation (11.3 protan), the normal-vision floor (27.6),
and 3:1 contrast. The lightness-band check fails, which is a categorical-series concern and does not
apply to status colors — that exemption is deliberate, not an oversight.

**If you change a status color, re-run the validator rather than eyeballing it.** And status is
never color alone: every status pairs with a glyph and a label.

---

## Quirks — things that will look like bugs and are not

Each of these was found by running something, not by reading. That is why they are written down:
the next person's instinct will be to "fix" them.

### `HOST` is `0.0.0.0` but the healthcheck must use `127.0.0.1`

The container healthcheck originally used `http://localhost:3000/health` and reported `unhealthy`
against a server that was serving fine. Inside the container `localhost` resolves to `::1` first,
and the server binds IPv4. `wget` to `127.0.0.1` succeeded in the same container where `localhost`
was refused. **Don't "tidy" that back to `localhost`.**

### `host.docker.internal` can defeat Node's `fetch` while `wget` succeeds

Pointing a container's `ASSET_PATH` at a host-served client via `host.docker.internal` failed to
start — `fetch failed` — while busybox `wget` inside that same container fetched the same URL
happily. The name resolved to an IPv6 address (`fdc4:f303:9324::254`) and the host-side static
server was IPv4-only.

Use the host's LAN address for that scenario. Noted in the README because the symptom is a refused
start naming a URL you can reach perfectly well from your own browser.

### `clientVersion` shows `dev` locally by special case

The version label is the last path segment of `ASSET_PATH`. Locally that segment is the sentinel
itself, so the board rendered `__ASSET_PATH__` as its version number — which reads as a bug on the
exact screen you stare at during cosmetic work. There is an explicit special case, and a test.

### `TEMPLATE_WAIT_MS` exists for exactly one race, and defaults to 0

`npm run dev` starts this server and the Vite dev server simultaneously; the server fetches the
template at boot, so whichever loses kills the loop. The retry is bounded, opt-in, set only by the
dev script, and **rethrows the original error unchanged** — waiting must not blur what went wrong.

Every deployment leaves it at 0, so a typo'd `ASSET_PATH` still fails on the first attempt. A
deployment that quietly retried would turn a misconfiguration into a slow start instead of an
error, which is the opposite of what this project is for. There is a test asserting the default.

### A template with no `<head>` fails at boot *and* 500s per request

Both, deliberately. Startup catches it so a broken build fails in the deploy's logs; the per-request
path still returns 500 as the belt to that suspenders. The 500 is correct under the doc's rule that
5xx is reserved for the proxy's own breakage — nowhere to inject configuration is the proxy being
unable to do its job, not a report about an upstream.

This was originally a test expecting a rejection; Hono converts the throw to a 500, and the right
fix was to accept the 500 *and* add the boot check, rather than to weaken the assertion.

### `vi.stubEnv` survives `vi.restoreAllMocks()`

Cost a real debugging detour: `TEMPLATE_WAIT_MS=1000` leaked from one test into the next, which then
retried 5 times instead of 1 and failed an assertion that was actually correct. `vi.unstubAllEnvs()`
in `afterEach` is load-bearing in `dev-startup.test.ts`.

### `render.ts` escapes U+2028/U+2029 as sequences on purpose

The line/paragraph separator characters in the script-tag serializer are written as escape
sequences, not literals. Literal U+2028/U+2029 are invisible in most editors and make the file
hostile to edit. Leave them escaped.

### Terraform `ignore_changes` on the Lambda is required, not lazy

The function is created with a placeholder zip so `apply` works before any build exists. CI replaces
the code and `ASSET_PATH` on every deploy. Without `ignore_changes = [filename, source_code_hash,
environment]`, every plan after a deploy would propose reverting production to the placeholder.

Corollary: **the first apply produces a deliberately broken function.** The server refuses to start
without a reachable template and nothing is published yet. That is accurate — there is no client —
rather than something to work around.

### Bucket versioning is on for one file

Published versions live at distinct immutable paths and are never overwritten — except
`index.html`, which a re-run of the same build does overwrite. Versioning is cheap insurance on the
single mutable object in the bucket.

### `index.html` is cached 60s; everything else is `immutable`

The entrypoint document names *this version's* hashed filenames and is fetched by the server at
runtime, so it must not be cached hard. The server's own response is `no-store`. The assets are
`max-age=31536000, immutable`.

---

## Environment facts verified during the session

Worth recording because re-verifying them costs API calls and console time:

| | |
|---|---|
| AWS account | `174159267544` |
| Session role | `AWSReservedSSO_ReadOnlyAccess` — could not apply anything |
| GitHub OIDC provider | Already exists (`token.actions.githubusercontent.com`); looked up, not created |
| Route53 hosted zones | None. ACM certs: none |
| Terraform | 1.15.8, darwin_arm64 |
| Tagger | `@continuous-excellence/tagger` 3.6.14, bin `tagger`, `calculate-version -q` prints the version to stdout |
| `esbuild` under `npm ci --ignore-scripts` | Works — its binary ships as an optional dependency, not a postinstall download. This is why CI can use `--ignore-scripts` |

Also verified before writing any code that depended on it: **Vite's dev server serves cleanly under
a sentinel `base`.** A throwaway probe confirmed `/__ASSET_PATH__/index.html` with every module URL
— including the HMR client `@vite/client` — under the sentinel prefix, and that `vite build` emits
sentinel-prefixed hashed paths. The plan's one untested assumption, checked first, because the
entire "one replacement rule, dev and prod" design rests on it.

---

## A local-machine hazard, filed under lessons

`lsof -ti:3000 | xargs kill -9` to free a port killed Docker Desktop's port-forwarding process and
took the daemon down with it, costing a restart mid-verification. Prefer stopping the actual process
(`docker compose down`, or killing the dev server by name).

---

## Grid-first radiator density (2026-08-26)

The first populated team board had enough information to fit a screen, but its balanced card layout
made the most important question — “which build needs attention?” — slower to scan than it needed to
be. The board was changed to five full-width, two-row pipeline rectangles followed by four compact
published-version rectangles in the final row. Update-health panels were removed from this board,
not from the product: another board can still place and render them when that context earns screen
space.

The grid remains the sole board-layout API. Authors still choose only `position` and `display`; no
sections, inferred groups, or board-name selectors were added. Panel components inspect their own
allocated rectangle: shallow primary panels arrange their existing evidence into scan rows, while
taller primary panels retain the card treatment and its room for active-run detail. Compact HTTP
value panels become inline facts when their own rectangle is wide enough, then stack naturally on a
narrow screen. A first implementation used size containment on every panel; that changed intrinsic
sizing for tall animation panels. The final implementation uses inline-size containment and derives
the shallow treatment from the explicit two-row rectangle, preserving tall panel behavior.

`label` was added as an optional presentation-only panel field so a wall can say “JSmints” without
renaming the stable `jsmints-build` address. IDs remain required, unique, and the proxy/allowlist
key; requests and routes did not change, and boards without labels render their IDs exactly as
before. The AWS-side compatibility validator knows the field as well, so release assembly preserves
it intentionally rather than only through loose-object pass-through.

The always-visible header now keeps only the board name. Client version and asset path moved to the
existing Diagnostics disclosure: deployment context remains available on request without competing
with live operational evidence. No dependencies, persistence, or server API routes were added.

Verification covered schema compatibility, label fallback, source-link ownership, Diagnostics
disclosure, a populated 2048×1024 wall layout with five full-width build rows and four final-row
facts, clipping/overflow, and narrow-screen stacking. `npm run check` passed after the change.

---

## Follow-up: hardened Docker runtime (2026-08-26)

The container runtime was subsequently hardened without changing the release contract. The
Dockerfile now pins the multi-architecture Node 24 Alpine builder and Google Distroless Node 24
Debian 13 `nonroot` runtime by reviewed manifest SHA256 digests. Alpine is used only to install the
existing build dependencies and produce a standalone ESM bundle of `node-server.ts`; the final
image contains that bundle and `boards/` only. It has no npm, `tsx`, shell, or production
`node_modules`.

The container explicitly defaults `BOARD_CONFIG_URL` to `/app/boards/example.yaml`, while retaining
environment overrides. Its healthcheck is an exec-form Node request to `127.0.0.1:3000/health`,
and the ECS smoke test now waits for the image healthcheck instead of replacing the command with a
shell script. The release workflow still publishes an exact candidate image and promotes that
same tested image to `latest`.

Verified locally: the image builds, renders the published client template, serves the example board
and `/health`, runs as UID 65532, and has no `/bin/sh`. Unit tests, published-package tests, the
immutable-web-app tests, shell syntax checks, and `git diff --check` passed. The full `npm run check`
was blocked only when the local macOS Playwright browser failed to launch inside the sandbox, before
any browser test executed.

---

## If you are picking this up cold

1. `npm install && npm run dev`, open <http://localhost:3000>. That is the loop.
2. `npm run check` before declaring anything done. Under ten seconds is a budget to defend.
3. Read `CLAUDE.md` for the rules, and the design doc for why they exist.
4. Before the first deploy: read `infra/README.md` in full, then reconcile every hardcoded name in
   `.github/workflows/main.yml` against `terraform output`.
5. Stage 2 begins with **Stage 0** — capturing real upstream fixtures. `fixtures/README.md` lists
   what must be captured and why nothing there may be invented.

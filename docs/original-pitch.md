<!--
Original product/architecture pitch copied from the idea pit on 2026-08-18.
This file is intentionally historical. Keep implementation status and changed decisions elsewhere.
-->

# Trust Dashboard: Team-Visible Status Radiator

## Core Idea

A lightweight, open-source dashboard that shows a team's current engineering state at a glance — pipeline status, deployed versions, and eventually test counts — drawn directly from primary sources. Its purpose is building team trust by making standards visibly maintained, inspired by the "big and visible" information radiator tradition that has atrophied in the modern multi-tool era.

The tool is a lens, not a ledger. It never stores or tracks data itself — it queries primary sources (any CI system, deployment endpoints, whatever holds the truth) and renders what they say right now. Historical trends are computed from the source's own history (e.g., test counts over the last N pipeline runs), not from self-collected observations.

Panels are defined by the *signal* they show, not the system they read from. Azure DevOps is the first adapter because it's the immediate need, not because the design is built around it — see *Signals and Sources*.

## Core Architecture

**Small server, no client secrets.** The browser renders and holds nothing secret or source-specific. The server holds credentials, verifies identity, hands the browser its entrypoint, and normalizes upstream responses into the signal model. It stays stateless and small — but it is not a dumb pipe; see *The proxy is small, but it is not fifty lines*.

Structurally this follows [Immutable Web Applications](https://immutablewebapps.com/): the client is built once, versioned, and published to a permanent location containing zero environment-specific values. Everything environment-specific arrives via `index.html`, which is *deployable configuration*, not a build artifact. See `Essays/TheIncredibleImmutable.md` for a walkthrough of doing this in practice.

- **Versioned client assets on a CDN.** Built once, uploaded to a versioned path (`https://assets.example.com/dashboard/1.0.7/`), never rebuilt per environment. The browser loads these directly from the CDN — the server is not in the asset path.
- **Server-rendered `index.html`.** The entrypoint is not a static file. The server fetches the template `index.html` from the pinned asset version, injects a `window.env` block as the first element in `<head>`, and serves the result with `cache-control: no-store` so configuration can change on a dime. See *Where the template comes from*.
- **Data proxy on the same origin.** Attaches upstream credentials, validates inbound JWTs, normalizes responses, exposes only the calls the config permits. Small, but not trivial — see below.
- **Board config in YAML.** Panels, layout, sources, links. Committed to a repo and reviewed in PRs. Distinct from environment config (see *Two Layers of Configuration*).

Because `index.html` and the proxy come from the same origin, there is no CORS between frontend and proxy, no cookie-forwarding problem for gateway auth, and no SPA-fallback routing to configure — any path can be served.

**The CDN must be CORS-permissive** (`Access-Control-Allow-Origin: *` on the asset bucket). Classic `<script src>` tags don't need it, but ES modules, fonts, and any `fetch()` of a static asset do. The assets contain no secrets and no environment values, so wide-open CORS on them costs nothing — that's the point of making them immutable.

**Scales from local to deployed with one build and one image:**

| | Local | Deployed |
|---|---|---|
| Credentials | Personal (env var, az login) | Service principal / managed identity |
| Lifecycle | Up with `docker compose up` | Always on |
| Audience | Developer | Team + non-engineers |
| Client assets | Vite dev server, or a pinned CDN version | CDN, pinned to a version |
| Entrypoint + proxy | Container or local process | Container (or Lambda / Cloud Function) |
| Auth | `auth` section absent | `auth` section required |

The only differences are injected environment values and which asset version is pinned. Pointing a local server at a deployed client version — to reproduce a bug without building the client at all — is a one-variable change.

### Where the template comes from

**The template `index.html` is published alongside the assets it references**, at `{assetPath}/index.html`, and the server fetches it from there at runtime. It is not baked into the server image.

This is what makes the one-variable claim true rather than aspirational. The template is the artifact that names the build's hashed filenames, so it is only ever correct for the version it shipped with — bake it into the image and "point at a different client version" silently means "point at a different version's assets using this version's filenames," which fails in the most confusing way available.

The template still needs its asset references made absolute, because the document is served from the server's origin while the assets live on the CDN — anything relative would resolve against the wrong host. **Build with a sentinel base** (Vite `base: '/__ASSET_PATH__/'`) and have the server replace that one token with `assetPath`. The sentinel is not an environment value, so the artifact stays immutable and environment-free, and the rewriting collapses to a single deterministic string replacement instead of parsing HTML and reasoning about which URLs are assets.

The tempting alternative — injecting `<base href="{assetPath}">` — should be rejected. It would repoint *every* relative URL in the document, including root-relative ones like `/api`, which resolve against the base URL's origin rather than the server's. That silently sends proxy calls to the CDN, and it fails at runtime rather than at build time.

Consequences worth deciding now, since Stage 1 hits all three:

- **Fetch at boot, cache in memory, keyed by version.** The template is immutable at a given version, so there's nothing to invalidate and no staleness question. This is the one thing the server holds that looks like state, and it doesn't violate the no-persistence rule: it's a cache of an immutable artifact, reconstructible from its URL, lost freely on restart.
- **A missing or unfetchable template is a startup failure, loudly.** Refuse to start rather than serving a 500 per request — a typo'd `assetPath` should fail like the misconfiguration it is, at the moment someone can still see the logs. On serverless, "boot" is cold start, so this becomes a first-request failure with a clear message instead.
- **The template must be CORS-irrelevant, not CORS-permissive.** The server fetches it server-side, so no CORS applies to that hop. The assets it references still need permissive CORS, because the *browser* fetches those.

Local development is the case this doesn't cover cleanly: Vite's dev server serves an unhashed, HMR-injected `index.html` that isn't a published artifact. Treat `assetPath` pointing at `http://localhost:5173` as the same mechanism — fetch the template from there, inject `window.env`, serve it — which works because Vite's dev index is a real document at a real URL. The HMR client and module graph come along with it.

## Key Design Decisions and Reasoning

### Stateless / no persistence

- Keeps costs near zero (a small container or free-tier function, plus static hosting).
- Eliminates the class of bugs where the dashboard diverges from reality. (Holding a last-known value through an upstream failure is the one place that guarantee gets negotiated — see *Still open*.)
- Keeps serverless deployment possible (Lambda, Cloud Functions), though the container is the primary target — see below.
- Makes the audit/security story trivial: no data stored means no data to leak.

"No persistence" means no database and no accumulated observations. Caching is handled by passthrough revalidation rather than proxy-side storage — see below.

### Caching by Passthrough Revalidation

The freshness question belongs to the data source, not to the dashboard. **If the API says its data can be cached, we don't second-guess it.** The proxy never invents, shortens, or overrides a cache directive — it forwards the conversation:

- Upstream's `ETag` / `Last-Modified` / `Cache-Control` are forwarded down to the browser.
- The browser's `If-None-Match` / `If-Modified-Since` are forwarded back up.
- A `304` upstream becomes a `304` downstream. The browser's own HTTP cache does the storing.

Polling with a plain `fetch()` in default cache mode gets conditional requests essentially for free — the browser handles revalidation itself. Zero proxy state, no backend, and philosophically exact: the dashboard never asserts freshness, it relays the source's assertion. This is the same "lens, not ledger" principle applied to time.

**The corollary is disclosure, not override.** If an upstream declares `max-age=300`, the browser may legitimately show a five-minute-old value without asking anyone — and the answer is to say so on the panel, not to secretly revalidate anyway. `Date` is on every response, so the panel can render "as of 4 minutes ago" and the viewer decides whether that's good enough. (`Age` would say it more directly, but only a shared cache emits one, and there deliberately isn't one.) An honest stale reading beats both a silent stale reading and a dishonest override of the source's own policy. Where a team genuinely needs tighter freshness than the API offers, that's the per-panel `refresh` override the board author sets deliberately — not a default the proxy imposes.

Two limits, stated so they don't get forgotten:

1. **This does not solve multi-viewer fan-out.** Browser caches are per-browser. Eight viewers still make eight upstream calls — what's eliminated is each viewer's *redundant* calls, not the fan-out. The fix is a shared cache, deliberately deferred; the arithmetic and the reasoning are under *Deferred until the project matures*.
2. **Responses derived from a user's token need `Cache-Control: private`** and appropriate `Vary`, or a shared intermediary could serve one viewer's data to another. This is the one case where the proxy *adds* a directive rather than relaying one, and it's a correctness requirement rather than a policy judgment.

All of the above assumes one upstream call per panel, which is true of both MVP signals but not of `test-count` or trend lines — see *The signal envelope* for what a fanned-out panel forwards instead (nothing).

When upstream sends no validators at all, nothing special happens: the same forwarding code copies nothing, every poll is a full request, and the dashboard works exactly as it does otherwise. Validator support varies by source (GitHub is good about `ETag` and exempts conditional requests from rate limits; ADO is less consistent), but since no code branches on it, it costs nothing to be wrong about. Optional refinement if payload size ever matters: the proxy can hash its own normalized body and serve that as an `ETag`. Stateless, but no rate-limit relief, so it's not worth doing until something measurable calls for it.

### Two Layers of Configuration

These are different things with different lifecycles, and conflating them is what forces a public config URL.

**Environment config** — small, per-instance, changes at release time. Injected into `index.html` as `window.env`, never fetched by the browser:

```
window.env = {
  assetPath: "https://assets.example.com/dashboard/1.0.7/",
  proxyPath: "/api",
  boardConfigUrl: "https://.../team-alpha.yaml",
  board: "team-alpha",
  auth: { issuer: "...", clientId: "..." }   // omitted entirely when unauthenticated
}
```

**Board config** — the YAML below. Panels, layout, sources. Lives in a repo, reviewed in PRs, changes when the team changes what it watches. Its *location* is an injected environment value, so one build serves any board anywhere.

The board config is fetched **through the proxy**, not directly by the browser. This keeps it private (an ADO repo or a non-public bucket works fine), avoids needing CORS on the config host, and lets the proxy read the same config it's about to enforce against. `window.env.board` tells the frontend which board it is, so no URL parsing is required.

**Read once at boot.** The proxy fetches and validates the board config at startup, derives the allowlist from it, and holds both for the process lifetime. A board change takes a restart — cheap for a container, free on serverless where every cold start re-reads anyway.

This is the simple answer and it's also the safe one. The allowlist derives from this file, so any re-read scheme has to reload the config and the allowlist *together* — reloading one and not the other is how a panel comes to exist that the allowlist doesn't cover. Boot-only makes that class of bug unreachable rather than merely unlikely. If live reload earns its way in later, the invariant to preserve is that config and allowlist are replaced atomically or not at all.

So the earlier claim needs narrowing: changing a board needs no *rebuild* and no *redeploy*, but it does need a restart.

Credentials for the config host are its own env var (`BOARD_CONFIG_TOKEN`), separate from any `sources` credential — the config location and the systems it points at are unrelated, and a token that can read one shouldn't imply access to the other. A local file path is also a valid `boardConfigUrl`, which is what local development uses and what needs no credential at all.

### Config separate from credentials

Borrowed from Grafana's provisioning model. Config references named sources; credentials are resolved from environment variables or a secrets manager at runtime. The config file is safe to commit anywhere.

```yaml
# Example sketch — not final
sources:
  ado-main:
    type: azure-devops
    org: https://dev.azure.com/myorg
    project: myproject
    token_env: ADO_PAT

  gh-main:
    type: github-actions
    repo: myorg/myrepo
    token_env: GITHUB_TOKEN

boards:
  team-alpha:
    refresh: 60s                 # board-wide default
    panels:
      # Same panel type, different source types — the adapter absorbs the difference.
      - id: api-build
        type: pipeline-status
        source: ado-main
        pipeline: 42
        position: { x: 0, y: 0, w: 6, h: 4 }

      - id: web-build
        type: pipeline-status
        source: gh-main
        pipeline: build.yml
        refresh: 30s             # per-panel override, clamped by the adapter's floor
        position: { x: 6, y: 0, w: 6, h: 4 }

      - id: prod-version
        type: http-value
        url: https://my-app.com/version
        json_path: $.version
        position: { x: 0, y: 4, w: 12, h: 2 }
        link: https://my-app.com/health
```

**Every panel needs an `id`.** It's how `/api/panel/{board}/{panelId}` addresses a panel and how the allowlist keys its permitted calls, which makes it security-relevant rather than cosmetic — array position would silently repoint every URL the moment someone reorders the config. Ids are author-written and stable, and duplicates must fail config validation loudly rather than resolve to whichever came first. `id` and `type` are the only universally required fields; everything else is either signal-specific or optional.

`position` is advisory in v1. Stage 5 reads it as a fixed 12-column grid, but layout is the part of this schema most likely to be replaced (see *Still open*), so a panel without a `position` should render in config order rather than not render at all.

**Refresh resolves in three layers**, because three parties have a legitimate say. The board author sets a board-wide default and may override it per panel; the adapter declares a per-source floor that clamps both. A board asking ADO for a 5s refresh gets the adapter's floor instead, and the panel discloses its actual age either way. Without the floor, knowing each upstream's rate limit becomes the board author's problem, which it shouldn't be.

### Named boards via URL

A deployed instance serves boards by name (`/boards/team-alpha`). Because the server renders `index.html` per request, the board name is resolved server-side and injected as `window.env.board` — no static-hosting SPA fallback, no client-side URL parsing. Multiple boards = multiple named entries in the config, or multiple config URLs. Changing what a board watches is a config edit plus a restart — no rebuild, no redeploy.

### The proxy is small, but it is not fifty lines

Worth stating plainly so the "thin proxy" framing doesn't get used to reject things it actually needs. The proxy's real job list:

1. Render and serve `index.html` (fetch the pinned template, inject `window.env`, replace the asset-path sentinel).
2. Serve the board config it fetched from its configured location.
3. Attach upstream credentials to a **bounded set** of permitted calls.
4. Run the adapters: fetch from upstream and normalize the response into the signal model.
5. Forward cache validators in both directions (see *Caching by Passthrough Revalidation*).
6. Validate inbound JWTs when `auth` is configured (OIDC discovery, JWKS, rotation).
7. Serve the widget bootstrap document, if custom widgets ever ship.

Item 4 is the one that grew. Normalization was originally imagined as the browser's job, and moving it server-side is the second walk-back of "the server is a shim" — the first being the allowlist below. It's the right home for it, since the adapter already owns URL construction and credentials, but it does mean the proxy carries the source-specific knowledge the frontend is promised not to have.

That is a few hundred lines with tests, not fifty. It remains stateless and serverless-compatible, and the cost argument survives — but it is a small web server, not a shim.

### The proxy exposes named operations, not arbitrary URLs

If the browser could hand the proxy any URL to sign with a stored credential, the proxy would be a credential-lending service for anyone who can reach it — arbitrary API access under whichever token matched (an ADO PAT, a GitHub token, a cloud metadata endpoint), plus SSRF into the network via the `http-value` panel type. The more sources a deployment configures, the worse this gets, which is why the allowlist is not optional.

So the proxy reads the board config and derives an allowlist from it. Requests name a panel and the proxy constructs the upstream call itself:

```
GET /api/panel/{board}/{panelId}
```

The browser never supplies a URL. `http-value` panels are only fetchable if their exact URL appears in the config. This is a deliberate walk-back of "no config interpretation in the proxy" — that principle loses to not shipping an open relay.

### Links back to sources on every panel

Every panel includes a link to the real system — the pipeline run in whatever CI produced it, the deployment endpoint, whatever the authority is. The dashboard asserts nothing; it points you to the source. This reinforces its role as a lens.

The adapter derives the link; the board author does not hand-write it. Deep-link construction is source-specific anyway, and a hand-authored `link` drifts — it keeps pointing at last quarter's pipeline after the panel's `source` changes, which is a lens pointing at the wrong thing. The `link` field stays as a deliberate override only, as in the `http-value` example above.

### Docker image with compose for local use

- Rancher Desktop / Colima sidestep Docker Desktop licensing.
- If compose is already in the project's dev stack, adding one more service is trivial.
- A startup walkthrough could validate credential setup on first run.
- Local credentials come from a gitignored `.env` that compose reads, with a committed `.env.example` naming every variable and holding no values. Worth stating because the failure mode is a PAT in git history, which is not a thing to discover later.

### Container primary, serverless secondary

Serverless compatibility is worth keeping because it forces statelessness as an architectural constraint rather than a preference, and because Hono makes it nearly free (see *Implementation Approach*). But the container is the primary target, for two reasons.

First, the invocation math scales with *viewers × panels*, not teams: one viewer with a ten-panel board polling every 60s is ~14,400 invocations/day on its own, and each open browser adds another set. Still cheap on free tiers, but an order of magnitude past what "a dashboard for one team" sounds like. Passthrough revalidation trims the cost of each call — a `304` is cheaper upstream and downstream — but it's still a proxy invocation.

Second, the shared cache that would collapse the remaining fan-out needs an external store on serverless, where each warm instance has its own memory, and needs nothing at all in a container.

### Single-user first, multi-user carefully later

Multi-user credential management is a pain (credential stores, rotation, per-user scoping). Start single-user — one set of credentials in the environment. Multi-user only when there's a clear reason and a design that doesn't compromise the simplicity.

### Permissive license (MIT or Apache 2.0 — pick one before first publish)

- Both are permissive — safe to use on client engagements without copyleft concerns.
- The tool contains zero client data; it reads APIs at runtime with credentials the client provides.
- Running it within a client's network means no data exfiltration question exists.
- Consultants bring their own tools constantly; this is no different from using Postman.

## Config Schema Precedent

No reusable dashboard config standard exists. Every tool (Grafana, Dashy, Homer, Smashing) invented its own format. However, they converge on the same patterns:

| Concern | Prior art model |
|---|---|
| File format | YAML (Dashy, Homer) |
| Panel layout | Grafana's `{x, y, w, h}` grid coordinates |
| Per-widget refresh | Homer's `updateIntervalMs` |
| Links to sources | Dashy's `url` per item |

The schema will be custom but the design decisions are borrowed, not invented.

## Why This Space Is Underserved

1. **Data source fragmentation.** The old "build monitor on a TV" worked when you had one CI server. Now signal is scattered across GitHub, ADO, multiple CI systems, observability platforms, chat. Nobody wants to build bespoke glue.

2. **SaaS-only incumbents.** Jellyfish, Swarmia, Pluralsight Flow, LinearB all want your tokens piped to their cloud. Many orgs won't do that with sensitive organizational signal (commit patterns, build health, who's touching what).

3. **The meta-utility problem.** The value of team-visible dashboards is in shaping behavior (people react to indicators with action). That's hard to sell to someone who hasn't experienced the feedback loop. The ROI is measured in trust, which is circular to someone who doesn't already value it.

4. **AI might actually help here.** Ironically, the "fetch from 5 APIs and normalize" glue work that made these painful before is exactly what LLM tooling is good at accelerating. The dashboard itself isn't hard; the ETL was.

## Signals and Sources

These are two separate axes, and keeping them separate is what stops the tool from becoming an ADO dashboard.

### Signals (what a panel means)

Panel types are named after the *question they answer*, never after the system they read. Three cover the core trust signals:

1. **Pipeline status** (`pipeline-status`) — latest run of a named pipeline (pass / fail / running / unknown).
2. **Deployed version** (`http-value`) — a value pulled from an HTTP endpoint (health check, version endpoint).
3. **Test count** (`test-count`) — number of tests reported by the latest run.

"Are standards intact" (pipeline), "is the thing actually deployed" (version), "is the suite growing" (tests). A `pipeline-status` panel means the same thing whether the run happened in ADO, GitHub Actions, GitLab, Jenkins, TeamCity, or CircleCI — the board author changes `source`, not `type`.

Test count is listed third because it's the one deferred past the MVP: it's a separate API from build status in ADO, absent entirely when a pipeline publishes no results, and the honest rendering for "nothing reported" is still undecided (see *Still open*). Note also that a test count is not coverage — it says the suite exists and is growing, not that it covers anything. Treating it as a coverage proxy is exactly the kind of unearned assertion this tool is supposed to avoid.

### Sources (where the answer comes from)

Each source type is an adapter that maps its upstream's vocabulary onto the normalized signal. The adapter owns everything source-specific: auth scheme, URL construction, status vocabulary, pagination, and the deep link back to the run.

**Normalization is the actual work of this project.** Mapping every CI system's status vocabulary onto pass/fail/running is genuinely lossy, so the normalized model carries both the canonical status and the raw upstream value — a panel can then display the honest thing, and the link leads to the authority. What that display should be for the in-between cases is still open; see *Status vocabulary normalization is lossy*.

### The signal envelope

Each signal type has its own payload shape — that's what "panels are defined by the signal they show" means, and a `pipeline-status` payload has nothing in common with an `http-value` one. But three things are true of *every* panel, and the doc leans on all three, so they live in a shared envelope rather than in each signal's payload:

```
{
  panelId: "api-build",
  state: "ok" | "error",       // could the reading be taken at all?
  observedAt: "2026-08-17T14:32:05Z",   // from the upstream response Date
  link: "https://dev.azure.com/...",    // adapter-derived; the authority for this panel
  signal: { ... }              // type-specific, absent when state is "error"
  error: { kind, message }     // present only when state is "error"
}
```

The envelope exists because *"is it fresh"* and *"did it fail"* are asked identically of every panel — the age disclosure (*Caching by Passthrough Revalidation*) and the error state (*Still open*) are both universal requirements, and duplicating them per signal type invites one adapter to forget. `signal` is deliberately unconstrained: adding a signal type means adding a payload shape, not touching the envelope.

Two consequences worth stating early, since both are easy to get wrong once and live with:

- **`state: "error"` is still an HTTP 200.** An unreachable upstream is a successful report of a failure, not a proxy failure. Reserving 5xx for the proxy's own breakage keeps the two distinguishable in the browser, which the error-state design needs. `error.kind` is a small closed set (`unreachable`, `unauthorized`, `not-found`, `upstream-error`) because those want different visual treatments; the free-text `message` is for humans, never for branching.
- **`link` and `observedAt` are populated even when `state` is `"error"`.** A panel that can't reach its source is exactly when a viewer most wants to click through to the authority, and knowing *when* the failure was observed is the difference between "broken just now" and "broken all morning."

**Where a signal fans out to several upstream calls** — ADO's `test-count` needs build status and test results; trend lines need pagination — the envelope stays singular: one panel, one envelope, one `observedAt` (the oldest of the contributing responses, since that's the honest one). Validator forwarding is the casualty: with two upstream `ETag`s there is no coherent one to relay, so a fanned-out panel simply forwards no validator and revalidates fully. Both `pipeline-status` and `http-value` are 1:1, so this doesn't bite in the MVP, but the passthrough design shouldn't be written as though 1:1 always holds.

### The adapter interface

Simplest thing that could work, written down early so Stage 3 has something to argue with rather than an invented shape to reverse-engineer:

```typescript
interface Adapter {
  type: string                              // "azure-devops", matches source.type in YAML
  signals: string[]                         // which signal types this adapter can serve
  refreshFloor: string                      // "30s" — clamps board and panel refresh
  permittedCalls(panel, source): UpstreamCall[]   // what the allowlist derives from
  fetch(panel, source, http): Promise<Envelope>   // do the calls, return the envelope
}
```

Four choices in there worth naming:

- **One adapter per source type, not per (source, signal) pair.** ADO's `test-count` needing a second endpoint is a branch inside `fetch`, not a separate adapter. Splitting per signal would duplicate the auth scheme and URL-construction knowledge that's the whole reason the adapter exists.
- **`http` is injected, never imported.** This is what makes fixture replay work: tests hand in a recorded-response implementation, production hands in the real one with credentials attached. An adapter that calls `fetch()` directly is untestable without credentials, which defeats the Stage 0 fixtures.
- **`permittedCalls` is separate from `fetch`.** The allowlist is derived by asking every panel's adapter what it *would* call, before any request arrives — so the derivation is inspectable, testable, and reviewable in the one quarantined file. An adapter whose `fetch` reaches somewhere `permittedCalls` didn't declare is a bug the proxy should catch and refuse, not trust.
- **The adapter returns the whole envelope**, including `link` and `observedAt`. Deep-link construction and knowing which response's `Date` matters are both source-specific; nothing above the adapter has the knowledge to fill them in.

Expect this to change in Stage 3 — that's what Stage 3 is for. Committing to it now costs nothing and gives the second adapter a concrete thing to break.

### Adapter order, and what it's chosen to prove

**Azure DevOps first**, because it's the immediate need and the most awkward API of the set — a PAT-based scheme, split build-vs-test-results endpoints, and inconsistent cache headers. Building the hardest one first keeps the abstraction from being shaped around an easy case.

**GitHub Actions second, and before the abstraction is called done.** One adapter proves nothing about generality; the second is what reveals whether the normalized model actually holds. GitHub's auth (token or App), status vocabulary, and pagination differ enough to be a real test, and it's the most likely source for anyone who isn't the first user.

`http-value` is effectively a third, source-agnostic adapter, and belongs in the MVP for the reason given in Stage 4. Beyond those, plausible adapters in rough order of demand: GitLab CI, Jenkins, CircleCI, then non-CI signals (observability platforms, incident tooling) which likely stretch the model in ways the CI-shaped abstraction won't absorb cleanly.

## Authentication and SSO

### Design Principle

The dashboard never implements auth. Auth is either handled externally or absent — there is no built-in user model, session store, or login page.

### Config-Driven, Not Mode-Driven

Authentication is controlled solely by the presence or absence of an `auth` section in config:

- `auth` section present → enforce on every proxy request, regardless of where it's running (deployed or localhost)
- `auth` section absent + binding to localhost → run quietly, no friction
- `auth` section absent + binding to nonlocal address → emit a loud startup warning ("No auth configured. This instance is accessible to anyone who can reach it.")

There is no `--local` flag or deployment mode toggle. A developer testing auth locally just adds the `auth` block to their config and gets the same code path as production.

### Token Validation Is Always the Proxy's Job

When `auth` is configured, the proxy validates a JWT on every inbound request — regardless of how the token got to the browser. This is the zero-trust guarantee: no request reaches upstream APIs without a cryptographically verified identity, even if someone bypasses a gateway, hits the proxy directly, or forges headers.

Validation uses OIDC Discovery. The proxy fetches `{issuer}/.well-known/openid-configuration`, retrieves the JWKS keys, and checks every token against them. Guarantees:

- HTTPS on the issuer URL proves the signing keys came from the real provider
- The `iss` claim must match the configured issuer — tokens from other providers are rejected
- The `aud` claim must match the expected audience — tokens meant for other apps are rejected
- Key rotation is automatic (JWKS endpoint updates, proxy picks up new keys on next refresh)
- Misconfiguration fails closed (rejects everything, never accidentally accepts the wrong tokens)

If a session is revoked mid-viewing, the next poll fails validation and the dashboard goes dark immediately.

### Authentication Is Not Authorization

Validating `iss` and `aud` proves the caller is *someone the IdP recognizes* — which in a large tenant includes every employee and any guest account. All of them would then be borrowing the same upstream service credential. So the `auth` section needs an allowlist:

```yaml
auth:
  issuer: https://login.microsoftonline.com/{tenant}/v2.0
  client_id: abc-123-def
  allow:
    groups: [ "team-alpha-viewers" ]     # group OIDs from the token's claims
```

Absent an `allow` block, "authenticated" means "anyone in the tenant" — which may be a fine answer for an internal build radiator, but it should be a stated choice rather than an accident. The prototype can start with a hardcoded subject list; the shape just needs to exist.

### Token Audience, and the Unavoidable One-Time Cost

Registering an SPA public client is not by itself enough for the proxy to validate an `aud` that means "this dashboard." The IdP also has to know the proxy as an API. In Entra that means exposing an API and a scope (`api://{client-id}/dashboard.read`) that the frontend requests a token for.

The tempting shortcut — sending the ID token as a bearer token — is the classic anti-pattern and should be explicitly rejected: ID tokens are audienced to the client, not the API, and aren't meant to authorize API calls.

This registration cost cannot be designed away: the IdP must know about the client to assert "I issued this token for this specific app." It's the same cost any internal web app pays. Call it an afternoon, not the advertised five clicks — the click count really is small, but the failure modes are subtle.

The dashboard minimizes it in three ways. Only one client registration is needed total, since the frontend and proxy share it. Multiple redirect URIs on that one registration cover both deployed (`https://dashboard.internal/callback`) and local (`http://localhost:3000/callback`) use. And gateway mode may avoid the cost entirely where the gateway publishes its own JWKS (Cloudflare Access does) — the proxy then validates against the gateway's issuer instead of the org's IdP, and needs no `client_id` at all.

### Two Patterns for Token Acquisition

The distinction between deployment patterns is *who acquires the token* — validation logic is identical in both cases.

**Direct OIDC mode.** The dashboard frontend initiates OIDC flows itself. Config needs two values:

```yaml
auth:
  issuer: https://login.microsoftonline.com/{tenant}/v2.0
  client_id: abc-123-def
```

A standard library (e.g., `oidc-client-ts`) discovers endpoints, handles the PKCE redirect flow, acquires tokens, and refreshes them — all derived from the issuer URL.

**Gateway mode.** The org already runs an identity-aware reverse proxy (OAuth2 Proxy, Pomerium, Cloudflare Access, Entra App Proxy, etc.). The gateway handles token acquisition and either forwards the JWT to the backend or issues its own signed assertion. The frontend doesn't do OIDC flows — the gateway's cookie rides along on same-origin requests to the proxy. This is the load-bearing case for same-origin: a CDN-hosted frontend calling a separate proxy origin could not do it, because the cookie wouldn't be sent cross-origin and JS can't read an HttpOnly cookie to build an `Authorization` header itself. Config still requires the issuer so the proxy can validate:

```yaml
auth:
  issuer: https://login.microsoftonline.com/{tenant}/v2.0
  # no client_id needed — frontend doesn't do the flow
```

In both cases, the proxy validates the same way. Gateway mode saves you from needing a `client_id` and from the frontend doing OIDC redirects, but it does not replace proxy-side validation. A gateway that sets `X-Forwarded-Email` without passing a verifiable token is not sufficient — the proxy must always verify a cryptographic signature, never trust a plain header.

### Security Boundary

The proxy is the sole enforcement point: it serves the entrypoint, holds the credentials, and bounds which upstream calls exist. The client assets need no protection at all, for the reason given in *Core Architecture*. All upstream API credentials live in the proxy's environment; the browser never sees them. The JWT only proves "this user is allowed to ask the proxy for data," not "this user has direct access to upstream systems."

The injected `window.env` block is browser-visible by definition, so it may contain only public values — issuer, client ID, asset path, board name. Anything secret belongs in the proxy's environment and must never reach the template.

### Deployment Guidance

Deployment templates (Helm charts, CloudFormation, Terraform) include the `auth` section with placeholder values that won't pass validation — deployers must fill them in or the proxy refuses to start. The local docker-compose omits the section entirely. This makes the secure path the default path for deployment, while local development remains frictionless.

## Widget Extensibility

### The Host/Widget Split

Teams should be able to write and host their own widget frontends without forking or rebuilding the dashboard. A widget is a self-contained UI component that the dashboard loads at runtime from a URL. The dashboard is a host — it provides a render target, passes config, and gets out of the way.

### Widget as a Remote Module

A widget is a JavaScript module (ES module) hosted at any URL — a CDN, a blob storage bucket, a raw git URL, an internal package registry. The dashboard config references it by URL:

```yaml
panels:
  - type: custom
    widget_url: https://cdn.example.com/widgets/deploy-timeline/v2/index.js
    signal: pipeline-status      # which built-in signal the host polls and pushes in
    source: ado-main
    pipeline: 42
    config:
      environment: production
      depth: 10
    connect: [ ]                 # extra origins the widget's CSP permits; empty by default
    position: { x: 0, y: 0, w: 6, h: 4 }
```

The dashboard fetches the module, instantiates it, and mounts it into a container element. The widget never knows where it's running or what other widgets exist on the board.

Widgets receive the same signal envelope built-in panels do, which means a widget author inherits `state` and `observedAt` and can honor the error and staleness rules rather than reinventing them — or ignore them, which is a reason to review widget config in a PR.

A custom widget is a *replacement renderer for an existing signal*, not a new data source. `signal` plus its source fields is what gives the host something to poll on the widget's behalf — without it there is nothing to push, and the widget can only render its static `config`. This also keeps the allowlist story unchanged: the permitted upstream call is derived from `signal`/`source` exactly as it is for a built-in panel, and a widget URL never enters that derivation. New *sources* remain the harder problem (see *Source extensibility* under *Still open*).

### Widget Contract

A widget module exports a single render function conforming to a minimal contract:

```typescript
interface WidgetContext {
  container: HTMLElement           // where to render — local to the widget's own frame
  config: Record<string, any>      // the config block from YAML
  data: Envelope | null            // latest envelope for this panel, or null before first load
  onData(cb: (data: Envelope) => void): void  // called on every refresh
}

export function render(ctx: WidgetContext): void | (() => void)
// Return value is an optional cleanup function called on unmount
```

That's it. No framework requirement, no build tool dependency. A widget can be vanilla JS, React, Svelte, a canvas — whatever fits in an ES module that exports `render`.

Two corrections to the naive version of this contract:

**The container is frame-local, not host DOM.** A DOM element cannot cross an iframe boundary — it isn't structured-cloneable, so it can't be passed via `postMessage`. What actually happens: the host serves a small first-party bootstrap document into the iframe, that document imports the widget module and creates the container element *inside its own frame*, and it relays `postMessage` traffic to and from the host. The widget sees a plain `HTMLElement`; it just belongs to the sandboxed document. The bootstrap HTML must be served by the host (not the widget's origin) so the host retains CSP control.

**Data is pushed, not fetched.** Widgets cannot hold upstream credentials, so a widget that could only read its own config would be able to render nothing but static text. The host owns polling and pushes results in over `postMessage`; `onData` is how the widget subscribes. Note what the context object deliberately omits: no refresh interval, no source URL, no fetch helper. Freshness and fetching are the host's business, and a widget that can't reach upstream can't undercut the disclosure rules either.

### Isolation via Iframe Sandbox

Widgets run in sandboxed iframes by default. The dashboard creates an iframe per widget panel, loads the module inside it via the bootstrap document, and communicates via `postMessage`. This provides:

- **Origin isolation** — widget code cannot access the host page's DOM, cookies, or localStorage
- **CSP per widget** — the iframe's Content-Security-Policy restricts network access to the widget's own origin plus whatever the panel's `connect` list permits, which is empty unless the config author adds to it
- **Crash containment** — a broken widget can't take down the board

The host controls what the iframe can do via the `sandbox` attribute and `allow` directives.

### Versioning and Trust

Widget URLs are explicit in config — there's no auto-update. Pinning to a versioned path (`/v2/index.js`) or a content-hashed filename gives the config author full control over what code runs. Updating a widget is a config change (reviewed in a PR like any other config update).

For orgs that want additional assurance, the dashboard could support optional integrity checking (Subresource Integrity hashes in config). But the primary trust model is: if you control the config, you control what loads.

### What Widgets Cannot Do

- Widgets cannot access the proxy's credentials or make authenticated upstream calls on their own — they render the data the host pushes them, and reach the network only where the panel's `connect` list explicitly allows it
- Widgets cannot communicate with other widgets on the same board
- Widgets cannot modify the dashboard host or its config
- Widgets cannot escape the iframe sandbox unless the panel sets `trusted: true`, an explicit config opt-out for first-party widgets needing tighter host integration

### Keeping It Simple for Authors

Writing a widget is: one file, one exported function, deploy it anywhere static files can be served. No SDK to install, no registry to publish to, no build step mandated. The simplest possible widget:

```javascript
export function render({ container, config, onData }) {
  container.innerHTML = `<h1>${config.title || 'Hello'}</h1>`
  onData(data => container.innerHTML = `<h1>${data.value}</h1>`)
}
```

Note that widget hosting is the same immutable-assets story as the dashboard's own client (see *Core Architecture*): versioned path, permanent location, CORS-permissive, no environment values inside. Widgets are not a separate mechanism — they're the same principle applied one level down.

**Not in the MVP.** The widget system is the most speculative part of this document and depends on the panel/data pipeline being settled first. Ship the MVP with built-in panel types only; revisit this once there's a real second consumer asking for it.

## Road to MVP

**MVP definition:** two panel types (`pipeline-status`, `http-value`) rendering from two source types (Azure DevOps, GitHub Actions) on one YAML-configured board, running locally via `docker compose up`.

Deliberately **not** in the MVP: auth, custom widgets, layout engine, trend lines, shared caching, multi-board. Each has a home in this document already.

**The governing bias is "get the damn thing working, then improve it."** Where this document records a decision, it's the simplest one that doesn't paint the design into a corner — the goal is a thing on a screen that a team reacts to, not a complete specification. Two things earn exceptions and get done properly the first time, because both are cheap now and dishonest-by-default if deferred: disclosing a reading's age, and not encoding status in color alone. Everything else is allowed to be crude and get better.

### Stage 0 — Capture fixtures (half a day)

Hit a real build-status endpoint on ADO and on GitHub, and save the raw JSON — deliberately including the awkward cases: `succeededWithIssues`, a cancelled run, an in-progress run, a pipeline that publishes no test results.

This is the one genuine prerequisite. The normalized signal model in Stage 2 is shaped by what these responses actually contain, and the fixtures are how an agent verifies adapters without credentials. An agent will not invent the awkward cases unprompted, and those are where normalization bugs live.

(Cache headers will come along in the same `curl -i` output, and they're worth a glance — but nothing in the MVP branches on them, so no decision waits on the answer. See *Caching by Passthrough Revalidation*.)

### Stage 1 — Immutable shell, no data (1 day)

Server fetches the template from the pinned `assetPath`, replaces the sentinel, injects `window.env`, and serves it `no-store`; client built once with the sentinel base and published with its template; `docker compose up` works. Publish *two* versions during this stage — the second differing visibly from the first — since one version can't demonstrate the property that matters.

**Done when:** repointing the server at the other pre-built client version — changing one env value, rebuilding nothing — visibly changes the page. This is the IWA proof, and it's cheapest to establish before there's anything else to debug.

### Stage 2 — One signal, one source, end to end (2 days)

The signal envelope, the `pipeline-status` payload, the ADO adapter behind the interface above, `GET /api/panel/{board}/{panelId}` returning that envelope, and a panel that renders pass/fail/running. Board config parsed from YAML via the shared zod schema. Allowlist derived from `permittedCalls` in its own reviewed file. Passthrough revalidation headers wired.

Include a plain "as of HH:MM" on the panel, read from the envelope's `observedAt`. Trivial to do, and it has to land here rather than in Stage 5: the caching design's honesty depends on a cached value never being displayed without its age. Visual polish can wait; the disclosure can't.

**Done when:** a real pipeline's real status is on screen with its timestamp, and an unreachable upstream renders as an explicit error state rather than a stale green.

### Stage 3 — Second source, same signal (1–2 days)

The GitHub Actions adapter behind the same `pipeline-status` panel type. Different auth scheme, different status vocabulary, different pagination.

**Done when:** one board shows an ADO pipeline and a GitHub pipeline side by side, and the only per-source knowledge in the frontend is zero. This is the stage that validates the normalized model — and the one most likely to force a rewrite of Stage 2's signal shape, which is exactly why it comes before anything is built on top.

### Stage 4 — Second signal, source-agnostic (half a day)

`http-value` — fetch a URL, extract via JSON path, render the string. Nearly free, and it demonstrates the tool isn't CI-specific.

**Done when:** a deployed version string sits on the same board as the two pipelines.

### Stage 5 — Make it a radiator (1–2 days)

Fixed 12-column grid honoring `{x,y,w,h}`. Staleness *emphasis* — the raw timestamp already landed in Stage 2, so this is the visual treatment for an aging panel. Adapter-derived source links. Legibility at TV distance.

**Status is never encoded in color alone.** Pair every status with a glyph or emoji — ✅ ⚠️ ❌ 🔄 is fine and costs nothing — so a red/green-colorblind viewer reads the same thing everyone else does. This is the cheapest possible version of the right answer, deliberately: it's one character next to a color, not a design system. Real accessibility work (contrast ratios, motion, screen-reader semantics) is a later evolution, and doing the glyph now means that work is an improvement rather than a correction.

**Done when:** it's been on a real screen for a day and the team reacted to something on it.

### Sequencing notes

Two ordering choices carry most of the risk:

- **Stage 1 before Stage 2.** IWA plumbing is the piece with no visible payoff and the most fiddly failure modes (sentinel replacement, cache headers, CORS on the asset host). Proving it against a blank page is far cheaper than debugging it alongside a broken ADO adapter.
- **Stage 3 before Stages 4–5.** The second adapter is the only real test of the normalization layer, and it's near-certain to change the signal model. Every panel and layout feature built before it is potential rework.

Rough total: **6–8 working days** of agent-driven build, plus review. Stage 3 is the one likely to overrun.

## Implementation Approach

This prototype is intended to be built primarily by agents, which changes the selection criteria: what matters is generation quality and **review surface**, not personal familiarity or contributor ecosystem.

### Language: TypeScript end-to-end

Server on Hono, frontend on Vite, one shared package holding a `zod` schema for the board config.

The deciding factor is that the proxy's permitted-call allowlist and the frontend's renderer must agree on the board schema, and after the allowlist decision above that agreement is *security-relevant*. A shared zod schema makes it one reviewable artifact — one definition, runtime validation both sides, inferred types both sides — which also closes the config-validation gap listed below. Any split-language option means two parsers, two implementations of the security-relevant part, and double the human attention on the file where attention matters most.

Secondary reasons: deepest training data of the candidates, so the highest first-pass generation quality; strict mode plus zod gives an agent a fast machine-checkable signal; Hono runs on Node, Bun, Deno, Lambda, and Cloudflare Workers with the same handler code, which makes the "serverless or container" claim nearly free rather than aspirational; and the OIDC/JOSE library story (`jose`, `oidc-client-ts`) is the best available.

Options considered and rejected:

- **Kotlin Multiplatform** — the natural choice on prior art (`Essays/TheIncredibleImmutable.md`) and the fastest to hand-write, but the worst fit for agent authoring. Gradle/KMP build configuration is where current models are weakest, and failures surface as opaque build errors rather than type errors — maximum agent flailing for zero user-visible value. Kotlin/JS external declarations for JS libraries have the same problem.
- **Go server + TS frontend** — best operational story (static binary, fast cold start) and genuinely good review properties: small language surface, `gofmt` removing style variance, explicit error handling that makes generated mistakes visible in a diff. Loses on the duplicated allowlist.
- **Kotlin server + TS frontend** — pragmatic, but pays the duplicated-parser cost without a compensating benefit under agent authoring.
- **Deno end-to-end** — the runtime network allowlist (`--allow-net=dev.azure.com,...`) is a security property an agent *cannot accidentally undo by writing wrong code*, which is worth real money here and bounds the SSRF concern at the runtime rather than in application logic. Rejected only because models still generate Node-isms in Deno projects. Reconsider if that guarantee becomes more appealing than the generation-quality edge.

### Constraints that matter more than the language

- **One fast `check` command** — every validation the project has, in a single invocation, target under ten seconds. This is the agent's entire feedback loop; if it's slow or multi-step, output quality degrades immediately.

  Start with typecheck (`tsc --strict --noEmit`, all three packages), lint, unit tests against the Stage 0 fixtures, and zod-validation of the example board configs — that last one is cheap and catches the schema drifting from its own documentation. **Expect the list to grow.** Anything worth catching belongs in `check` rather than in a separate command nobody remembers to run: allowlist assertions, a "no panel reaches an undeclared upstream" test, link-shape checks. The ten-second target is a budget to optimize against as things get added (parallelize, cache, scope to changed packages), not a reason to leave a validation out.
- **Recorded upstream fixtures, per source** (captured in Stage 0). Without them an agent cannot verify the part of the system most likely to be wrong, and the result is code that typechecks and doesn't work.
- **Boring build tooling.** Vite, nothing exotic. Bundler config is a classic agent time sink, and the sentinel `base` already touches it.
- **Curated dependencies.** Models add packages freely, which is a poor fit for a tool whose pitch is trustworthiness. Additions need justification.
- **Quarantine the allowlist.** The config-to-permitted-upstream-calls derivation lives in one small file with exhaustive tests, flagged as requiring human review on every change. Everything else here is a rendering bug when wrong; that file is a vulnerability.

## Prototype Gaps

### Resolved

Five of these fell out of adopting Immutable Web Apps:

- Where browser config comes from — injected into `index.html`, not fetched.
- CORS between frontend and proxy — same origin, so none.
- Gateway-mode cookie forwarding — same origin, so it works.
- `/boards/{name}` routing on static hosting — server renders the entrypoint, so any path works.
- Private board config — fetched through the proxy, so it needn't be public or CORS-enabled.

And three were settled on their own terms:

- Per-viewer redundant polling — passthrough revalidation, with no proxy-side storage.
- Refresh interval ownership — board default, per-panel override, adapter floor clamping both.
- Language choice — TypeScript end-to-end, decided on agent-authoring criteria.

### Deferred until the project matures

- **Shared cache for multi-viewer fan-out.** Passthrough revalidation cuts each viewer's redundant calls but not the fan-out across viewers: a TV plus eight laptops on a ten-panel board at 60s is still on the order of 5,000 upstream calls/hour, against upstream rate limits. Collapsing those into one upstream call requires a cache shared across viewers, and — on serverless, where each warm instance has its own memory — shared across instances. That means defining a backend, which is exactly why it waits. A process-local in-memory cache is available cheaply as a container-only stopgap if rate limiting bites during the prototype.

### Still open

- **Error and stale states are the product, not a detail.** A trust radiator silently showing a green pipeline from 40 minutes ago is worse than no radiator. The *data* side is now settled — the envelope carries `state`, `error.kind`, and `observedAt`, so the frontend has everything it needs — and what remains is purely display: at what age does a panel visibly de-emphasize itself, do the four `error.kind` values get four treatments or fewer, and on outright failure does it hold last-known-value with a marker or go blank? (That last one is where the no-persistence rule gets negotiated: holding a last value means the browser keeps it, never the proxy.)
- **Status vocabulary normalization is lossy.** The model carries canonical status plus raw upstream value (see *Sources*), but the *display* rule for the in-between states is undecided. ADO's `succeededWithIssues`, GitHub's `neutral`, GitLab's `manual` — "green but with warnings" is a trust signal rather than noise, so rendering it as plain green is a small lie and rendering it as red is a larger one.
- **`test-count` is API-shaped differently per source, and often absent.** In ADO, build status and test results are separate APIs, and results exist only if the pipeline publishes them; other CI systems differ again. What does the panel render for a pipeline that publishes nothing — zero, blank, or "not reported"? These are three different meanings and only one of them is honest. This is why the signal is named in *Signals* but deferred past the MVP.
- **What each source's refresh floor should actually be.** The three-layer refresh design settles *who decides*; it doesn't supply the numbers. GitHub is explicit (5,000/hr authenticated, conditional requests exempt); ADO throttles on a less documented basis; a self-hosted Jenkins has no limit but a slow API. The ADO floor in particular will have to be found empirically.
- **Polling behavior under load — deferred until there are enough panels to feel it.** Jitter so ten panels don't fire in the same instant, whether a backgrounded tab polls at all, and backoff after a 429 or 5xx. All three are additive changes inside the frontend's polling loop: the envelope already carries what's needed to render a backed-off panel honestly, and refresh floors already exist as the place a limit would be expressed. Worth revisiting once a real board has a dozen panels on it, not before — a guess made now would be tuned for imaginary traffic.
- **Layout grid is undefined.** Grafana's `{x,y,w,h}` is borrowed without specifying row unit height or TV-vs-laptop responsive behavior. v1 is fixed 12-column, fixed row height, no responsiveness — and `position` is advisory, so a board that omits it still renders. That's enough to keep layout replaceable later without blocking Stage 5, but the row unit and overflow behavior (what happens when panels overlap or run off the bottom) still need answers.
- **Config format versioning.** Build versions come from [Tagger](https://github.com/robertfmurdock/ze-great-tools) — commit-annotated major/minor/patch, tagged and released automatically — which is what pins asset paths and needs no further thought here. The board config format is a *separate* version axis, as file formats always are (see `Essays/HitTheGroundRunning.md`), and it's the one still open. Validation is settled: the zod schema rejects malformed configs at boot, and `check` runs it against the example configs. What's undecided is whether the file carries an explicit `version` field and how many the code supports at once — worth answering when someone else's config first exists in the wild, and not before.
- **Historical depth.** "Last 20 builds" for a trend line means the proxy handles paginated upstream responses and normalizes them — and pagination styles differ per source (continuation tokens, `Link` headers, page numbers). Real work, and it lands squarely on the proxy.
- **Multi-source auth schemes.** Sources authenticate differently: ADO PATs, GitHub tokens or App installations (which need JWT signing and token refresh), cloud managed identity, plain bearer tokens. `token_env` covers the simple majority but not GitHub App installation flow. Does the adapter own credential acquisition, or does the config only ever name an env var?
- **Config location for multi-repo teams.** If signals span repos and pipelines, does the board config live in its own repo or a team-level location?
- **Startup walkthrough UX.** Terminal wizard before container start, vs. web form on first load? The web form is nicer but needs somewhere to persist credential validation state, which fights the no-persistence rule.
- **Source extensibility.** New source types as a plugin system, or just a new adapter in the repo? Note this is the *harder* half of extensibility: the widget system above covers rendering, but a new fetcher needs proxy-side code, and the allowlist means it can't be loaded from an arbitrary URL the way a widget can. Adapters may simply have to be contributed upstream — which is an argument for the adapter interface being small and well-documented early.


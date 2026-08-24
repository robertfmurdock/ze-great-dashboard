# Trust Dashboard: Implementation Status

This is the living engineering companion to [the original pitch](./original-pitch.md). The pitch
records the product idea and architectural reasoning as it existed before implementation. This
document records what is actually in the repository, what has been verified, and where reality has
changed the sequence or scope.

Detailed dated slices are recorded in [the Stage 4 HTTP value log](logs/stage4-http-value-log.md),
the earlier [Stage 2 GitHub Actions log](logs/stage2-github-actions-log.md), and the [dashboard
package and deployment log](logs/dashboard-package-log.md). See the full
[implementation-log index](logs/README.md) for all records.

## Deployment status

`public-assets.zegreatrob.com` is live and is the stable public package contract. The release
workflow publishes that tarball's versioned client assets, then deploys the exact pre-publish tarball
through one persistent consumer reference stack. The existing infrastructure provision owns its
artifact bucket and scoped roles. Its board has no third-party source, so it verifies package,
artifact, CloudFormation, Lambda, and hosted-client integration without asserting an upstream panel's
availability.

The same verified `main` release also publishes the server-only Docker image to GHCR with an exact
semantic-version tag and the `latest` alias. Compose runs the published image by default and has an
explicit local-build override; the image still receives `ASSET_PATH` at runtime and never contains
the client build or environment-specific configuration.

## Current checkpoint

The repository has the immutable web application shell and the first live data slices working
locally. The current implementation includes:

- Immutable client assets with a server-rendered, no-store entrypoint and injected `window.env`.
- YAML board configuration validated once at startup.
- A bounded panel endpoint; the browser supplies a board and panel id, never an arbitrary URL.
- GitHub Actions `pipeline-status` panels with normalized status, source links, timestamps, cache
  validator forwarding, and explicit upstream error envelopes.
- Independent client polling with panel/board/default refresh precedence, no overlapping requests,
  304 preservation, and lifecycle cleanup.
- Server-authoritative client update checks: the browser polls the no-store client identity endpoint
  every 60 seconds and reloads when the server selects a different immutable client.
- Source-agnostic `http-value` panels. They fetch configured HTTP(S) endpoints, accept plain scalar
  text or JSON, and support the deliberately small field-and-index JSON-path subset.
- Radiator layout polish: configured 12-column positions are rendered, narrow screens collapse to a
  readable single column, and every observation discloses relative age with stale readings emphasized.
- Local development watches the configured board file, so editing deployable board configuration
  restarts the server listener without making the example board itself part of the product contract.
- Docker, Lambda bundling, publishable local consumer/AWS packages, fixture-driven tests, and the
  repository-wide `npm run check` gate.

Verification covers the client production build, the core board validator, AWS adapter Lambda
archives, publish staging, the checked-in reference consumer inputs, scoped reference IAM names, and
the release ordering. The GitHub workflow builds one exact-version AWS adapter tarball, publishes its
versioned client assets, deploys that tarball to the consumer reference, publishes it through npm
trusted publishing, confirms registry visibility, and only then creates the Git tag; core and shared
remain internal workspace packages.

Snapshot versions such as `0.6.0-SNAPSHOT` use the same checks and exact tarball path, then run
npm connectivity and publish validation in dry-run mode. They do not publish client assets, AWS
references, npm packages, Docker images, or Git tags. The workflow keeps this as one release
version source and gates only the externally visible boundary, so stable releases follow the same
shared path. Other prerelease conventions are not part of the release contract.

## Development workflow log

Recorded 2026-08-21: browser diagnostics now form a client-only feature boundary: a versioned,
typed event union is recorded through a narrow sink into browser-local retained evidence, and the
footer consumes the store through React's external-store API. Polling lives in `usePanelSignals`,
which preserves fetch, 304, parse-failure, transition, and cleanup behavior without coupling panel
work to `App`, storage, or the diagnostics UI. No server or shared event contract was added because
these are browser-local viewer observations, not source facts or server logs. Keep the explicit
panel branches until the next distinct panel type can introduce a registry that replaces them rather
than duplicating selection and presentation logic.

Recorded 2026-08-18: the server's TypeScript watcher now includes a local `BOARD_CONFIG_URL` path.
This keeps board edits in the normal local feedback loop. Remote board URLs are not treated as
filesystem watch targets, and deployed behavior is unchanged. The realistic team board remains an
example configuration rather than an ongoing product-history concern.

Recorded 2026-08-18: completed the first radiator layout pass. The example board now demonstrates an
asymmetric 8/4 split, while the team board groups build health first, gives the dashboard build a
full-width anchor, and presents published versions in a regular two-column section. Coordinates were
adjusted as a set so panels do not overlap. The client now renders those positions and marks readings
older than five minutes as stale while retaining the exact observation time.

## Deliberate differences from the pitch

### GitHub Actions came before Azure DevOps

The pitch chose Azure DevOps first because it was the immediate need and the harder adapter. In
practice, a legitimate read-scoped ADO fixture source and token were not available, while GitHub
Actions provided real public responses suitable for capture and replay. GitHub therefore became the
first source adapter. Azure DevOps remains the next source adapter when real fixtures and credentials
are available; its behavior will not be declared verified from invented responses.

### `http-value` is now implemented

The source-agnostic HTTP signal was inexpensive and demonstrated that the board model is not
CI-specific, so it followed GitHub polling rather than waiting for ADO. Its allowlist is derived
from the exact configured URL, and it has no named source or stored credential in the MVP.

### The roadmap is execution-oriented here

The original pitch's stages remain unchanged. This repository's practical sequence is:

1. Immutable shell and local deployment.
2. GitHub Actions pipeline status.
3. Independent live polling.
4. HTTP value panels.
5. Azure DevOps pipeline status, contingent on real fixtures and credentials.
6. Radiator polish: layout, staleness emphasis, and TV-distance legibility.

Authentication, custom widgets, shared caching, trends, test counts, and multi-user credentials are
still outside the current MVP.

## Working rule

When implementation forces a meaningful change in product intent, update this document or a focused
decision record. Do not rewrite `original-pitch.md`; preserving the original reasoning is useful
when evaluating which assumptions held and which did not.

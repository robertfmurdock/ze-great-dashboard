# Trust Dashboard: Implementation Status

This is the living engineering companion to [the original pitch](./original-pitch.md). The pitch
records the product idea and architectural reasoning as it existed before implementation. This
document records what is actually in the repository, what has been verified, and where reality has
changed the sequence or scope.

Detailed dated slices are recorded in [the Stage 4 HTTP value log](./stage4-http-value-log.md) and
the earlier [Stage 2 GitHub Actions log](./stage2-github-actions-log.md).

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
- Source-agnostic `http-value` panels. They fetch configured HTTP(S) endpoints, accept plain scalar
  text or JSON, and support the deliberately small field-and-index JSON-path subset.
- Local development watches the configured board file, so editing deployable board configuration
  restarts the server listener without making the example board itself part of the product contract.
- Docker, Lambda bundling, fixture-driven tests, and the repository-wide `npm run check` gate.

Verification currently passes with 74 tests, the client production build, and the Lambda bundle.
No infrastructure has been deployed from this repository yet; deployment claims remain recorded in
the initialization log until observed against real AWS resources.

## Development workflow log

Recorded 2026-08-18: the server's TypeScript watcher now includes a local `BOARD_CONFIG_URL` path.
This keeps board edits in the normal local feedback loop. Remote board URLs are not treated as
filesystem watch targets, and deployed behavior is unchanged. The realistic team board remains an
example configuration rather than an ongoing product-history concern.

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

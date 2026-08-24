# Stage 4 HTTP Value Implementation Log

Recorded 2026-08-18 after completing the source-agnostic value-panel slice and separating the
historical pitch from the living implementation record.

## What was implemented

The dashboard now supports `http-value` panels alongside GitHub Actions pipeline panels:

- `packages/shared/src/board-config.ts` accepts an HTTP(S) URL and an optional small JSON path.
- `packages/shared/src/envelope.ts` defines the normalized `http-value` signal payload.
- `packages/server/src/adapters/http-value.ts` fetches the configured endpoint, extracts scalar
  values, forwards cache validators, derives a source link, and reports upstream failures as error
  envelopes.
- `packages/server/src/allowlist.ts` permits the exact configured URL. The browser still supplies
  only the board and panel id, so this is not an arbitrary URL relay.
- `packages/server/src/app.ts` serves source-agnostic value panels through the existing panel route.
- `packages/client/src/HttpValuePanel.tsx` renders the value, source link, and observation time.
- The existing polling loop now refreshes `http-value` panels independently using the same interval
  behavior as pipeline panels.
- `boards/example.yaml` includes a public schema/demo value panel.

The adapter accepts plain scalar text and JSON scalar responses. JSON extraction intentionally uses
only the subset `$.field.nested`; arrays, wildcards, filters, and non-scalar results are rejected.

## Tests and verification

Coverage includes nested extraction, plain text, validator forwarding, missing paths, unreachable
sources, 304 responses, source-less routing, unknown-panel rejection, and client rendering.

Verification passed:

- `npm run check`
- 73 tests across 10 test files
- Client production build
- Lambda bundle build
- `git diff --check`

## Documentation decision

The original idea-pit document is no longer edited as implementation progresses. Its restored copy
lives at `docs/original-pitch.md`. The current state and deviations live in
`docs/implementation-status.md`; future implementation slices should add dated logs like this one
and update the status document when the roadmap changes.

## Next known work

Azure DevOps remains the next source adapter, pending legitimate read-scoped fixtures and
credentials. Radiator polish—layout interpretation, staleness emphasis, jitter/backoff, and TV
legibility—follows source validation. Authentication, custom widgets, shared caching, trends, and
test counts remain outside the MVP.

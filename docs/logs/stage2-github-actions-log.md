# Stage 2 GitHub Actions implementation log

Recorded 2026-08-17 during the first data-plane implementation, at the user's request.

## What was implemented

The repository now contains the first end-to-end `pipeline-status` slice using GitHub Actions as
the source:

- `packages/server/src/adapters/github-actions.ts` builds a workflow-runs URL from board config,
  attaches an optional environment token, forwards browser cache validators, normalizes GitHub's
  status/conclusion vocabulary, and returns the shared signal envelope.
- `packages/server/src/allowlist.ts` derives permitted upstream calls from the boot-time board
  config. The browser supplies a board and panel id, never an upstream URL.
- `packages/server/src/board-config.ts` parses YAML once at boot. Config and the derived allowlist
  therefore cannot drift independently.
- `packages/server/src/app.ts` serves `/api/boards/:board` and
  `/api/panel/:board/:panelId`. Upstream failures are reported as HTTP 200 envelopes with an
  explicit error state; cache metadata is passed through, including 304 responses.
- `packages/client/src/App.tsx` fetches the board and panel envelopes. `PipelinePanel.tsx` renders
  glyph + text status, source links, and an `As of HH:MM` timestamp.
- Fixture-driven tests cover success, failure, in-progress, cancelled, validator forwarding,
  unreachable-upstream errors, source links, and rejection of unknown panel ids.

## Client polling follow-up

Recorded 2026-08-18 after completing the next Stage 2 slice.

`packages/client/src/App.tsx` now keeps every supported `pipeline-status` panel current without a
page reload. Each panel is fetched immediately, then refreshed independently using panel `refresh`,
board `refresh`, or a 60-second default. Requests are guarded per panel so a slow upstream cannot
overlap with its next scheduled request. `304 Not Modified` responses leave the current envelope
in place, while fetch failures retain the existing panel behavior.

Polling timers are cleared when the board changes or the component unmounts, and late responses are
ignored. Board identity is tracked while configuration loads so a previous board cannot start
panel requests under a newly selected board name. The API and YAML schema remain unchanged.

Client tests cover immediate reads, interval precedence and defaults, rendered refreshes,
unsupported panel types, independent schedules, in-flight request protection, and lifecycle
cleanup. Verification passed with 67 tests, the production client build, and the Lambda bundle.

The shareable JetBrains project files are now committed under `.idea`; user-specific
`.idea/workspace.xml` remains ignored according to JetBrains' version-control guidance.

## Sequencing decision

Azure DevOps was intentionally not made a prerequisite. Its build REST API redirected to sign-in
for the public-looking sample organization, and creating a test organization prompted for a
payment card. We therefore use GitHub Actions first, with real public workflow fixtures, and defer
ADO until a legitimate read-scoped project/token source exists. This preserves the design rule
that fixtures are captured from reality rather than invented.

## Fixtures

`fixtures/github-actions/` contains redacted captures of real GitHub workflow-run responses for
completed-success, completed-failure, in-progress, and completed-cancelled runs. The JSON shape and
status/conclusion values remain intact; repository, user, commit, URL, and email identifiers were
replaced with shape-compatible examples. The fixture README records the capture and cache-header
observations without retaining request-specific identifiers.

## Discovery during live verification

Running `npm run dev` initially failed with:

```
ENOENT: no such file or directory, open './boards/example.yaml'
```

The npm workspace launches the server with `packages/server` as its working directory, so the
relative default path was wrong. `packages/server/src/config.ts` now resolves the repository's
default board file from `import.meta.url`; an explicit `BOARD_CONFIG_URL` remains available for
deployed/remote configuration.

After that correction, the real local path was verified:

- `GET /` returned 200 and injected `window.env` before the module scripts.
- `GET /api/panel/ze-great-team/web-build` returned 200 with a live GitHub response normalized to
  `passed`, including `ETag`, `Cache-Control`, `Date`, and the GitHub run link. GitHub's HTTP
  `Date` is RFC 1123; the adapter converts it to the shared envelope's ISO-8601 `observedAt`
  before it reaches the browser.
- The example board points at the public `actions/checkout` workflow used by the captures; private
  sources may set `GITHUB_TOKEN` through `token_env`.

## Verification checkpoint

At this checkpoint `npm run check` passes:

- Biome lint: 51 files
- Typecheck: root, shared, server, and client all pass
- Vitest: 9 files, 59 tests passing

The remaining known work is the `http-value` adapter, the second-source validation (ADO when
credentials are available), and visual radiator polish such as stale emphasis, jitter, and
backoff.

## Team board update

`boards/ze-great-team.yaml` has four live GitHub Actions panels, all using each repository's public
`.github/workflows/main.yml`: `robertfmurdock/coupling`, `jsmints`, `testmints`, and
`ze-great-tools`. A direct local-server verification returned `failed`, `passed`, `passed`, and
`passed` respectively. The coupling failure is the source's current state, not a fixture or proxy
failure. `boards/example.yaml` remains a deliberately small public schema/demo board.

## Board configuration separation and dev ergonomics

The realistic board is now kept in `boards/ze-great-team.yaml`; `boards/example.yaml` is a small
public one-panel schema/demo board. This keeps visual changes and real team repositories out of the
fixture-oriented example while leaving the application and adapter code shared.

`BOARD` is optional when a selected YAML contains exactly one board. Startup selects that sole board,
while multi-board files still require an explicit `BOARD` and reject unknown names with the available
names listed. This makes the normal team workflow one line:

```sh
BOARD_CONFIG_URL="$PWD/boards/ze-great-team.yaml" npm run dev
```

The Docker Compose board override is optional for the same reason. The board-file split and the
single-board selection behavior are covered by the schema/startup tests.

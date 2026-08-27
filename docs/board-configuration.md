# Board configuration

Ze Great Dashboard boards are YAML documents containing named sources and one or more named
boards. A panel refers to a source, identifies the signal type to render, and can define its
refresh interval, concise wall label, and grid position.

## Example

Save a configuration such as this one as `board.yaml`. The GitHub repository in this first example
is public, so it does not name a credential:

```yaml
sources:
  github:
    type: github-actions
    repo: your-org/your-repo
    # Optional; when present, only workflow runs for this branch are shown.
    branch: main

boards:
  operations:
    refresh: 60s
    running_refresh: 15s
    running_completion_refresh: 5s
    running_completion_window: 2m
    panels:
      - id: build
        label: Build
        type: pipeline-status
        display: primary
        source: github
        pipeline: main.yml
        position: { x: 0, y: 0, w: 8, h: 6 }
      - id: release
        type: http-value
        display: compact
        url: https://status.example.com/version.json
        json_path: $.version
        refresh: 5m
        position: { x: 8, y: 0, w: 4, h: 6 }
```

The board-level `refresh` is the default for panels that do not provide their own value. Refresh
durations use values such as `60s` or `5m`. Panel IDs must be unique within a board and are stable,
security-relevant proxy addresses; do not use a display rename to change one. `label` is optional,
presentation-only text for the wall display and defaults to the id. Positions use a twelve-column
grid: `x` and `y` locate the panel, while `w` and `h` define its size.

At desktop widths, positions are interpreted in an intended twelve-column by twelve-row space, but
the current renderer continues to honor authored coordinates and may create implicit rows. The
dashboard reports panels that exceed the intended space or overlap another panel; live rendering
does not move, resize, or hide them. Panels without a position retain CSS Grid auto-placement. The
warning offers a legal rendered YAML download that scales the explicit rendered area into 12×12 and
makes deterministic nearest-cell adjustments, plus an authored download that preserves the source
coordinates. Panels that cannot receive a legal cell retain all primary settings but use
`{ x: 0, y: 0, w: 0, h: 0 }`. Narrow screens intentionally use a single-column flow.

### Adaptive pipeline polling

`refresh` controls the normal cadence and defaults to `60s`. For panels whose latest
`pipeline-status` signal is running, `running_refresh` defaults to `15s`. When the signal includes
both `runStartedAt` and `estimatedDurationMs`, polling switches to `running_completion_refresh`
(default `5s`) at the estimated completion time. It remains there only for
`running_completion_window` (default `2m`), then returns to `running_refresh` if the run is still
active. A run without an estimate uses `running_refresh` and never enters the completion burst.

Each setting may be placed on the board or overridden on an individual panel. Panel values take
precedence over board values, which take precedence over these product defaults. The completion
window is deliberately bounded so a delayed run cannot keep the tighter cadence indefinitely.

Use the optional `display` role to express how much attention a panel should receive. `primary`
is for the most actionable signals, `supporting` is the default, and `compact` is for lower-priority
context such as version values. The role changes presentation density and typography; `position`
still controls the panel's grid footprint. Existing panels without a role retain the supporting
presentation.

Sources are reusable named definitions. Current source and panel adapters determine which
additional fields they accept; for example, `github-actions` uses `repo`, an optional `branch`,
and a workflow `pipeline`. When configured, the branch is sent to GitHub when finding the newest
run, so feature-branch runs do not replace the primary-branch status. When absent, GitHub returns
runs from all branches. `http-value` uses `url` and an optional `json_path` such as `$.version`.

## Active pipeline treatments

`pipeline-status` panels may set `running_animation` to `off`, or to one of `radial`, `runway`,
`orbit`, `signal-field`, `telemetry-bloom`, `release-transit`, `status-weather`, or
`falling-shapes`. Omission chooses one of those visible treatments at random whenever the panel
enters the running state, keeps it stable while that run is refreshed, and avoids repeating the
previous treatment on the next running transition. The first four are retained inline treatments;
the latter four are panel-scale decorative fields. `falling-shapes` measures the rendered panel and
scales an approximately square-cell field into its interior. Wide panels move pieces from right to
left, while tall and square panels move them from top to bottom. This setting changes only the
active-running presentation and never replaces the status label or timing text.

## Local animation demo

`pipeline-animation-demo` is a local visualization aid for comparing active pipeline treatments.
It does not name a source, refresh interval, credential, or API endpoint. Without
`running_animation`, it rotates through all eight supported visible treatments on a 20-second loop,
including the overdue treatment after its 15-second advisory estimate. Set `demo_run_duration` to
change that rotation interval. Give it a visible `running_animation` value to hold one treatment
for focused review; that review mode uses a five-minute estimated run followed by a short overtime
tail before restarting. Set
`demo_review_duration` to change the focused-review interval and estimate. Both fields use duration
values such as `20s` or `5m`; omitted values retain the defaults. Add it to a local board while
choosing a treatment; omit it from a production board when it is no longer useful.

## Credentials

Never put a token or password in YAML. `token_env` contains only the name of the environment
variable that will hold the credential at runtime:

```yaml
sources:
  github:
    type: github-actions
    repo: your-org/your-repo
    token_env: GITHUB_TOKEN
```

The deployment must provide `GITHUB_TOKEN` through a separate runtime secret/environment strategy.
Anyone who can read the board file can see its contents.

The published AWS template does not populate arbitrary `token_env` variables. Its default deployment
therefore supports public sources; private sources need the consumer-owned integration described in
[Private sources](aws-setup.md#private-sources).

## Single and multiple boards

For a simple deployment, use one board. It is selected automatically. If a configuration contains
multiple boards, set the `BOARD` runtime environment variable to the desired board name. An invalid
name, or omitting `BOARD` when there is more than one board, causes startup to fail and lists the
available names.

Set `BOARD` in the runtime environment when deploying a multi-board configuration.

## Validation

The configuration is validated before it is loaded. Invalid files should report the schema error
instead of starting the dashboard. In particular, check that:

- `boards` is a map containing at least one board.
- Each board contains at least one panel.
- Panel IDs are unique within each board.
- Refresh values use supported durations such as `60s` or `5m`.
- URLs and JSON paths use the supported formats for the panel type.

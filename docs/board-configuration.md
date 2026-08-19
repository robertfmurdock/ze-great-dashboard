# Board configuration

Ze Great Dashboard boards are YAML documents containing named sources and one or more named
boards. A panel refers to a source, identifies the signal type to render, and can define its
refresh interval and grid position.

## Example

Save a configuration such as this one as `board.yaml`:

```yaml
sources:
  github:
    type: github-actions
    repo: your-org/your-repo
    token_env: GITHUB_TOKEN

boards:
  operations:
    refresh: 60s
    panels:
      - id: build
        type: pipeline-status
        source: github
        pipeline: main.yml
        position: { x: 0, y: 0, w: 8, h: 6 }
      - id: release
        type: http-value
        url: https://status.example.com/version.json
        json_path: $.version
        refresh: 5m
        position: { x: 8, y: 0, w: 4, h: 6 }
```

The board-level `refresh` is the default for panels that do not provide their own value. Refresh
durations use values such as `60s` or `5m`. Panel IDs must be unique within a board. Positions use
a twelve-column grid: `x` and `y` locate the panel, while `w` and `h` define its size.

Sources are reusable named definitions. Current source and panel adapters determine which
additional fields they accept; for example, `github-actions` uses `repo` and a workflow `pipeline`,
while `http-value` uses `url` and an optional `json_path` such as `$.version`.

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

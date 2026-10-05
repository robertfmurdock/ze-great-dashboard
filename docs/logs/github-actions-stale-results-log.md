# GitHub Actions stale-result handling

## 2026-10-05 — retain disclosed historical evidence and narrow the listing query

GitHub Actions can return an older workflow run after the browser has already accepted a newer
one. The client keeps its monotonic source-timestamp guard: accepting that response would make a
trust dashboard actively regress. Previously, however, a reload with a persisted accepted result
and a rejected first response had no current envelope to render, leaving the panel in the ambiguous
loading state.

The rejected response now creates a client-only presentation record from the already-confirmed
pipeline result: status, source timestamp, and run link. It is deliberately not an envelope and is
cleared by the next equal-or-newer accepted result. A panel with no current envelope uses this
record as explicitly historical evidence, remains non-busy and non-attention-worthy, and points its
ordinary source action to the confirmed run. GitHub-hosted regressions additionally link to the
public [GitHub API report](https://github.com/orgs/community/discussions/206725); other sources use
the same disclosure without attributing the incident to GitHub.

The server now first asks the workflow-runs API for up to 100 runs created in the previous 30 UTC
days, then chooses the newest returned `created_at` locally. This is a best-effort mitigation for
the stale-listing behavior, not a claim that the listing is authoritative. An empty bounded window
makes exactly one request using the former unbounded, one-run lookup so dormant repositories remain
observable. The browser still never supplies a URL, credentials remain server-only, and the named
operation allowlist is unchanged.

Focused tests cover an unordered bounded page, empty-window fallback, and the persisted-result
reload sequence through the polling hook and rendered accessible panel. `npm run check` passed,
including its Docker-backed container and browser phases.

## 2026-10-05 — keep the mitigation’s state and URL rules singular

The follow-up refactor folds the bounded `created` query into the existing GitHub workflow-runs
call builder rather than maintaining a pipeline-only URL builder. The presentation transition also
lives alongside pipeline reconciliation: it translates a rejected response plus accepted browser
evidence into historical display evidence, and clears that disclosure on accepted recovery.

This is intentionally a small pure boundary, not a general polling framework. Fetching, schedules,
diagnostics, and browser-memory writes remain in the hook because they are lifecycle effects with
different ownership. The direct reconciliation test now covers the retained-to-recovered transition;
the full repository gate passed again.
